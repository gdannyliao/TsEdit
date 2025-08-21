import { Block, Node, Project, ParameterDeclaration, Type, SyntaxKind, Statement, ClassDeclaration, MethodDeclaration, VariableDeclaration, ParameterDeclarationStructure, StructureKind, StatementStructures, SourceFile, ReturnStatement, BinaryExpression } from "ts-morph"
import seedrandom from 'seedrandom';
import { RandStr } from "./RandStr.ts";
import { existsSync, mkdirSync } from "node:fs";
import { getBlock, toTypeText, isAssignmentStatement } from './ASTTools.ts'

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

class ChangedVal {
    constructor(private name: string | undefined = undefined, private type: string | undefined = undefined, private operator: string | undefined = undefined) {
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

class ReturnVal {
    constructor(private name: string | undefined = undefined,
        private type: string | undefined = undefined, private value: string | undefined = undefined) {
    }

    getName() {
        return this.name
    }

    getType() {
        return this.type
    }

    getValue() {
        return this.value
    }

    setValue(value: string) {
        this.value = value
    }

}
class MethodStruct {
    constructor(private name: string, private params: Param[], private statements: Statement[], private returns: Type[]) {
    }

    getName() {
        return this.name
    }

    getStatements() {
        return this.statements
    }

    getParams() {
        return this.params
    }

    getReturns() {
        return this.returns
    }
}
export class MethodSplit {
    private randNum: seedrandom.PRNG;
    private randStr: RandStr
    private currentCls: ClassDeclaration | undefined
    private currentMethod: MethodDeclaration | undefined
    private changedFiles: Set<SourceFile> = new Set()

    constructor(private project: Project, seed: string) {
        this.randNum = seedrandom(seed);
        this.randStr = new RandStr(seed)
    }
    private getRandomInt(min: number, max: number) {
        return Math.floor(this.randNum() * (max - min + 1)) + min;
    }

    private shouldSplit(statements: (Statement | string)[]):boolean {
        return statements.length > 3
    }

    private collectReturn(rt: ReturnStatement, rawReturnType: string, breakReturns: Set<ReturnStatement>) {
        if (rawReturnType === "void") {
            breakReturns.add(rt)
        } else {
            if (toTypeText(rt.getExpression()?.getType()) === rawReturnType) {
                breakReturns.add(rt)
            } else {
                console.warn("ignore return:" + rt.getText())
            }
        }
    }


    private scanAndSkipVarAndReturn(statements: (Statement | string)[], vars: Map<string, Param>
        , start: number = 0, end: number = 0, rawReturnType: string): [number, number, Set<ChangedVal>, Set<ReturnStatement>] {

        function shouldKeep(isAssign: { yes: boolean, expr: BinaryExpression | undefined }): { yes: boolean, varName: string | undefined } {
            if (!isAssign.yes || isAssign.expr === undefined)
                return { yes: false, varName: undefined }
            const left = isAssign.expr.getLeft()
            if (left.getKind() === SyntaxKind.PropertyAccessExpression) {
                //属性访问表达式，比如var1.length
                const propAcce = left.asKind(SyntaxKind.PropertyAccessExpression)!
                const prop = propAcce.getExpression()
                if (prop.getKind() === SyntaxKind.Identifier) {
                    if (vars.has(prop.getText())) {
                        return { yes: true, varName: prop.getText() }
                    }
                }
            } else if (left.getKind() === SyntaxKind.Identifier) {
                if (vars.has(left.getText())) {
                    return { yes: true, varName: left.getText() }
                }
            }
            return { yes: false, varName: undefined }
        }

        const newVars = new Set<Param>()
        const changedVars = new Set<ChangedVal>()
        const midReturns = new Set<ReturnStatement>()
        const lastStmt = statements[end - 1]
        if (lastStmt instanceof Statement && lastStmt.getKind() === SyntaxKind.ReturnStatement) {
            end -= 1
        }
        for (let i = start; i < end; i++) {
            //FIXME 改成两边往中间扫描，减少对不必要行的跳过
            const stmt = statements[i]
            if (stmt instanceof Statement) {
                if (stmt.getKind() === SyntaxKind.VariableStatement) {
                    const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
                    varStmt.getDeclarations().forEach(decl => {
                        const name = decl.getName()
                        if (name === "w_b_" || name === "r_t_") {
                            return
                        }
                        newVars.add(new Param(name, toTypeText(decl.getType())))
                    })
                    start = i + 1
                } else {
                    const keep = shouldKeep(isAssignmentStatement(stmt))
                    if (keep.yes) {
                        changedVars.add(new ChangedVal(keep.varName, undefined))
                    }

                    const blocks = getBlock(stmt)
                    for (const b of blocks) {
                        switch (b.getParentKind()) {
                            case SyntaxKind.FunctionDeclaration:
                            case SyntaxKind.FunctionExpression:
                            case SyntaxKind.ArrowFunction:
                            case SyntaxKind.ClassDeclaration:
                            case SyntaxKind.ModuleDeclaration:
                                //这些块里面的return对外层函数无影响
                                continue
                            default:
                                //扫描块，以便确定是否需要传递return语句
                                {
                                    b.getStatements().forEach(stmt => {
                                        switch (stmt.getKind()) {
                                            case SyntaxKind.ReturnStatement: {
                                                const rt = stmt.asKind(SyntaxKind.ReturnStatement)!
                                                this.collectReturn(rt, rawReturnType, midReturns)
                                                break
                                            }
                                            default: {
                                                const keep = shouldKeep(isAssignmentStatement(stmt))
                                                if (keep.yes) {
                                                    changedVars.add(new ChangedVal(keep.varName, undefined))
                                                }
                                            }

                                        }
                                    })
                                }
                        }
                    }
                }
                //如果是字符串，说明是插入行，直接跳过
            }
        }

        newVars.forEach(varDecl => {
            vars.set(varDecl.getName(), varDecl)
        })

        for (const aVar of changedVars) {
            if (aVar.getType() === "void") {
                continue
            }
            aVar.setType(vars.get(aVar.getName()!)!.getType())
        }
        return [start, end, changedVars, midReturns]
    }

    private isLastStmtReturn(statements: (Statement | string)[]) {
        const lastStmt = statements[statements.length - 1]
        if (lastStmt instanceof Statement && lastStmt.getKind() === SyntaxKind.ReturnStatement) {
            return true
        }
        return false
    }

    private getTypedDefaultValue(type: Type): string {
        if (type.isVoid()) {
            return "undefined"
        }
        if (type.isNumber()) {
            return "0"
        }
        if (type.isString()) {
            return "\"\""
        }
        if (type.isBoolean()) {
            return "false"
        }
        if (type.isArray()) {
            return "[]"
        }
        if (type.isObject()) {
            return "{}"
        }
        return ""
    }
    private insertNewMethod(statements: (Statement | string)[], newVars: Map<string, Param>,
        changedVars: Set<ChangedVal>, midReturns: Set<ReturnStatement>, rawReturnType: Type): [MethodDeclaration | undefined, ReturnVal[] | undefined] {
        if (!this.currentCls || !this.currentMethod) {
            return [undefined, undefined]
        }
        const newParams: ParameterDeclarationStructure[] = []
        const params = this.currentMethod.getParameters()
        params.forEach(param => {
            newParams.push(param.getStructure())
        })
        newVars.forEach((varDecl, _) => {
            newParams.push({
                kind: StructureKind.Parameter,
                name: varDecl.getName(),
                type: varDecl.getType(),
            })
        })

        const returns: ReturnVal[] = []
        if (midReturns.size > 0) {
            returns.push(new ReturnVal("w_b_", "boolean", "true"))
        }
        changedVars.forEach(v => {
            returns!.push(new ReturnVal(v.getName(), v.getType(), v.getName()))//这些是变量，所以直接返回变量名
        })

        midReturns.forEach(rt => {
            const oldReturn = rt.getExpression()?.getText()
            if (oldReturn) {
                rt.replaceWithText(`return [${returns!.map(v => v.getValue()).join(',')},${oldReturn}]`)
            } else {
                rt.replaceWithText(`return [${returns!.map(v => v.getValue()).join(',')}]`)
            }
        })
        if (!rawReturnType.isVoid() && midReturns.size > 0) {
            //有非空中间返回时，才需要用r_t_传递中间返回值
            returns.push(new ReturnVal("r_t_", toTypeText(rawReturnType), this.getTypedDefaultValue(rawReturnType)))
        }
        if (midReturns.size > 0) {
            //如果有非空中间返回，结尾处的return要设置成false，表示不中断外层函数
            returns[0].setValue("false")
        }
        const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        newStatements.push(`return [${returns.map(v => v.getValue()).join(',')}]`)

        return [this.currentCls.addMethod({
            name: `z_${this.randStr.getString(10)}`,
            parameters: newParams,
            statements: newStatements,
            returnType: `[${returns.map(v => v.getType()).join(',')}]`
        }), returns]
    }

    private insertCallMethodStatement(statements: (Statement | string)[], newMethod: MethodDeclaration, insertIndex: number, returns: ReturnVal[] | undefined, rawReturnType: string):number {
        const callNewMethodStmt = `this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`
        //向Block中添加调用新方法的语句
        if (returns!.length > 0) {
            const helpVarDefine = rawReturnType ? `let w_b_=false, r_t_:${rawReturnType}` : `let w_b_=false`
            const breakIfLine = rawReturnType ? `if (w_b_) {return r_t_;}` : `if (w_b_) {return;}`
            const receiveReturnVarStmt = `${helpVarDefine};[${returns!.map(v => v.getName()).join(',')}] = ${callNewMethodStmt};${breakIfLine};` //FIXME 如果原return本身有返回值，应该return返回值
            statements.splice(insertIndex, 0, `${receiveReturnVarStmt}`)
            return 3
        } else {
            statements.splice(insertIndex, 0, callNewMethodStmt)
            return 1
        }
    }
    private splitBlock(block: Block, splitRange: [number, number] | undefined = undefined, rawReturnType: Type) {
        const statements: (Statement | string)[] = block.getStatements()
        if (!this.shouldSplit(statements)) {
            return
        }

        const rawReturnTypeText = toTypeText(rawReturnType)
        const vars = new Map<string, Param>()
        let start = 0, end = 0
        if (splitRange) {
            if (splitRange[1] === -1) { //如果end为-1，则视为分割start以后所有的语句
                splitRange[1] = statements.length
            }
            [start, end] = splitRange
            this.scanAndSkipVarAndReturn(statements, vars, 0, start, rawReturnTypeText) //对于指定区间的操作，需要从0开始扫描，以便获得start之前的变量声明
        }
        do {
            let changedVars: Set<ChangedVal>, midReturns: Set<ReturnStatement>
            end = end === 0 ? this.getRandomInt(start, statements.length) : end;
            [start, end, changedVars, midReturns] = this.scanAndSkipVarAndReturn(statements, vars, start, end, rawReturnTypeText)
            
            if (start === end) {
                //调整后的分割点如果相同，说明没有可分了
                return
            }
            console.log(`--split ${start}-${end}`)
            const extractStmts = statements.splice(start, end - start)
            const [newMethod, subMethodReturns] = this.insertNewMethod(extractStmts, vars, changedVars, midReturns, rawReturnType)
            if (!newMethod) {
                return
            }
            // block.removeStatements([start, end-1])  //这个语句有bug，有些情况删除的不是指定行
            const insertCount = this.insertCallMethodStatement(statements, newMethod, start, subMethodReturns, rawReturnTypeText)
            start = end - (end - start) + insertCount //start的新位置是原始end-删除的行数+插入的行数
            if (statements.length - end < 3) {
                end = statements.length
            } else {
                end = 0
            }
        } while (start < statements.length && splitRange === undefined)

        const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        block.removeStatements([0, block.getStatements().length])
        block.addStatements(newStatements)
    }

    split(clsName: string, methodName: string, splitRange: ([number, number] | undefined) = undefined) {
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
                console.log(`split ${classDecl.getName()}.${method.getName()}`)
                this.splitBlock(body, splitRange, method.getReturnType())
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