
import { AwaitExpression, BinaryExpression, BreakStatement, ContinueStatement, ExpressionStatement, ForOfStatement, Identifier, IterationStatement, LabeledStatement, MethodDeclaration, ObjectBindingPattern, PostfixUnaryExpression, PrefixUnaryExpression, ReturnStatement, Statement, StatementedNode, SyntaxKind, ts, VariableDeclarationList, VariableStatement } from 'ts-morph';
import { getBlock, hasBlock, isAssignmentStatement, toTypeText } from '../ASTTools.ts';
import { json } from 'node:stream/consumers';

export class Variable {
    constructor(private name: string, private type: string, private startLine: number, private endLine: number) {
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

    getStartLine() {
        return this.startLine
    }

    getEndLine() {
        return this.endLine
    }

    updateRange(startLine: number, endLine: number) {
        this.startLine = startLine
        this.endLine = endLine
    }
}

/**
 * 比较两个范围的相交关系
 * @param start1 1的开始行
 * @param end1 1的结束行
 * @param start2 2的开始行
 * @param end2 2的结束行
 * @returns 0：相等， 1：1包含2， 2：1底部与2交叉，3：1包含2，且1与2顶部齐平 -1：2包含1， -2：1顶部与2交叉， -3：2包含1，且1与2顶部齐平， -100：不相交
 */
function compare(start1: number, end1: number, start2: number, end2: number): number {
    if (start1 > end1 || start2 > end2) {
        throw new Error(`Invalid range. start1: ${start1}, end1: ${end1}, start2: ${start2}, end2: ${end2}`);
    }
    if (start1 < start2) {
        if (end1 < start2) {
            return -100 //不相交
        }
        if (end1 < end2) {
            return 2 //1底部与2交叉
        }
        return 1 //1包含2
    } else if (start1 > start2) {
        if (start1 > end2) {
            return -100 //不相交
        }
        if (end1 > end2) {
            return -2 //1顶部与2交叉
        }
        return -1 //2包含1
    } else if (start1 === start2) {
        if (end1 === end2) {
            return 0
        }
        if (end1 > end2) {
            return 3 //1包含2，且1与2顶部齐平
        }
        return -3 //2包含1，且1与2顶部齐平
    }
}

export class JumpStmt {
    constructor(private stmt: ReturnStatement | ContinueStatement | BreakStatement, private returnScope: Scope) {
    }

    getStmt() {
        return this.stmt
    }
    getReturnScope() {
        return this.returnScope
    }
}
export class Scope {
    private startLine: number
    private endLine: number
    private parent: Scope | undefined = undefined
    private children: Scope[] = []
    private block: StatementedNode | undefined = undefined
    private kind: SyntaxKind

    private vars: Map<string, Variable> = new Map()
    private jumpStmts: Set<JumpStmt> = new Set()
    private assignExprs: Set<BinaryExpression> = new Set()
    private unaryExprs: Set<PrefixUnaryExpression | PostfixUnaryExpression> = new Set()
    private invokedVars: Map<Variable, number[]> = new Map()

    constructor(kind: SyntaxKind, block: StatementedNode, parent: Scope | undefined = undefined) {
        this.block = block
        this.kind = kind
        const stmts = block.getStatements()
        this.startLine = stmts[0].getStartLineNumber()
        this.endLine = stmts[stmts.length - 1].getEndLineNumber()
        this.parent = parent
        if (parent) {
            parent.addChild(this)
        }
    }

    getKind() {
        return this.kind
    }

    addInvokedVar(id: Identifier) {
        const vars = this.getVariables()
        if (vars.has(id.getText())) {
            if (this.invokedVars.has(vars.get(id.getText())!)) {
                this.invokedVars.get(vars.get(id.getText())!)!.push(id.getStartLineNumber())
            } else {
                this.invokedVars.set(vars.get(id.getText())!, [id.getStartLineNumber()])
            }
        }
    }

