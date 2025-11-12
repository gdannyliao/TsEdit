import { Node, ClassDeclaration, MethodDeclaration, Type, Statement, SyntaxKind, ParameterDeclarationStructure, StructureKind, ReturnStatement, SourceFile, BreakStatement, ContinueStatement, ts } from "ts-morph"
import { CodeVisitor } from "../CodeScanner.ts";

import { RandomSeed } from "../random.ts";
import { isPromiseType, isStaticFunc, toTypeText, getDefaultValueByString, hasBlock } from "../ASTTools.ts";
import { buildScope, JumpStmt, rebuildScope, Scope, Variable } from "./Scopes.ts";

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
        if (method.getStatements().length < 3)
            return false
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
    private prepareCodes(jumpStmts: Array<JumpStmt>, changedVars: Set<Variable>, spilledVars: Set<Variable>): { receiveVars: string[], lastReturns: string[], returnTypes: string[], ifBreakLine: string[], newDeclareVars: string[], willBreakVars: { name: string, type: number }[], midReturns: Variable[] } {
        const lastReturns: string[] = []
        const midReturns: Variable[] = []
        const returnTypes: string[] = []
        const newDeclareVars: string[] = []
        const ifBreakLine: string[] = []
        const receiveVars: string[] = []
        const willBreakVars: { name: string, type: number }[] = []
        const originReturns: ReturnStatement[] = []

        let returnWillBreakFlagCreated = false
        jumpStmts.forEach(jmp => {
            const jmpStmt = jmp.getStmt()
            if (jmp.getStmt() instanceof ReturnStatement) {
                originReturns.push(jmpStmt as ReturnStatement)
                if (returnWillBreakFlagCreated) { //所有的return语句用一个flag传递即可，既有return也有break等情况，才需要多个w_b_传递
                    return
                }
                returnWillBreakFlagCreated = true
            }
            const willBreakVarName = `w_b_${this.getTempVarIdx()}`
            receiveVars.push(willBreakVarName)
            lastReturns.push("false")
            returnTypes.push("boolean")
            newDeclareVars.push(`${willBreakVarName}:boolean`)
            willBreakVars.push({ name: willBreakVarName, type: jmp.getStmt().getKind() })
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

        if (originReturns.length > 0) {
            //有非空中间返回又有原始返回时，才需要用r_t_传递原始返回值

            const addReturnType = (returnType: string) => {
                if (returnType === "void") {
                    return
                }
                const rtName = `r_t_${this.getTempVarIdx()}`
                const defaultValue = getDefaultValueByString(returnType)
                lastReturns.push(defaultValue)
                receiveVars.push(rtName)
                returnTypes.push(returnType)
                newDeclareVars.push(`${rtName} = ${defaultValue}`)
                ifBreakLine.push(rtName)
            }
            const returnType = this.getReturnTypeText()
            if (returnType instanceof Array) {
                for (let i = 0; i < returnType.length; i++) {
                    addReturnType(returnType[i])
                }
            } else {
                addReturnType(returnType)
            }
        }

        return { receiveVars, lastReturns, returnTypes, ifBreakLine, newDeclareVars, willBreakVars, midReturns }
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
    private replaceMidReturnStmts(splitStmts: Statement[], jumpStmts: Array<JumpStmt>,
        midReturns: Variable[], willBreakVars: { name: string, type: number }[]): boolean {

        let lastStmtIsJumpStmt = false
        const lastStmt = splitStmts[splitStmts.length - 1]

        const stmtPosition = new Map<number, number>()
        for (let i = 0; i < jumpStmts.length; i++) {
            if (jumpStmts[i].getStmt() === lastStmt) {
                lastStmtIsJumpStmt = true
            }
            for (let j = 0; j < splitStmts.length; j++) {
                if (splitStmts[j] === jumpStmts[i].getStmt()) {
                    stmtPosition.set(i, j)
                    break
                }
            }
        }

        for (let i = 0; i < jumpStmts.length; i++) {
            const jmpStmt = jumpStmts[i]
            const jmp = jmpStmt.getStmt()
            const newReturnValues: string[] = []
            for (let j = 0; j < willBreakVars.length; j++) {
                newReturnValues.push("true")
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
                jumpStmts[i].setStmt(jmp.replaceWithText(`return [${newReturnValues.join(',')},${oldReturn}]`) as ReturnStatement)
            } else {
                jumpStmts[i].setStmt(jmp.replaceWithText(`return [${newReturnValues.join(',')}]`) as ReturnStatement)
            }
        }

        for (let i = 0; i < jumpStmts.length; i++) {
            const pos = stmtPosition.get(i)
            if (pos !== undefined) {
                splitStmts[pos] = jumpStmts[i].getStmt()
            }
        }
        return lastStmtIsJumpStmt
    }
    /**
     * 插入新方法。新变量w_b_用于表示新方法中是否有返回值，这种返回在原方法中会中断原方法后续的执行。
     * 新变量r_t_X，其中X表示返回值的索引，用于表示被分割进新方法中的返回语句中的值。
     * @param splitStmts 
     * @param scope 
     * @returns 
     */
    private insertNewMethod(newStmts: (Statement | string)[], splitStmts: Statement[],
        scope: Scope, insertIdx: number) {

        const newMethodName = `z_${this.random.getString(10)}`
        const { invokedVars, spilledVars, changedVars, jumpStmts } = scope.collectDataIn(splitStmts[0].getStartLineNumber(), splitStmts[splitStmts.length - 1].getEndLineNumber())

        const { newMethodParams, newMtdCallParams } = this.gatherParams(invokedVars)
        const { receiveVars, lastReturns, returnTypes, ifBreakLine, newDeclareVars, willBreakVars, midReturns } = this.prepareCodes(jumpStmts, changedVars, spilledVars)

        const lastStmtIsJumpStmt = this.replaceMidReturnStmts(splitStmts, jumpStmts, midReturns, willBreakVars)

        const newStatements = splitStmts.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)
        const callNewMethodStmt = `this.${newMethodName}(${newMtdCallParams.join(',')})`

        let returnType: string | undefined = undefined
        if (returnTypes.length > 0) {
            if (!lastStmtIsJumpStmt) {
                newStatements.push(`return [${lastReturns.join(',')}]`)
            }
            returnType = `[${returnTypes.join(',')}]`

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
            newStmts.splice(insertIdx, 0, receiveReturnVarLine)
        } else {
            newStmts.splice(insertIdx, 0, `${callNewMethodStmt};`)
        }

        this.currentCls.addMethod({
            name: newMethodName,
            parameters: newMethodParams,
            statements: newStatements,
            returnType: returnType,
        })
    }

    private tempVarIdx = 0

    private getTempVarIdx() {
        return this.tempVarIdx++
    }

    private resetTempVarIdx() {
        this.tempVarIdx = 0
    }

    /**
     * 调整分割结束位置，跳过某些语句，如await表达式或new Promise表达式。
     * @param start 分割开始位置
     * @param end 分割结束位置
     * @param stmts 
     * @returns 
     */
    private skipSomeStmt(start: number, end: number, stmts: Statement[]): number {
        for (let i = end - 1; i >= start; i--) {
            if (stmts[i].getKind() === SyntaxKind.LabeledStatement) {
                end = i //跳过labeled语句
                continue
            }
            const awaitExprs = stmts[i].getDescendantsOfKind(SyntaxKind.AwaitExpression)
            if (awaitExprs.length > 0) {
                end = i //跳过await表达式
                continue
            }

            const newExprs = stmts[i].getDescendantsOfKind(SyntaxKind.NewExpression)
            if (newExprs.length > 0) {
                for (const newExpr of newExprs) {
                    const expr = newExpr.getExpression()
                    if (expr && expr.getKind() === SyntaxKind.Identifier && expr.getText() === "Promise") {//含有new Promise
                        end = i //跳过new Promise表达式
                        break
                    }
                }
            }
        }
        return end
    }

    private ensureSplitPoints(stmts: Statement[], range: [number, number]): { start: number, end: number }[] {
        const splitPoints: { start: number, end: number }[] = []
        if (range) {
            let end = range[1]
            if (end === -1) {
                end = stmts.length
            }
            splitPoints.push({ start: range[0], end })
        } else {
            let start = 0, end = 0 //end不包含在分割范围
            while (start < stmts.length) {
                start = this.random.getIntInRange(start, stmts.length - 1)
                end = this.random.getIntInRange(start + 1, stmts.length);
                const newEnd = this.skipSomeStmt(start, end, stmts)
                if (newEnd !== end) {
                    if (newEnd === start) { //如果newEnd === start，说明start语句就是await或者promise表达式，直接跳过
                        start = newEnd + 1
                        continue
                    }
                    splitPoints.push({ start, end: newEnd })
                    console.log(`split from: ${start} -> ${newEnd}`)
                    start = end + 1 //如果有需要跳过的语句，则下次循环直接跳过这条语句（end+1是需要跳过的语句）
                } else {
                    splitPoints.push({ start, end })
                    console.log(`split from: ${start} -> ${end}`)
                    start = end
                }
            }
        }
        return splitPoints
    }

    private replaceOldMethod(scope: Scope, newStmts: (Statement | string)[]) {
        const newStrStmts = newStmts.map(stmt => stmt instanceof Statement ? stmt.getText() : stmt)//这行必须先执行，不能在removeStatements之后执行
        const block = scope.getBlock()!
        block.removeStatements([0, block.getStatementsWithComments().length])
        block.addStatements(newStrStmts)
    }

    private split(scope: Scope, range: ([number, number] | undefined) = undefined) {
        const stmts: Statement[] = scope.getBlock()!.getStatements()
        if (stmts.length < 2 && !hasBlock(stmts[0])) { //如果只有一个语句，且不是块语句，则不需要分割
            return
        }
        const splitPoints: { start: number, end: number }[] = this.ensureSplitPoints(stmts, range)

        this.resetTempVarIdx()
        const newStmts: (Statement | string)[] = Array.from(stmts)
        for (let i = splitPoints.length - 1; i >= 0; i--) { //从后往前处理，避免分割和插入行后总是要重新计算索引的问题
            const { start, end } = splitPoints[i]

            //由于从后往前分割，所以splitStmt可以直接视为Statement[]，因为插入的string statement都在后面
            const splitStmts: Statement[] = newStmts.splice(start, end - start) as Statement[]

            this.insertNewMethod(newStmts, splitStmts, scope, start)
        }
        this.replaceOldMethod(scope, newStmts)
    }

    private deepSplit(scope: Scope, range: ([number, number] | undefined) = undefined) {
        const children = scope.getChildren()
        if (children.size > 0) {
            const keys = Array.from(children.keys())
            for (let i = keys.length - 1; i >= 0; i--) { //较小的作用域排在后面，所以从较小的作用域开始处理
                this.deepSplit(children.get(keys[i]))
            }
            //先分割外层的话，子块可能随着分割一起被分割进了新函数，导致子块没有被分割到。
            scope = rebuildScope(scope) //先分割子块，有可能会导致语句起始和终止位置改变，这里重新构建scope以修正
        }
        this.split(scope, range)
    }

    private splitMethod(method: MethodDeclaration, range: [number, number] | undefined): boolean {
        this.deepSplit(buildScope(SyntaxKind.MethodDeclaration, method), range)
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
        this.isAsyncFunc = undefined
        method.getModifiers().forEach(m => {
            if (m.getKind() === SyntaxKind.AsyncKeyword) {
                this.isAsyncFunc = isPromiseType(method.getReturnType())
                return
            }
        })
        if (this.isAsyncFunc === undefined) {
            this.returnType = method.getReturnType()
        }
        return this.splitMethod(method, range)
    }

    private getReturnTypeText(): string | string[] {
        if (this.isAsyncFunc) {
            const types = this.isAsyncFunc.innerTypes
            if (types.length === 1) {
                return toTypeText(types[0])
            } else {
                return types.map(t => toTypeText(t))
            }
        }
        return toTypeText(this.returnType)
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
