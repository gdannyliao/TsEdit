import { Statement, Block as TsBlock, SyntaxKind, Node, Type, IterationStatement, WithStatement } from 'ts-morph';
import { TsRename } from './TsRename.ts';


function toTypeText(type: Type | undefined): string {
    if (type === undefined) {
        return "void"
    }
    if (type.isLiteral()) {
        return type.getBaseTypeOfLiteralType().getText()
    }
    return type.getText()
}

function isAssignmentStatement(statement: Statement): { is: boolean, varName: string | undefined, operator: string | undefined } {
    if (statement.getKind() !== SyntaxKind.ExpressionStatement) {
        return { is: false, varName: undefined, operator: undefined };
    }

    const exprStmt = statement.asKind(SyntaxKind.ExpressionStatement)!;
    const expression = exprStmt.getExpression();

    if (expression.getKind() === SyntaxKind.BinaryExpression) {
        const binaryExpr = expression.asKind(SyntaxKind.BinaryExpression)!;
        const operatorKind = binaryExpr.getOperatorToken().getKind();

        // 检查各种赋值操作符
        const assignmentOperators = [
            SyntaxKind.EqualsToken,           // =
            SyntaxKind.PlusEqualsToken,       // +=
            SyntaxKind.MinusEqualsToken,      // -=
            SyntaxKind.AsteriskEqualsToken,   // *=
            SyntaxKind.SlashEqualsToken,      // /=
            SyntaxKind.PercentEqualsToken,    // %=
            SyntaxKind.AmpersandEqualsToken,  // &=
            SyntaxKind.BarEqualsToken,        // |=
            SyntaxKind.CaretEqualsToken,      // ^=
            SyntaxKind.LessThanLessThanEqualsToken,     // <<=
            SyntaxKind.GreaterThanGreaterThanEqualsToken, // >>=
            SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken // >>>=
        ];

        return { is: assignmentOperators.includes(operatorKind), varName: binaryExpr.getLeft().getText(), operator: binaryExpr.getOperatorToken().getText() };
    }

    return { is: false, varName: undefined, operator: undefined };
}

export class Block {
    constructor(private statements: Statement[], private parentKind: SyntaxKind) {

    }
    getStatements() {
        return this.statements;
    }

    getParentKind() {
        return this.parentKind
    }

    setParentKind(parentKind: SyntaxKind) {
        this.parentKind = parentKind
    }
}

function getInternalStmt(stmt: Statement, parentKind: SyntaxKind | undefined) {
    const kind = parentKind ? parentKind : stmt.getKind();
    if (stmt.getKind() === SyntaxKind.Block) {
        return new Block(stmt.asKind(SyntaxKind.Block)!.getStatements(), kind)
    } else {
        return new Block([stmt], kind)
    }
}
/**
 * 从语句中获取对应的块或语句
 * @param stmt 要处理的语句
 * @returns 返回对应的块、语句或undefined
 */