    /**
     * 获取当前作用域及所有子作用域中被调用的变量
     * @returns 被调用的变量集合
     */
    getInvokedVars() {
        const invokedVars = new Map<Variable, number[]>()
        for (const child of this.children) {
            child.getInvokedVars().forEach((line, var_) => invokedVars.set(var_, line))
        }
        this.invokedVars.forEach((line, var_) => invokedVars.set(var_, line))
        return invokedVars
    }


    updateChild(scope: Scope, newScope: Scope) {
        const index = this.children.findIndex(child => child === scope)
        if (index === -1) {
            return
        }
        this.children[index] = newScope
        newScope.parent = this

        const newEndLine = this.block.getStatements()[this.block.getStatements().length - 1].getEndLineNumber()
        for (const v of this.vars.values()) {
            if (v.getEndLine() === this.endLine) {
                v.updateRange(v.getStartLine(), newEndLine)
            }
        }
    }

    addAssignExpr(assignExpr: BinaryExpression | undefined): boolean {
        if (!assignExpr) {
            return false
        }
        this.assignExprs.add(assignExpr)
        return true
    }

    addUnaryExpr(unaryExpr: PrefixUnaryExpression | PostfixUnaryExpression | undefined): boolean {
        if (!unaryExpr) {
            return false
        }
        this.unaryExprs.add(unaryExpr)
        return true
    }
    /**
     * 获取当前作用域及所有子作用域中的赋值语句
     * @returns 赋值语句集合
     */
    getAssignExprs() {
        const assignExprs = new Set<BinaryExpression>()
        for (const child of this.children) {
            child.getAssignExprs().forEach(assignExpr => assignExprs.add(assignExpr))
        }
        this.assignExprs.forEach(assignExpr => assignExprs.add(assignExpr))
        return assignExprs
    }

    getUnaryExprs() {
        const unaryExprs = new Set<PrefixUnaryExpression | PostfixUnaryExpression>()
        for (const child of this.children) {
            child.getUnaryExprs().forEach(unaryExpr => unaryExprs.add(unaryExpr))
        }
        this.unaryExprs.forEach(unaryExpr => unaryExprs.add(unaryExpr))
        return unaryExprs
    }

    /**
     * 比较当前作用域与给定作用域的包含关系
     * @param scope 要比较的作用域
     * @returns 0 表示包含关系相等，1 表示当前作用域包含给定作用域，-1 表示当前作用域被给定作用域包含，-2 表示两者是交叉或者无关系
     */
    compare(scope: Scope): number {
        return compare(this.startLine, this.endLine, scope.startLine, scope.endLine)
    }

    compareRange(startLine: number, endLine: number): number {
        return compare(this.startLine, this.endLine, startLine, endLine)
    }

    addChild(child: Scope) {
        const index = this.children.findIndex(c => c === child)
        if (index === -1) {
            this.children.push(child)
        } else {
            this.updateChild(this.children[index], child)
        }
    }

    getChildren() {
        return this.children
    }

    getStartLine() {
        return this.startLine
    }

    getEndLine() {
        return this.endLine
    }

    getParent() {
        return this.parent
    }

    hasLine(line: number) {
        return this.startLine <= line && line <= this.endLine
    }


    addVariable(variable: Variable) {
        this.vars.set(variable.getName(), variable)
    }

    addVariables(variables: Variable[]) {
        variables.forEach(v => this.addVariable(v))
    }

    /**
     * 获取当前作用域及所有父作用域中的变量
     * @returns 变量映射表，键为变量名，值为变量对象
     */
    getVariables(containsParentVars: boolean = true) {
        const vars = new Map<string, Variable>()
        this.vars.forEach(v => vars.set(v.getName(), v))
        if (!containsParentVars) {
            return vars
        }

        let p = this.parent
        while (p) {
            p.vars.forEach(v => {
                if (!vars.has(v.getName())) {
                    vars.set(v.getName(), v)
                }
            })
            p = p.getParent()
        }
        return vars
    }


