import { Node, ClassDeclaration, MethodDeclaration, Type, Statement, SyntaxKind, BinaryExpression, ParameterDeclarationStructure, StructureKind, ReturnStatement, SourceFile, BreakStatement, ContinueStatement } from "ts-morph"
import { CodeVisitor } from "../CodeScanner.ts";

import { RandomSeed } from "../random.ts";
import { isPromiseType, isStaticFunc, toTypeText, getDefaultValueByType, getDefaultValueByString, isAssignmentStatement } from "../ASTTools.ts";
import { buildScope, findMinScope, rebuildScope, Scope, Variable } from "./Scopes.ts";

export class MethodSplitVisitor2 implements CodeVisitor {
    private random: RandomSeed
    private currentCls: ClassDeclaration | undefined
    private currentMethod: MethodDeclaration | undefined
    private returnType: Type | undefined
    private isAsyncFunc: {
        yes: boolean;
        innerTypes?: Type[];
    } | undefined
    private keepMap: Map<string, Set<string>> | undefined
    constructor(seed: string) {
        this.random = new RandomSeed(seed)
    }

    setKeepMap(keepMap: Map<string, Set<string>> | undefined) {
        this.keepMap = keepMap
    }

    private shouldSplit(method: MethodDeclaration): boolean {
        if (isStaticFunc(method)) return false
        return true
    }