function getBlock(stmt: Statement): Block[] {
    const kind = stmt.getKind();

    switch (kind) {
        // If语句 - 获取then分支
        case SyntaxKind.IfStatement: {
            const ifStmt = stmt.asKind(SyntaxKind.IfStatement)!;
            if (ifStmt.getElseStatement()) {
                return [getInternalStmt(ifStmt.getThenStatement(), kind), getInternalStmt(ifStmt.getElseStatement()!, kind)];
            }
            return [getInternalStmt(ifStmt.getThenStatement(), kind)];
        }

        // 循环语句 - For, While, DoWhile
        case SyntaxKind.ForStatement:
        case SyntaxKind.ForInStatement:
        case SyntaxKind.ForOfStatement:
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement: {
            // 这些都继承自IterationStatement，有统一的getStatement方法
            return [getInternalStmt((stmt as IterationStatement).getStatement(), kind)];
        }

        // Try语句 - 获取try块
        case SyntaxKind.TryStatement: {
            const tryStmt = stmt.asKind(SyntaxKind.TryStatement)!;
            const catchBlock = tryStmt.getCatchClause()?.getBlock()
            const finallyBlock = tryStmt.getFinallyBlock()

            const blocks = [new Block(tryStmt.getTryBlock().getStatements(), kind)];
            if (catchBlock) {
                blocks.push(new Block(catchBlock.getStatements(), kind));
            }
            if (finallyBlock) {
                blocks.push(new Block(finallyBlock.getStatements(), kind));
            }
            return blocks
        }

        // Switch语句 - 获取case块
        case SyntaxKind.SwitchStatement: {
            const switchStmt = stmt.asKind(SyntaxKind.SwitchStatement)!;
            const cases = switchStmt.getClauses();
            const blocks: Block[] = [];
            for (const caseStmt of cases) {
                blocks.push(new Block(caseStmt.getStatements(), kind));
            }
            return blocks;
        }

        // 标签语句 - 获取内部语句
        case SyntaxKind.LabeledStatement: {
            const labeledStmt = stmt.asKind(SyntaxKind.LabeledStatement)!;
            return [getInternalStmt(labeledStmt.getStatement(), kind)];
        }

        // With语句（虽然在严格模式下不推荐使用）
        case SyntaxKind.WithStatement: {
            return [getInternalStmt((stmt as WithStatement).getStatement(), kind)];
        }

        // 函数声明 - 获取函数体
        case SyntaxKind.FunctionDeclaration: {
            const funcDecl = stmt.asKind(SyntaxKind.FunctionDeclaration)!;
            return [new Block((funcDecl.getBody() as TsBlock).getStatements(), kind)];
        }

        case SyntaxKind.FunctionExpression: {
            const funcExpr = stmt.asKind(SyntaxKind.FunctionExpression)!;
            return [new Block((funcExpr.getBody() as TsBlock).getStatements(), kind)];
        }

        case SyntaxKind.ArrowFunction: {
            const arrowFunc = stmt.asKind(SyntaxKind.ArrowFunction)!;
            return [new Block((arrowFunc.getBody() as TsBlock).getStatements(), kind)];
        }

        // 类声明 - 如果需要获取类体
        case SyntaxKind.ClassDeclaration: {
            // 类声明本身就是StatementedNode，可以直接获取其成员
            // 这里返回空，因为类的处理通常需要特殊逻辑
            return [];
        }

        // 模块声明
        case SyntaxKind.ModuleDeclaration: {
            const moduleDecl = stmt.asKind(SyntaxKind.ModuleDeclaration)!;
            return [new Block((moduleDecl.getBody() as TsBlock).getStatements(), kind)];
        }

        // 块语句本身
        case SyntaxKind.Block: {
            return [new Block(stmt.asKind(SyntaxKind.Block)!.getStatements(), kind)];
        }

        // 其他语句类型没有块
        default:
            return [];
    }
}

/**
 * 获取If语句的所有分支（包括else分支）
 * @param ifStmt If语句
 * @returns 返回所有分支的数组
 */
function getAllBranchesFromIfStatement(ifStmt: Statement): Statement[] {
    if (ifStmt.getKind() !== SyntaxKind.IfStatement) {
        return [];
    }

    const ifStatement = ifStmt.asKind(SyntaxKind.IfStatement)!;
    const branches: Statement[] = [];

    // 添加then分支
    branches.push(ifStatement.getThenStatement());

    // 添加else分支（如果存在）
    const elseStatement = ifStatement.getElseStatement();
    if (elseStatement) {
        branches.push(elseStatement);
    }

    return branches;
}

/**
 * 检查语句是否包含块
 * @param stmt 要检查的语句
 * @returns 如果语句包含块则返回true
 */
function hasBlock(stmt: Statement): boolean {
    return getBlock(stmt) !== undefined;
}

export {
    getBlock,
    getAllBranchesFromIfStatement,
    hasBlock, toTypeText, isAssignmentStatement
};