    addJumpStmt(jumpStmt: ReturnStatement | ContinueStatement | BreakStatement, returnScope: Scope) {
        this.jumpStmts.add(new JumpStmt(jumpStmt, returnScope))
    }

    /**
     * 获取当前作用域及所有子作用域中的return语句
     * @returns return语句集合
     */
    getJumpStmts(includeChild: boolean = true) {
        const returns = new Set<JumpStmt>()
        if (includeChild) {
            for (const child of this.children) {
                child.getJumpStmts().forEach(ret => returns.add(ret))
            }
        }
        this.jumpStmts.forEach(ret => returns.add(ret))
        return returns
    }
    getBlock(): StatementedNode | undefined {
        return this.block
    }

    collectChildScopeIn(startLine: number, endLine: number): Array<Scope> {
        const childScopes = new Array<Scope>()
        for (const child of this.children) {
            const compareResult = child.compareRange(startLine, endLine)
            if (compareResult === 0 || compareResult === -1) {
                childScopes.push(child)
            }
        }
        return childScopes
    }

    collectDataIn(startLine: number, endLine: number): {
        invokedVars: Set<Variable>, spilledVars: Set<Variable>, changedVars: Set<Variable>
        , jumpStmts: Array<ReturnStatement | ContinueStatement | BreakStatement>
    } {
        const spilledVars = new Set<Variable>()
        const changedVars = new Set<Variable>()
        const jumpStmts = new Array<ReturnStatement | ContinueStatement | BreakStatement>()
        const invokedVars = new Set<Variable>()
        const newVarsInRange = new Set<Variable>()

        this.vars.forEach(v => {
            switch (compare(v.getStartLine(), v.getEndLine(), startLine, endLine)) {
                case 0:
                case -1:
                case -3:
                    newVarsInRange.add(v)
                    break
                case -2:
                case 3:
                    //在新方法中声明的变量，只要它的作用域大于新方法的结束行，就认为它作用域溢出了
                    spilledVars.add(v)
                    break
            }
        })

        const allVars = this.getVariables()
        this.getAssignExprs().forEach(assignExpr => {
            if (assignExpr.getStartLineNumber() >= startLine && assignExpr.getEndLineNumber() <= endLine) {
                const left = assignExpr.getLeft()
                if (left.getKind() === SyntaxKind.PropertyAccessExpression) {
                    //属性访问表达式，比如var1.length
                    const propAcce = left.asKind(SyntaxKind.PropertyAccessExpression)!
                    const propVar = allVars.get(propAcce.getName())
                    if (propVar && !spilledVars.has(propVar) && !newVarsInRange.has(propVar)) {
                        changedVars.add(propVar)
                        invokedVars.add(propVar)
                    }
                } else if (left.getKind() === SyntaxKind.ArrayLiteralExpression) {
                    left.asKind(SyntaxKind.ArrayLiteralExpression)!.getElements().forEach(elem => {
                        if (elem.getKind() === SyntaxKind.Identifier) {
                            const elemVar = allVars.get(elem.getText())
                            if (elemVar && !spilledVars.has(elemVar) && !newVarsInRange.has(elemVar)) {
                                changedVars.add(elemVar)
                                invokedVars.add(elemVar)
                            }
                        }
                    })
                } else if (left.getKind() === SyntaxKind.Identifier) {
                    const leftVar = allVars.get(left.getText())
                    if (leftVar && !spilledVars.has(leftVar) && !newVarsInRange.has(leftVar)) {
                        changedVars.add(leftVar)
                        invokedVars.add(leftVar)
                    }
                }
            }
        })

        this.getUnaryExprs().forEach(unaryExpr => {
            if (unaryExpr.getStartLineNumber() >= startLine && unaryExpr.getEndLineNumber() <= endLine) {
                const var_ = allVars.get(unaryExpr.getOperand().getText())
                if (var_ && !spilledVars.has(var_) && !newVarsInRange.has(var_)) {
                    changedVars.add(var_)
                    invokedVars.add(var_)
                }
            }
        })

        this.getJumpStmts().forEach(jump => {
            const jumpStmt = jump.getStmt()
            if (jumpStmt.getStartLineNumber() >= startLine && jumpStmt.getEndLineNumber() <= endLine) {
                if (!(jumpStmt instanceof ReturnStatement)) {
                    if (jump.getReturnScope() === this) {
                        jumpStmts.push(jumpStmt) // 只有切分的语句是循环语句本身时，才应该把break和continue语句，传递给上层函数
                    }
                } else {
                    jumpStmts.push(jumpStmt)
                }
            }
        })

        this.invokedVars.forEach((lines, var_) => {
            if (!spilledVars.has(var_) && !newVarsInRange.has(var_) && lines.some(line => line >= startLine && line <= endLine)) {
                invokedVars.add(var_)
            }
        })

        return { invokedVars, spilledVars, changedVars, jumpStmts }
    }
}

function isUnaryExpression(stmt: ExpressionStatement): PrefixUnaryExpression | PostfixUnaryExpression | undefined {
    if (stmt.getKind() !== SyntaxKind.ExpressionStatement) {
        return undefined
    }
    const exprStmt = stmt.asKind(SyntaxKind.ExpressionStatement)!
    const expr = exprStmt.getExpression()

    if (expr.getKind() === SyntaxKind.PrefixUnaryExpression) {
        return expr.asKind(SyntaxKind.PrefixUnaryExpression)
    } else if (expr.getKind() === SyntaxKind.PostfixUnaryExpression) {
        return expr.asKind(SyntaxKind.PostfixUnaryExpression)
    }
    return undefined
}

function getReturnScope(scope: Scope): Scope {
    let curScope = scope
    while (curScope) {
        switch (curScope.getKind()) {
            case SyntaxKind.ForInStatement:
            case SyntaxKind.ForStatement:
            case SyntaxKind.ForOfStatement:
            case SyntaxKind.WhileStatement:
            case SyntaxKind.DoStatement:
            case SyntaxKind.SwitchStatement:
            case SyntaxKind.MethodDeclaration:
            case SyntaxKind.CaseClause:
            case SyntaxKind.FunctionDeclaration:
            case SyntaxKind.ArrowFunction:
                return curScope
        }
        curScope = curScope.getParent()
    }
    return scope
}

function toVariables(decls: VariableDeclarationList, endLine: number): Variable[] {
    const vars: Variable[] = []
    for (const decl of decls.getDeclarations()) {
        const nameNode = decl.getNameNode()
        if (nameNode instanceof ObjectBindingPattern) {
            nameNode.getElements().forEach(elem => {
                vars.push(new Variable(elem.getName(), toTypeText(elem.getType()), decl.getStartLineNumber(), endLine))
            })
        } else {
            vars.push(new Variable(decl.getName(), toTypeText(decl.getType()), decl.getStartLineNumber(), endLine))
        }
    }
    return vars
}
function checkStmt(stmt: Statement, parentScope: Scope) {
    switch (stmt.getKind()) {
        case SyntaxKind.VariableStatement: {
            const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
            parentScope.addVariables(toVariables(varStmt.getDeclarationList(), parentScope.getEndLine()))
            // const decls = varStmt.getDeclarations()
            // for (const decl of decls) {
            //     const nameNode = decl.getNameNode()
            //     if (nameNode instanceof ObjectBindingPattern) {
            //         nameNode.getElements().forEach(elem => {
                        // parentScope.addVariable(new Variable(elem.getName(), toTypeText(elem.getType()), varStmt.getStartLineNumber(), parentScope.getEndLine()))
            //         })
            //     } else {
            //         parentScope.addVariable(new Variable(decl.getName(), toTypeText(decl.getType()), varStmt.getStartLineNumber(), parentScope.getEndLine()))
            //     }
            // }
            break;
        }
        case SyntaxKind.ReturnStatement: {
            parentScope.addJumpStmt(stmt.asKind(SyntaxKind.ReturnStatement)!, getReturnScope(parentScope))
            break;
        }
        case SyntaxKind.ContinueStatement:
            parentScope.addJumpStmt(stmt.asKind(SyntaxKind.ContinueStatement)!, getReturnScope(parentScope))
            break
        case SyntaxKind.BreakStatement:
            parentScope.addJumpStmt(stmt.asKind(SyntaxKind.BreakStatement)!, getReturnScope(parentScope))
            break;
        case SyntaxKind.ExpressionStatement: {
            if (parentScope.addAssignExpr(isAssignmentStatement(stmt))) {
                break
            }
            if (parentScope.addUnaryExpr(isUnaryExpression(stmt.asKind(SyntaxKind.ExpressionStatement)!))) {
                break
            }
            break;
        }
        case SyntaxKind.Block:
            scanInternal(SyntaxKind.Block, stmt.asKind(SyntaxKind.Block)!, parentScope);
            break;
        case SyntaxKind.IfStatement: {
            const ifStmt = stmt.asKind(SyntaxKind.IfStatement)!;

            const thenStmt = ifStmt.getThenStatement();
            if (thenStmt.getKind() === SyntaxKind.Block) {
                scanInternal(SyntaxKind.IfStatement, thenStmt.asKind(SyntaxKind.Block)!, parentScope);
            } else {
                checkStmt(thenStmt, parentScope);
            }
            const elseStmt = ifStmt.getElseStatement()
            if (elseStmt) {
                if (elseStmt.getKind() === SyntaxKind.Block) {
                    scanInternal(SyntaxKind.IfStatement, elseStmt.asKind(SyntaxKind.Block)!, parentScope);
                } else {
                    checkStmt(elseStmt, parentScope);
                }
            }
            break;
        }
        case SyntaxKind.ForOfStatement: {
            const forOfStmt = stmt.asKind(SyntaxKind.ForOfStatement)!
            const initStmt = forOfStmt.getInitializer()
            let variables: Variable[] = []
            if (initStmt instanceof VariableDeclarationList) {
                variables = toVariables(initStmt, forOfStmt.getEndLineNumber())
                // const decls = initStmt.getDeclarations()
                // for (const decl of decls) {
                //     variables.push(new Variable(decl.getName(), toTypeText(decl.getType()), forOfStmt.getStartLineNumber(), forOfStmt.getEndLineNumber()))
                // }
            }
            scanInternal(SyntaxKind.ForOfStatement, forOfStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope, variables);
            break
        }
        case SyntaxKind.ForStatement: {
            const forStmt = stmt.asKind(SyntaxKind.ForStatement)!
            const initStmt = forStmt.getInitializer()
            let variables: Variable[] = []
            if (initStmt instanceof VariableDeclarationList) {
                variables = toVariables(initStmt, forStmt.getEndLineNumber())
                // const decls = initStmt.getDeclarations()
                // for (const decl of decls) {
                //     variables.push(new Variable(decl.getName(), toTypeText(decl.getType()), forStmt.getStartLineNumber(), forStmt.getEndLineNumber()))
                // }
            }
            scanInternal(SyntaxKind.ForStatement, forStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope, variables);
            break
        }
        case SyntaxKind.ForInStatement: {
            const forInStmt = stmt.asKind(SyntaxKind.ForInStatement)!
            const initStmt = forInStmt.getInitializer()
            let variables: Variable[] = []
            if (initStmt instanceof VariableDeclarationList) {
                variables = toVariables(initStmt, forInStmt.getEndLineNumber())
                // const decls = initStmt.getDeclarations()
                // for (const decl of decls) {
                //     variables.push(new Variable(decl.getName(), toTypeText(decl.getType()), forInStmt.getStartLineNumber(), forInStmt.getEndLineNumber()))
                // }
            }
            scanInternal(SyntaxKind.ForInStatement, forInStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope, variables);
            break
        }
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement: {
            // 这些都继承自IterationStatement，有统一的getStatement方法
            const iterStmt = stmt as IterationStatement;
            scanInternal(stmt.getKind(), iterStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            break;
        }
        case SyntaxKind.TryStatement: {
            const tryStmt = stmt.asKind(SyntaxKind.TryStatement)!;
            const catchBlock = tryStmt.getCatchClause()?.getBlock()
            const finallyBlock = tryStmt.getFinallyBlock()

            scanInternal(SyntaxKind.TryStatement, tryStmt.getTryBlock(), parentScope);
            if (catchBlock) {
                scanInternal(SyntaxKind.TryStatement, catchBlock, parentScope);
            }
            if (finallyBlock) {
                scanInternal(SyntaxKind.TryStatement, finallyBlock, parentScope);
            }
            break;
        }
        case SyntaxKind.SwitchStatement: {
            const switchStmt = stmt.asKind(SyntaxKind.SwitchStatement)!;
            const cases = switchStmt.getClauses();
            for (const caseStmt of cases) {
                scanInternal(SyntaxKind.CaseClause, caseStmt, parentScope);
            }
            break;
        }
        case SyntaxKind.LabeledStatement: {
            //FIXME 标签语句需要针对子语句进行处理
            // const labeledStmt: LabeledStatement = stmt.asKind(SyntaxKind.LabeledStatement)!;
            // if (labeledStmt.getStatement().getKind() === SyntaxKind.Block) {
            //     scanInternal(SyntaxKind.LabeledStatement, labeledStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            // } else {
            //     checkStmt(labeledStmt.getStatement(), parentScope);
            // }
            break;
        }

        // With语句（虽然在严格模式下不推荐使用）
        case SyntaxKind.WithStatement: {
            const withStmt = stmt.asKind(SyntaxKind.WithStatement)!;
            scanInternal(SyntaxKind.WithStatement, withStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            break;
        }
    }
    const ids = stmt.getDescendantsOfKind(SyntaxKind.Identifier)
    for (const id of ids) {
        parentScope.addInvokedVar(id)
    }
}

function scanInternal(kind: SyntaxKind, stmtNode: StatementedNode, parentScope: Scope | undefined = undefined, params: Variable[] = []): Scope {
    const scope = new Scope(kind, stmtNode, parentScope);
    for (const param of params) {
        scope.addVariable(param)
    }

    const stmts = stmtNode.getStatements();
    for (const stmt of stmts) {
        checkStmt(stmt, scope);
    }
    return scope
}

export function findMinScope(scope: Scope, lineNumber: number): Scope | undefined {
    if (scope.hasLine(lineNumber)) {
        let minScope = scope
        const children = scope.getChildren()
        for (let i = children.length - 1; i >= 0; i--) {
            const childScope = findMinScope(children[i], lineNumber)
            if (childScope && minScope.compare(childScope) >= 0) {//作用域相等时，优先使用子作用域
                minScope = childScope
            }
        }
        return minScope
    }
    return undefined
}

export function rebuildScope(scope: Scope): Scope {
    const block = scope.getBlock()
    const parent = scope.getParent()
    const vars = scope.getVariables(false)
    const newScope = scanInternal(scope.getKind(), block!, parent, Array.from(vars.values()))
    return newScope
}

/**
 * 递归扫描语句块中的所有语句，构建作用域树。目前仅扫描非独立块（如if、for等不拥有独立的this环境的代码块）中的语句
 * @param stmtNode 语句块节点
 * @returns 根作用域
 */
export function buildScope(kind: SyntaxKind, stmtNode: StatementedNode): Scope {
    const params: Variable[] = []
    if (stmtNode instanceof MethodDeclaration) {
        stmtNode.getParameters().forEach(param => {
            params.push(new Variable(param.getName(), toTypeText(param.getType()), stmtNode.getStartLineNumber(), stmtNode.getEndLineNumber()))
        })
    }
    return scanInternal(kind, stmtNode, undefined, params);
}