    /**
     * 准备调用新方法需要的语句。返回类型，见example中的注释
     * @example
     * 原方法：
     * ...
     *  let w_b_0: boolean, r_t_1 = ""; //newDeclareVars 
        [w_b_0, var1, r_t_1] = this.z_n6oYp7WOYI(var1, text);//receiveVars = this.newMtd(newMtdCallParams)
        if (w_b_0) { //ifBreakLine
            return r_t_1 //ifBreakLineReturns
        }
        ...

        切分出的新方法：
        z_n6oYp7WOYI(var1: number, text: string): [boolean, number, string] { //returnTypes
        console.log("line4")
        if (text) {
            [var1] = this.z_98WFiybjHv(var1);
            return [true, var1, "return1"] //midReturns
        }

        console.log("line5")
        return [false, 0, ""] //lastReturns
    }
     * @param jumpStmts  切分出来的跳跃语句，由于最后一句代码为返回语句的情况特殊处理了，所以这里只包含中间的返回语句，或者继续语句、跳出语句
     * @param changedVars  切分出来的方法中改变的变量
     * @param spilledVars  切分出来的方法中，作用域外溢的变量
     * @returns receiveVars: 调用新方法后接收变量的列表。lastReturns: 新方法最后一句返回语句中的变量列表。returnTypes: 新方法的返回类型列表。ifBreakLine: 如果有ifBreakLine，返回语句中的变量列表。newDeclareVars: 原方法需要额外声明的变量。willBreakVarName: 是否有中间返回
     */
    private prepareCodes(jumpStmts: Array<ReturnStatement | ContinueStatement | BreakStatement>, changedVars: Set<Variable>, spilledVars: Set<Variable>): { receiveVars: string[], lastReturns: string[], returnTypes: string[], ifBreakLine: string[], newDeclareVars: string[], willBreakVars: { name: string, type: number }[] } {
        const lastReturns: string[] = []
        const midReturns: Variable[] = []
        const returnTypes: string[] = []
        const newDeclareVars: string[] = []
        const ifBreakLine: string[] = []
        const receiveVars: string[] = []
        const willBreakVars: { name: string, type: number }[] = []
        const originReturns: ReturnStatement[] = []

        jumpStmts.forEach(jmp => {
            const willBreakVarName = `w_b_${this.getTempVarIdx()}`
            receiveVars.push(willBreakVarName)
            lastReturns.push("false")
            returnTypes.push("boolean")
            newDeclareVars.push(`${willBreakVarName}:boolean`)
            willBreakVars.push({ name: willBreakVarName, type: jmp.getKind() })
            if (jmp instanceof ReturnStatement) {
                originReturns.push(jmp)
            }
        })
        changedVars.forEach(v => {
            receiveVars.push(v.getName())
            lastReturns.push(v.getName())
            midReturns.push(v)
            returnTypes.push((v.getType()))
        })

        spilledVars.forEach(v => {
            receiveVars.push(v.getName())
            lastReturns.push(v.getName())
            midReturns.push(v)
            returnTypes.push((v.getType()))
            newDeclareVars.push(`${v.getName()}:${v.getType()}`)
        })

        for (let i = 0; i < jumpStmts.length; i++) {
            const jmp = jumpStmts[i]

            const newReturnValues: string[] = []
            for (let j = 0; j < willBreakVars.length; j++) {
                if (j === i) {
                    newReturnValues.push("true")
                } else {
                    newReturnValues.push("false")
                }
            }

            for (const v of midReturns) {
                if (v.getStartLine() <= jmp.getStartLineNumber()) {
                    newReturnValues.push(v.getName())
                } else {
                    newReturnValues.push(getDefaultValueByString(v.getType()))
                }
            }

            let oldReturn: string | undefined = undefined
            if (jmp instanceof ReturnStatement) {
                //有插入的变量，需要修改原有的返回语句
                oldReturn = jmp.getExpression()?.getText()
            }

            if (oldReturn) {
                jumpStmts[i] = jmp.replaceWithText(`return [${newReturnValues.join(',')},${oldReturn}]`) as ReturnStatement
            } else {
                jumpStmts[i] = jmp.replaceWithText(`return [${newReturnValues.join(',')}]`) as ReturnStatement
            }
        }

        if (!this.returnType?.isVoid() && originReturns.length > 0) {
            //有非空中间返回又有原始返回时，才需要用r_t_传递原始返回值
            if (this.isAsyncFunc?.yes) {
                for (let i = 0; i < this.isAsyncFunc.innerTypes!.length; i++) {
                    if (this.isAsyncFunc.innerTypes![i].isVoid()) {
                        continue
                    }
                    const rtName = `r_t_${this.getTempVarIdx()}`
                    const defaultValue = getDefaultValueByType(this.isAsyncFunc.innerTypes![i])
                    lastReturns.push(defaultValue)
                    receiveVars.push(rtName)
                    returnTypes.push(toTypeText(this.isAsyncFunc.innerTypes![i]))
                    newDeclareVars.push(`${rtName} = ${defaultValue}`)
                    ifBreakLine.push(rtName)
                }
            } else {
                const rtName = `r_t_${this.getTempVarIdx()}`
                const defaultValue = getDefaultValueByType(this.returnType)
                lastReturns.push(defaultValue)
                receiveVars.push(rtName)
                returnTypes.push(toTypeText(this.returnType))
                newDeclareVars.push(`${rtName} = ${defaultValue}`)
                ifBreakLine.push(rtName)
            }
        }

        return { receiveVars, lastReturns, returnTypes, ifBreakLine, newDeclareVars, willBreakVars }
    }

    private gatherParams(invokedVars: Set<Variable>): { newMethodParams: ParameterDeclarationStructure[], newMtdCallParams: string[] } {
        const newMethodParams: ParameterDeclarationStructure[] = []
        const newMtdCallParams: string[] = []
        for (const v of invokedVars) {
            newMethodParams.push({
                kind: StructureKind.Parameter,
                name: v.getName(),
                type: v.getType(),
            })
            newMtdCallParams.push(v.getName())
        }

        return { newMethodParams, newMtdCallParams }
    }

