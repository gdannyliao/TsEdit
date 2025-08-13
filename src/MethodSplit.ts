import { Block, Node, Project, ParameterDeclaration, Type, SyntaxKind, Statement, ClassDeclaration, MethodDeclaration, VariableDeclaration, ParameterDeclarationStructure, StructureKind, StatementStructures, SourceFile } from "ts-morph"
import seedrandom from 'seedrandom';
import { RandStr } from "./RandStr.ts";
import { existsSync, mkdirSync } from "node:fs";

class Param {
    constructor(private name: string, private type: string) {
    }

    getName() {
        return this.name
    }

    getType() {
        return this.type
    }

    setName(name: string) {
        this.name = name
    }
}

class ReturnValue {
    private type: string = "void"
    constructor(private name: string, private operator: string) {
    }

    getName() {
        return this.name
    }

    getOperator() {
        return this.operator
    }

    getType() {
        return this.type
    }

    setType(type: string) {
        this.type = type
    }
}

function toTypeText(type: Type): string {
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
export class MethodSplit {
    private randNum: seedrandom.PRNG;
    private randStr: RandStr
    private currentCls: ClassDeclaration | undefined
    private currentMethod: MethodDeclaration | undefined
    private changedFiles: Set<SourceFile> = new Set()

    constructor(private project: Project, private seed: string) {
        this.randNum = seedrandom(seed);
        this.randStr = new RandStr(seed)
    }
    private getRandomInt(min: number, max: number) {
        return Math.floor(this.randNum() * (max - min + 1)) + min;
    }

    private shouldSplit(block: Block) {
        return block.getStatements().length > 3
    }

    private getSplitRange(block: Block, start: number = 0): [number, number, Set<Param>, Set<ReturnValue>] {
        const newVars = new Set<Param>()
        const returnValues = new Set<ReturnValue>()
        const end = this.getRandomInt(start, block.getStatements().length)
        for (let i = start; i < end; i++) {
            //FIXME 改成两边往中间扫描，减少对不必要行的跳过
            if (block.getStatements()[i].getKind() === SyntaxKind.VariableStatement) {
                const varStmt = block.getStatements()[i].asKind(SyntaxKind.VariableStatement)!
                varStmt.getDeclarations().forEach(decl => {
                    newVars.add(new Param(decl.getName(), toTypeText(decl.getType())))
                })
                start = i + 1
            } else {
                const isAssign = isAssignmentStatement(block.getStatements()[i])
                if (isAssign.is) {
                    returnValues.add(new ReturnValue(isAssign.varName!, isAssign.operator!))
                }
            }
        }
        return [start, end, newVars, returnValues]
    }

    private insertNewMethod(statements: Statement[], newVars: Map<string, Param>, returnValues: Set<ReturnValue>): MethodDeclaration | undefined {
        if (!this.currentCls || !this.currentMethod) {
            return undefined
        }
        const newParams: ParameterDeclarationStructure[] = []
        const params = this.currentMethod.getParameters()
        params.forEach(param => {
            newParams.push(param.getStructure())
        })
        newVars.forEach((varDecl, k) => {
            newParams.push({
                kind: StructureKind.Parameter,
                name: varDecl.getName(),
                type: varDecl.getType(),
            })
        })

        const lastStatement = statements[statements.length - 1]
        if (lastStatement.getKind() === SyntaxKind.ReturnStatement) {
            //如果最后一行是return语句，那说明中间的变量修改语句都不需要额外处理，直接填写原return变量的类型即可
            const returnStmt = lastStatement.asKind(SyntaxKind.ReturnStatement)!
            const returnType = returnStmt.getExpression()?.getType()
            return this.currentCls.addMethod({
                name: `z_${this.randStr.getString(10)}`,
                parameters: newParams,
                statements: statements.map(statement => statement.getText()),
                returnType: returnType ? toTypeText(returnType) : undefined,
            })
        }

        if (returnValues.size > 0) {
            const newStatements = statements.map(statement => statement.getText())
            newStatements.push(`return [${Array.from(returnValues).map(v => v.getName()).join(',')}]`)
            return this.currentCls.addMethod({
                name: `z_${this.randStr.getString(10)}`,
                parameters: newParams,
                statements: newStatements,
                returnType: `[${Array.from(returnValues).map(v => v.getType()).join(',')}]`
            })
        }

        return this.currentCls.addMethod({
                name: `z_${this.randStr.getString(10)}`,
                parameters: newParams,
                statements: statements.map(statement => statement.getText())
            })
    }

    private isLastStatementReturn(statements: Statement[]) {
        const lastStatement = statements[statements.length - 1]
        if (lastStatement.getKind() === SyntaxKind.ReturnStatement) {
            return true
        }
        return false
    }
    private splitBlock(block: Block) {
        if (!this.shouldSplit(block)) {
            return
        }

        let start, end = 0
        const vars = new Map<string, Param>()
        do {
            let newVars: Set<Param>
            let returnValues: Set<ReturnValue>
            [start, end, newVars, returnValues] = this.getSplitRange(block, end)
            newVars.forEach(varDecl => {
                vars.set(varDecl.getName(), varDecl)
            })

            for (const returnValue of returnValues) {
                returnValue.setType(vars.get(returnValue.getName())!.getType())
            }

            const extractStatements = block.getStatements().slice(start, end)
            const isLastReturn = this.isLastStatementReturn(extractStatements)
            const newMethod = this.insertNewMethod(extractStatements, vars, returnValues)
            if (!newMethod) {
                continue
            }
            block.removeStatements([start + 1, end]) //这个方法很奇怪，start传1的话，删除的是第0行
            const callNewMethodStmt = `this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`
            //向Block中添加调用新方法的语句
            if (isLastReturn && !newMethod.getReturnType().isVoid()) {
                block.insertStatements(start + 1, [`return ${callNewMethodStmt}`])
            } else {
                if (returnValues.size > 0) {
                    const receiveReturnVarStmt = `[${Array.from(returnValues).map(v => v.getName()).join(',')}] = ${callNewMethodStmt}`
                    block.insertStatements(start + 1, [`${receiveReturnVarStmt}`])
                    // let newInsertLine = 1
                    // for (const returnValue of returnValues) {
                    //     newInsertLine++
                    //     block.insertStatements(start + newInsertLine, [`${returnValue.getName()} = ${returnValue.getName() + "___"}`])
                    // }
                    // end += newInsertLine
                } else {
                    block.insertStatements(start + 1, [`${callNewMethodStmt}`])
                }
            }

        } while (end < block.getStatements().length)
    }

    split(clsName: string, methodName: string) {
        this.project.getSourceFiles().some(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return false
            }
            const classDecl = file.getClass(clsName)
            if (!classDecl) {
                return false
            }
            const method = classDecl.getMethod(methodName)
            if (!method) {
                return false
            }

            this.currentCls = classDecl
            this.currentMethod = method
            /*如何拆分方法？
            -收集方法参数，存入栈中
            -进行逐行扫描
                -遇到块，则递归
                -遇到let/const，存入栈中
            */
            const body = method.getBody()
            if (Node.isBlock(body)) {
                // const params = method.getParameters().reduce((map, param) => {
                //     const p = param.toParam()
                //     map.set(p.getName(), p)
                //     return map
                // }, new Map<string, Param>())

                this.splitBlock(body)
            }

            this.changedFiles.add(file)
            return true
        })
    }

    saveSync(outputDir?: string) {
        for (const file of this.changedFiles) {
            if (outputDir) {
                if (!existsSync(outputDir)) {
                    mkdirSync(outputDir, { recursive: true })
                }
                file.moveToDirectory(outputDir)
            }
            file.saveSync()
        }
    }

}