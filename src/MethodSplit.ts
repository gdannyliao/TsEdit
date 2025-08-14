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

    private shouldSplit(statements: (Statement | string)[]) {
        return statements.length > 3
    }

    private getSplitRange(statements: (Statement | string)[], start: number = 0): [number, number, Set<Param>, Set<ReturnValue>] {
        const newVars = new Set<Param>()
        const returnValues = new Set<ReturnValue>()
        const end = this.getRandomInt(start, statements.length)
        for (let i = start; i < end; i++) {
            //FIXME 改成两边往中间扫描，减少对不必要行的跳过
            const stmt = statements[i]
            if (stmt instanceof Statement) {
                if (stmt.getKind() === SyntaxKind.VariableStatement) {
                    const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
                    varStmt.getDeclarations().forEach(decl => {
                        newVars.add(new Param(decl.getName(), toTypeText(decl.getType())))
                    })
                    start = i + 1
                } else {
                    const isAssign = isAssignmentStatement(stmt)
                    if (isAssign.is) {
                        returnValues.add(new ReturnValue(isAssign.varName!, isAssign.operator!))
                    }
                }
            }
            //如果是字符串，说明是插入行，直接跳过
        }
        return [start, end, newVars, returnValues]
    }

    private insertNewMethod(statements: (Statement | string)[], newVars: Map<string, Param>, returnValues: Set<ReturnValue>): MethodDeclaration | undefined {
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

        const lastStmt = statements[statements.length - 1]
        if (lastStmt instanceof Statement && lastStmt.getKind() === SyntaxKind.ReturnStatement) {
            //如果最后一行是return语句，那说明中间的变量修改语句都不需要额外处理，直接填写原return变量的类型即可
            const returnStmt = lastStmt.asKind(SyntaxKind.ReturnStatement)!
            const returnType = returnStmt.getExpression()?.getType()
            return this.currentCls.addMethod({
                name: `z_${this.randStr.getString(10)}`,
                parameters: newParams,
                statements: statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt),
                returnType: returnType ? toTypeText(returnType) : undefined,
            })
        }

        if (returnValues.size > 0) {
            const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
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
            statements: statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        })
    }

    private isLastStatementReturn(statements: (Statement|string)[]) {
        const lastStmt = statements[statements.length - 1]
        if (lastStmt instanceof Statement && lastStmt.getKind() === SyntaxKind.ReturnStatement) {
            return true
        }
        return false
    }
    private splitBlock(block: Block) {
        const statements: (Statement | string)[] = block.getStatements()
        if (!this.shouldSplit(statements)) {
            return
        }

        let start, end = 0
        const vars = new Map<string, Param>()
        do {
            let newVars: Set<Param>
            let returnValues: Set<ReturnValue>
            [start, end, newVars, returnValues] = this.getSplitRange(statements, end)
            newVars.forEach(varDecl => {
                vars.set(varDecl.getName(), varDecl)
            })

            for (const returnValue of returnValues) {
                returnValue.setType(vars.get(returnValue.getName())!.getType())
            }

            const extractStatements = statements.splice(start, end - start)
            const newMethod = this.insertNewMethod(extractStatements, vars, returnValues)
            if (!newMethod) {
                return
            }

            // block.removeStatements([start, end-1])  //这个语句有bug，有些情况删除的不是指定行
            const callNewMethodStmt = `this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`
            //向Block中添加调用新方法的语句
            if (this.isLastStatementReturn(extractStatements) && !newMethod.getReturnType().isVoid()) {
                statements.splice(start, 0, `return ${callNewMethodStmt}`)
            } else {
                if (returnValues.size > 0) {
                    const receiveReturnVarStmt = `[${Array.from(returnValues).map(v => v.getName()).join(',')}] = ${callNewMethodStmt}`
                    statements.splice(start, 0, `${receiveReturnVarStmt}`)
                } else {
                    statements.splice(start, 0, callNewMethodStmt)
                }
            }
            end = end - (end - start) + 1 //end的新位置是原始end-删除的行数+插入的行数，这里插入行为1
        } while (end < statements.length)
        const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)            
        block.removeStatements([0, block.getStatements().length])
        block.addStatements(newStatements)
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