    private toDeclareLine(vars: string[]) {
        if (vars.length === 0) return ""
        return `let ${vars.join(',')};`
    }
    /**
     * 插入新方法。新变量w_b_用于表示新方法中是否有返回值，这种返回在原方法中会中断原方法后续的执行。
     * 新变量r_t_X，其中X表示返回值的索引，用于表示被分割进新方法中的返回语句中的值。
     * @param splitStmts 
     * @param scope 
     * @returns 
     */
    private insertNormalMethod(stmts: (Statement | string)[], splitStmts: Statement[],
        scope: Scope, insertIdx: number) {

        if (!this.currentCls || !this.currentMethod) {
            return
        }

        const lastStmt = splitStmts[splitStmts.length - 1]
        let lastStmtIsJumpStmt = false
        const { invokedVars, spilledVars, changedVars, jumpStmts } = scope.collectDataIn(splitStmts[0].getStartLineNumber(), lastStmt.getEndLineNumber())

        const stmtPosition = new Map<number, number>()
        for (let i = 0; i < jumpStmts.length; i++) {
            if (jumpStmts[i] === lastStmt) {
                lastStmtIsJumpStmt = true
            }
            for (let j = 0; j < splitStmts.length; j++) {
                if (splitStmts[j] === jumpStmts[i]) {
                    stmtPosition.set(i, j)
                    break
                }
            }
        }


        const { newMethodParams, newMtdCallParams } = this.gatherParams(invokedVars)
        const { receiveVars, lastReturns, returnTypes, ifBreakLine, newDeclareVars, willBreakVars } = this.prepareCodes(jumpStmts, changedVars, spilledVars)

        for (let i = 0; i < jumpStmts.length; i++) {
            const pos = stmtPosition.get(i)
            if (pos !== undefined) {
                splitStmts[pos] = jumpStmts[i]
            }
        }

        const newStatements = splitStmts.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        const newMethodName = `z_${this.random.getString(10)}`
        let callNewMethodStmt = `this.${newMethodName}(${newMtdCallParams.join(',')})`
        if (this.isAsyncFunc?.yes) {
            callNewMethodStmt = `await ${callNewMethodStmt}`
        }

        let returnType: string | undefined = undefined
        if (returnTypes.length > 0) {
            if (!lastStmtIsJumpStmt) {
                newStatements.push(`return [${lastReturns.join(',')}]`)
            }
            returnType = this.isAsyncFunc?.yes ? `Promise<[${returnTypes.join(',')}]>` : `[${returnTypes.join(',')}]`

            let receiveReturnVarLine = `${this.toDeclareLine(newDeclareVars)}[${receiveVars.join(',')}] = ${callNewMethodStmt};`
            for (const v of willBreakVars) {
                switch (v.type) {
                    case SyntaxKind.ReturnStatement:
                        receiveReturnVarLine += `if (${v.name}) {return ${ifBreakLine.join(',')}};`
                        break
                    case SyntaxKind.BreakStatement:
                        receiveReturnVarLine += `if (${v.name}) {break};`
                        break
                    case SyntaxKind.ContinueStatement:
                        receiveReturnVarLine += `if (${v.name}) {continue};`
                        break
                }
            }
            stmts.splice(insertIdx, 0, receiveReturnVarLine)
        } else {
            stmts.splice(insertIdx, 0, `${callNewMethodStmt};`)
        }

        this.currentCls.addMethod({
            name: newMethodName,
            parameters: newMethodParams,
            statements: newStatements,
            returnType: returnType,
            isAsync: this.isAsyncFunc?.yes
        })
    }

    private tempVarIdx = 0

    private getTempVarIdx() {
        return this.tempVarIdx++
    }

    private resetTempVarIdx() {
        this.tempVarIdx = 0
    }

    private lastStmtIsMethodReturnStmt(endIdx: number, stmts: (Statement | string)[]) {
        if (endIdx === stmts.length && stmts[stmts.length - 1] instanceof ReturnStatement) {
            const rtExpr = (stmts[endIdx - 1] as ReturnStatement).getExpression()
            if (rtExpr && toTypeText(rtExpr.getType()) === this.returnType.getText()) {
                return true
            }
        }
        return false
    }

