import { Block, Node, Type, SyntaxKind, Statement, ClassDeclaration, MethodDeclaration, ParameterDeclarationStructure, StructureKind, ReturnStatement, BinaryExpression } from "ts-morph"
import { RandomSeed } from "../random.ts";
import { getBlock, toTypeText, isAssignmentStatement, Block as SplitBlock, isPromiseType, isStaticFunc, getDefaultValueByType, getDefaultValueByString } from '../ASTTools.ts'
import { CodeVisitor } from "../CodeScanner.ts";
import { ChangedVal, NewReturnVal, Param } from "./MethodSplitModels.ts";

export class MethodSplitVisitor implements CodeVisitor {
    private random: RandomSeed
    private currentCls: ClassDeclaration | undefined
    private currentMethod: MethodDeclaration | undefined
    private declaredVars = new Map<string, Param>()
    private returnType: Type | undefined
    private isPromiseRt: {
        yes: boolean;
        innerTypes?: Type[];
    } | undefined
    private hasWillBreakFlag = false

    private keepMap: Map<string, Set<string>> | undefined

    constructor(seed: string) {
        this.random = new RandomSeed(seed)
    }

    public setKeepMap(keepMap: Map<string, Set<string>> | undefined) {
        this.keepMap = keepMap
    }
    private shouldSplit(statements: (Statement | string)[]): boolean {
        if (statements.length <= 3) return false
        if (isStaticFunc(this.currentMethod)) return false
        return true
    }

    private scanVarsAndReturn(statements: (Statement | string)[]
        , start: number = 0, end: number = 0): [number, number, Set<ChangedVal>, Set<ReturnStatement>] {
//FIXME 改成变量声明，也和变量修改一样的处理方式
        const shouldKeep = (isAssign: { yes: boolean, expr: BinaryExpression | undefined }): { yes: boolean, varName: string | undefined } => {
            if (!isAssign.yes || isAssign.expr === undefined)
                return { yes: false, varName: undefined }
            const left = isAssign.expr.getLeft()
            if (left.getKind() === SyntaxKind.PropertyAccessExpression) {
                //属性访问表达式，比如var1.length
                const propAcce = left.asKind(SyntaxKind.PropertyAccessExpression)!
                const prop = propAcce.getExpression()
                if (prop.getKind() === SyntaxKind.Identifier) {
                    if (this.declaredVars.has(prop.getText())) {
                        return { yes: true, varName: prop.getText() }
                    }
                }
            } else if (left.getKind() === SyntaxKind.Identifier) {
                if (this.declaredVars.has(left.getText())) {
                    return { yes: true, varName: left.getText() }
                }
            }
            return { yes: false, varName: undefined }
        }

        const hasBreakReturn = (b: SplitBlock): boolean => {
            switch (b.getParentKind()) {
                case SyntaxKind.FunctionDeclaration:
                case SyntaxKind.FunctionExpression:
                case SyntaxKind.ArrowFunction:
                case SyntaxKind.ClassDeclaration:
                case SyntaxKind.ModuleDeclaration:
                    //这些块里面的return对外层函数无影响
                    return false
                default:
                    return true
            }
        }

        const newVars = new Set<Param>()
        const changedVars = new Set<ChangedVal>()
        const midReturns = new Set<ReturnStatement>()
        const lastStmt = statements[end - 1]
        if (lastStmt instanceof Statement && lastStmt.getKind() === SyntaxKind.ReturnStatement) {
            end -= 1
        }
        for (let i = start; i < end; i++) {
            const stmt = statements[i]
            if (stmt instanceof Statement) {
                if (stmt.getKind() === SyntaxKind.VariableStatement) {
                    const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
                    varStmt.getDeclarations().forEach(decl => {
                        const name = decl.getName()
                        if (name === "w_b_" || name.startsWith("r_t_")) {
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
                        if (!hasBreakReturn(b)) {
                            continue
                        }
                        b.getStatements().forEach(stmt => {
                            switch (stmt.getKind()) { //FIXME 如果这里又是if之类的语句，赋值会被忽略
                                case SyntaxKind.ReturnStatement: {
                                    midReturns.add(stmt.asKind(SyntaxKind.ReturnStatement)!)
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
                //如果是字符串，说明是插入行，直接跳过
            }
        }

        newVars.forEach(varDecl => {
            this.declaredVars.set(varDecl.getName(), varDecl)
        })

        for (const aVar of changedVars) {
            if (aVar.getType() === "void") {
                continue
            }
            aVar.setType(this.declaredVars.get(aVar.getName()!)!.getType())
        }
        return [start, end, changedVars, midReturns]
    }


    private insertNewMethod(statements: (Statement | string)[],
        changedVars: Set<ChangedVal>, midReturns: Set<ReturnStatement>): [MethodDeclaration | undefined, NewReturnVal[] | undefined] {
        const gatherParams = () => {
            const newParams: ParameterDeclarationStructure[] = []
            const params = this.currentMethod!.getParameters()
            params.forEach(param => {
                newParams.push(param.getStructure())
            })
            this.declaredVars.forEach((varDecl, _) => {
                newParams.push({
                    kind: StructureKind.Parameter,
                    name: varDecl.getName(),
                    type: varDecl.getType(),
                })
            })
            return newParams
        }


        const gatherReturns = (): NewReturnVal[] => {
            const returns: NewReturnVal[] = []
            if (midReturns.size > 0) {
                returns.push(new NewReturnVal("w_b_", "boolean", "true"))
            }
            changedVars.forEach(v => {
                returns!.push(new NewReturnVal(v.getName(), v.getType(), v.getName(), true))//这些是变量，所以直接返回变量名
            })

            midReturns.forEach(rt => { //这里的修改会改变this.currentMethod.getReturnType()的返回值
                const oldReturn = rt.getExpression()?.getText()
                if (oldReturn) {
                    rt.replaceWithText(`return [${returns!.map(v => v.getValue()).join(',')},${oldReturn}]`)
                } else {
                    rt.replaceWithText(`return [${returns!.map(v => v.getValue()).join(',')}]`)
                }
            })

            if (!this.returnType?.isVoid() && midReturns.size > 0) {
                //有非空中间返回时，才需要用r_t_传递中间返回值
                if (this.isPromiseRt?.yes) {
                    for (let i = 0; i < this.isPromiseRt.innerTypes!.length; i++) {
                        returns.push(new NewReturnVal(`r_t_${i}`, toTypeText(this.isPromiseRt.innerTypes![i]), getDefaultValueByType(this.isPromiseRt.innerTypes![i])))
                    }
                } else {
                    returns.push(new NewReturnVal("r_t_", toTypeText(this.returnType), getDefaultValueByType(this.returnType)))
                }
            }
            if (midReturns.size > 0) {
                //如果有非空中间返回，结尾处的return要设置成false，表示不中断外层函数
                returns[0].setValue("false")
            }
            return returns
        }

        if (!this.currentCls || !this.currentMethod) {
            return [undefined, undefined]
        }

        const newParams: ParameterDeclarationStructure[] = gatherParams()
        const returns: NewReturnVal[] = gatherReturns()

        const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        newStatements.push(`return [${returns.map(v => v.getValue()).join(',')}]`)

        return [this.currentCls.addMethod({
            name: `z_${this.random.getString(10)}`,
            parameters: newParams,
            statements: newStatements,
            returnType: this.isPromiseRt?.yes ? `Promise<[${returns.map(v => v.getType()).join(',')}]>` : `[${returns.map(v => v.getType()).join(',')}]`,
            isAsync: this.isPromiseRt?.yes
        }), returns]
    }
    private insertCallMethodStatement(statements: (Statement | string)[], newMethod: MethodDeclaration, insertIndex: number, returns: NewReturnVal[] | undefined): number {
        let callNewMethodStmt = `this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`
        if (this.isPromiseRt?.yes) {
            callNewMethodStmt = `await ${callNewMethodStmt}`
        }
        //向Block中添加调用新方法的语句
        if (returns && returns.length > 0) {
            const [defines, names] = returns.reduce((acc, cur, idx) => {
                if (cur.isPassValue()) {
                    return acc
                }

                acc[0].push(`${cur.getName()} = ${getDefaultValueByString(cur.getType())}`)
                if (idx !== 0) {
                    acc[1].push(`${cur.getName()}`)
                }
                return acc
            }, [[] as string[], [] as string[]])

            if (returns[0].getName() === "w_b_") {
                if (this.hasWillBreakFlag) {
                    const breakIfLine = `if (w_b_) {return ${names.join(',')}}`
                    const receiveReturnVarStmt = `[${returns!.map(v => v.getName()).join(',')}] = ${callNewMethodStmt};${breakIfLine};` //FIXME 如果原return本身有返回值，应该return返回值
                    statements.splice(insertIndex, 0, `${receiveReturnVarStmt}`)
                } else {
                    this.hasWillBreakFlag = true
                    const helpVarDefine = `let ${defines.join(',')}`
                    const breakIfLine = `if (w_b_) {return ${names.join(',')}}`
                    const receiveReturnVarStmt = `${helpVarDefine};[${returns!.map(v => v.getName()).join(',')}] = ${callNewMethodStmt};${breakIfLine};` //FIXME 如果原return本身有返回值，应该return返回值
                    statements.splice(insertIndex, 0, `${receiveReturnVarStmt}`)
                }
                return 1 //这3条语句在添加到Block前，只视为1条语句
            } else {
                statements.splice(insertIndex, 0, `[${returns!.map(v => v.getName()).join(',')}] = ${callNewMethodStmt};`)
                return 1
            }
        } else {
            statements.splice(insertIndex, 0, callNewMethodStmt)
            return 1
        }
    }
    private splitMethod(block: Block, splitRange: [number, number] | undefined = undefined): boolean {
        const statements: (Statement | string)[] = block.getStatements()
        if (!this.currentMethod || !this.shouldSplit(statements)) {
            return false
        }

        let start = 0, end = 0
        if (splitRange) {
            if (splitRange[1] <= 0) { //如果end为-1，则视为分割start以后所有的语句
                splitRange[1] = statements.length
            }
            [start, end] = splitRange
            this.scanVarsAndReturn(statements, 0, start) //对于指定区间的操作，需要从0开始扫描，以便获得start之前的变量声明
        }
        do {
            let changedVars: Set<ChangedVal>, midReturns: Set<ReturnStatement>
            end = end === 0 ? this.random.getIntInRange(start, statements.length) : end;
            [start, end, changedVars, midReturns] = this.scanVarsAndReturn(statements, start, end)

            if (start === end) {
                //调整后的分割点如果相同，说明没有可分了
                break
            }
            console.log(`--split ${start}-${end}`)
            const extractStmts = statements.splice(start, end - start)
            const [newMethod, subMethodReturns] = this.insertNewMethod(extractStmts, changedVars, midReturns)
            if (!newMethod) {
                return false
            }
            const insertCount = this.insertCallMethodStatement(statements, newMethod, start, subMethodReturns)
            start = end - (end - start) + insertCount //start的新位置是原始end-删除的行数+插入的行数
            if (statements.length - end < 3) {
                end = statements.length
            } else {
                end = 0
            }
        } while (start < statements.length && splitRange === undefined)

        const newStatements = statements.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        block.removeStatements([0, block.getStatementsWithComments().length])
        block.addStatements(newStatements)
        this.hasWillBreakFlag = false
        return true
    }

    private visitMethodInternal(cls: ClassDeclaration, method: MethodDeclaration, range: [number, number] | undefined): boolean {
        const body = method.getBody()
        if (Node.isBlock(body)) {
            console.log(`split ${cls.getName()}.${method.getName()}`)
            this.currentCls = cls
            this.currentMethod = method
            this.returnType = method.getReturnType()
            this.isPromiseRt = isPromiseType(method.getReturnType())
            this.declaredVars.clear()
            return this.splitMethod(body, range)
        }
        return false
    }
    visitMethod(cls: ClassDeclaration, method: MethodDeclaration): boolean {
        if (this.keepMap?.get(cls.getName())?.has(method.getName())) {
            return false
        }
        return this.visitMethodInternal(cls, method, undefined)
    }

}