    private insertDirectReturnMethod(stmts: (Statement | string)[], splitStmts: Statement[], scope: Scope, start: number) {
        const { invokedVars } = scope.collectDataIn(splitStmts[0].getStartLineNumber(), splitStmts[splitStmts.length - 1].getEndLineNumber())
        const { newMethodParams, newMtdCallParams } = this.gatherParams(invokedVars)
        const newStatements = splitStmts.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        const newMethod = this.currentCls.addMethod({
            name: `z_${this.random.getString(10)}`,
            parameters: newMethodParams,
            statements: newStatements,
            returnType: this.returnType.getText(),
            isAsync: this.isAsyncFunc?.yes
        })

        let callNewMethodStmt = `this.${newMethod.getName()}(${newMtdCallParams.join(',')})`
        if (this.isAsyncFunc?.yes) {
            callNewMethodStmt = `return await ${callNewMethodStmt}`
        } else {
            callNewMethodStmt = `return ${callNewMethodStmt}`
        }
        stmts.splice(start, 0, callNewMethodStmt)
    }
    private split(scope: Scope, range: ([number, number] | undefined) = undefined): Scope {
        const stmts: (Statement | string)[] = scope.getBlock()!.getStatements()

        const splitPoints: { start: number, end: number }[] = []
        if (range) {
            let end = range[1]
            if (end === -1) {
                end = stmts.length
            }
            splitPoints.push({ start: range[0], end })
        } else {
            let start = 0, end = 0
            while (end + 1 < stmts.length) {
                start = this.random.getIntInRange(start, stmts.length - 1)
                end = this.random.getIntInRange(start + 1, stmts.length)
                splitPoints.push({ start, end })
                start = end + 1
            }
        }

        this.resetTempVarIdx()
        for (let i = splitPoints.length - 1; i >= 0; i--) { //从后往前处理，避免分割和插入行后总是要重新计算索引的问题
            const { start, end } = splitPoints[i]

            const lastStmtIsMethodReturnStmt = this.lastStmtIsMethodReturnStmt(end, stmts)

            //由于从后往前分割，所以splitStmt可以直接视为Statement[]，因为插入的string statement都在后面
            const splitStmt: Statement[] = stmts.splice(start, end - start) as Statement[]

            const minScope = findMinScope(scope, splitStmt[0].getStartLineNumber())
            if (!minScope) {
                return
            }

            if (lastStmtIsMethodReturnStmt) {
                this.insertDirectReturnMethod(stmts, splitStmt, minScope, start)
            } else {
                this.insertNormalMethod(stmts, splitStmt, minScope, start)
            }
        }

        const newStatements = stmts.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)//这行必须先执行，不能在removeStatements之后执行
        const block = scope.getBlock()!
        block.removeStatements([0, block.getStatementsWithComments().length])
        block.addStatements(newStatements)

        return rebuildScope(scope)
    }

    private deepSplit(scope: Scope, range: ([number, number] | undefined) = undefined): Scope {
        const newScope = this.split(scope, range) //FIXME 从这里切分出去的大块语句（含代码块的语句），不会再被切分。

        const children = newScope.getChildren()
        for (let i = children.length - 1; i >= 0; i--) { //较小的作用域排在后面，所以从较小的作用域开始处理
            this.deepSplit(children[i])
        }

        return newScope
    }

    private splitMethod(method: MethodDeclaration, range: [number, number] | undefined): boolean {
        let scope = this.deepSplit(buildScope(method), range)
        return true
    }
    private visitMethodInternal(cls: ClassDeclaration, method: MethodDeclaration, range: [number, number] | undefined): boolean {
        if (!Node.isBlock(method.getBody())) {
            return false
        }
        if (!this.shouldSplit(method)) {
            return false
        }
        console.log(`split ${cls.getName()}.${method.getName()}`)
        this.currentCls = cls
        this.currentMethod = method
        this.returnType = method.getReturnType()
        this.isAsyncFunc = undefined
        method.getModifiers().forEach(m => {
            if (m.getKind() === SyntaxKind.AsyncKeyword) {
                this.isAsyncFunc = isPromiseType(method.getReturnType())
            }
        })
        return this.splitMethod(method, range)
    }

    visitMethod(cls: ClassDeclaration, method: MethodDeclaration): boolean {
        if (this.keepMap?.get(cls.getName())?.has(method.getName())) {
            return false
        }
        return this.visitMethodInternal(cls, method, undefined)
    }

    private sourceFile: SourceFile
    visitFile(file: SourceFile): boolean {
        this.sourceFile = file
        return false
    }
}
