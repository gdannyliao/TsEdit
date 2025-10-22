
import { BinaryExpression, Identifier, IterationStatement, LabeledStatement, MethodDeclaration, ReturnStatement, Statement, StatementedNode, SyntaxKind, ts, VariableStatement } from 'ts-morph';
import { isAssignmentStatement, toTypeText } from '../ASTTools.ts';

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
}

export class Scope {
    private startLine: number
    private endLine: number
    private parent: Scope | undefined = undefined
    private children: Scope[] = []
    private block: StatementedNode | undefined = undefined

    private vars: Map<string, Variable> = new Map()
    private returns: Set<ReturnStatement> = new Set()
    private assignExprs: Set<BinaryExpression> = new Set()
    private invokedVars: Map<Variable, number> = new Map()

    private varsCache: Map<string, Variable> = new Map()
    private returnCache: Set<ReturnStatement> = new Set()
    private assignExprCache: Set<BinaryExpression> = new Set()
    private invokedVarsCache: Map<Variable, number> = new Map()

    constructor(block: StatementedNode, parent: Scope | undefined = undefined) {
        this.block = block
        const stmts = block.getStatements()
        this.startLine = stmts[0].getStartLineNumber()
        this.endLine = stmts[stmts.length - 1].getEndLineNumber()
        this.parent = parent
        if (parent) {
            parent.addChild(this)
        }
    }

    addInvokedVar(id: Identifier) {
        const vars = this.getVariables()
        if (vars.has(id.getText())) {
            this.invokedVars.set(vars.get(id.getText())!, id.getStartLineNumber())
        }
        this.getParent()?.clearInvokedVarCache()
    }

    /**
     * 获取当前作用域及所有子作用域中被调用的变量
     * @returns 被调用的变量集合
     */
    getInvokedVars() {
        if (this.invokedVarsCache.size > 0) {
            return this.invokedVarsCache
        }
        for (const child of this.children) {
            child.getInvokedVars().forEach((line, var_) => this.invokedVarsCache.set(var_, line))
        }
        this.invokedVars.forEach((line, var_) => this.invokedVarsCache.set(var_, line))
        return this.invokedVarsCache
    }

    private clearInvokedVarCache() {
        this.invokedVarsCache.clear()
    }

    updateChild(scope: Scope, newScope: Scope) {
        const index = this.children.findIndex(child => child === scope)
        if (index === -1) {
            return
        }
        this.children[index] = newScope
        newScope.parent = this
        this.returnCache.clear()
        this.assignExprCache.clear()
    }

    private clearAssignCache() {
        this.assignExprCache.clear()
    }
    addAssignExpr(assignExpr: BinaryExpression | undefined) {
        if (!assignExpr) {
            return
        }
        this.assignExprs.add(assignExpr)
        this.parent?.clearAssignCache()
    }

    /**
     * 获取当前作用域及所有子作用域中的赋值语句
     * @returns 赋值语句集合
     */
    getAssignExprs() {
        if (this.assignExprCache.size > 0) {
            return this.assignExprCache
        }
        for (const child of this.children) {
            child.getAssignExprs().forEach(assignExpr => this.assignExprCache.add(assignExpr))
        }
        this.assignExprs.forEach(assignExpr => this.assignExprCache.add(assignExpr))
        return this.assignExprCache
    }

    /**
     * 比较当前作用域与给定作用域的包含关系
     * @param scope 要比较的作用域
     * @returns 0 表示包含关系相等，1 表示当前作用域包含给定作用域，-1 表示当前作用域被给定作用域包含，-2 表示两者是交叉或者无关系
     */
    compare(scope: Scope): number {
        if (this.startLine === scope.startLine && this.endLine === scope.endLine) {
            return 0
        }
        if (this.startLine <= scope.startLine && this.endLine >= scope.endLine) {
            return 1
        }
        if (this.startLine >= scope.startLine && this.endLine <= scope.endLine) {
            return -1
        }
        return -2
    }

    addChild(child: Scope) {
        this.children.push(child)
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
        this.varsCache.clear()
    }

    /**
     * 获取当前作用域及所有父作用域中的变量
     * @returns 变量映射表，键为变量名，值为变量对象
     */
    getVariables() {
        if (this.varsCache.size > 0) {
            return this.varsCache
        }
        const vars = new Map<string, Variable>()
        this.vars.forEach(v => vars.set(v.getName(), v))
        let p = this.parent
        while (p) {
            p.vars.forEach(v => {
                if (!vars.has(v.getName())) {
                    vars.set(v.getName(), v)
                }
            })
            p = p.getParent()
        }
        this.varsCache = vars
        return vars
    }

    private clearReturnCache() {
        this.returnCache.clear()
    }

    addReturn(retStmt: ReturnStatement) {
        this.parent?.clearReturnCache()
        this.returns.add(retStmt)
    }

    /**
     * 获取当前作用域及所有子作用域中的return语句
     * @returns return语句集合
     */
    getReturns() {
        if (this.returnCache.size > 0) {
            return this.returnCache
        }
        const returns = new Set<ReturnStatement>()
        for (const child of this.children) {
            child.getReturns().forEach(ret => returns.add(ret))
        }
        this.returns.forEach(ret => returns.add(ret))
        this.returnCache = returns
        return returns
    }
    getBlock(): StatementedNode | undefined {
        return this.block
    }

    collectDataIn(startLine: number, endLine: number): { invokedVars: Set<Variable>, spilledVars: Set<Variable>, changedVars: Set<Variable>, returnStmts: Set<ReturnStatement> } {
        const spilledVars = new Set<Variable>()
        const changedVars = new Set<Variable>()
        const returnStmts = new Set<ReturnStatement>()
        const invokedVars = new Set<Variable>()
        this.vars.forEach(v => {
            if ( v.getStartLine() >= startLine && v.getEndLine() > endLine) {
                //在新方法中声明的变量，只要它的作用域大于新方法的结束行，就认为它作用域溢出了
                spilledVars.add(v)
            }
        })

        const allVars = this.getVariables()
        this.getAssignExprs().forEach(assignStmt => {
            if (assignStmt.getStartLineNumber() >= startLine && assignStmt.getEndLineNumber() <= endLine) {
                const left = assignStmt.getLeft()
                if (left.getKind() === SyntaxKind.PropertyAccessExpression) {
                    //属性访问表达式，比如var1.length
                    const propAcce = left.asKind(SyntaxKind.PropertyAccessExpression)!
                    const prop = propAcce.getExpression()
                    if (prop.getKind() === SyntaxKind.Identifier) {
                        const propVar = allVars.get(prop.getText())
                        if (propVar && !spilledVars.has(propVar)) {
                            changedVars.add(propVar)
                            invokedVars.add(propVar)
                        }
                    }
                } else if (left.getKind() === SyntaxKind.ArrayLiteralExpression) {
                    left.asKind(SyntaxKind.ArrayLiteralExpression)!.getElements().forEach(elem => {
                        if (elem.getKind() === SyntaxKind.Identifier) {
                            const elemVar = allVars.get(elem.getText())
                            if (elemVar && !spilledVars.has(elemVar)) {
                                changedVars.add(elemVar)
                                invokedVars.add(elemVar)
                            }
                        }
                    })
                } else if (left.getKind() === SyntaxKind.Identifier) {
                    const leftVar = allVars.get(left.getText())
                    if (leftVar && !spilledVars.has(leftVar)) {
                        changedVars.add(leftVar)
                        invokedVars.add(leftVar)
                    }
                }
            }
        })

        this.getReturns().forEach(ret => {
            if (ret.getStartLineNumber() >= startLine && ret.getEndLineNumber() <= endLine) {
                returnStmts.add(ret)
            }
        })

        this.getInvokedVars().forEach((line, var_) => {
            if (!spilledVars.has(var_) && line >= startLine && line <= endLine) {
                invokedVars.add(var_)
            }
        })

        return { invokedVars, spilledVars, changedVars, returnStmts }
    }
}

function checkStmt(stmt: Statement, parentScope: Scope) {
    switch (stmt.getKind()) {
        case SyntaxKind.VariableStatement: {
            const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
            const decls = varStmt.getDeclarations()
            for (const decl of decls) {
                parentScope.addVariable(new Variable(decl.getName(), toTypeText(decl.getType()), varStmt.getStartLineNumber(), parentScope.getEndLine()))
            }
            break;
        }
        case SyntaxKind.ReturnStatement: {
            parentScope.addReturn(stmt.asKind(SyntaxKind.ReturnStatement)!)
            break;
        }
        case SyntaxKind.ExpressionStatement: {
            parentScope.addAssignExpr(isAssignmentStatement(stmt))
            break;
        }
        case SyntaxKind.Block:
            scanInternal(stmt.asKind(SyntaxKind.Block)!, parentScope);
            break;
        case SyntaxKind.IfStatement: {
            const ifStmt = stmt.asKind(SyntaxKind.IfStatement)!;

            const thenStmt = ifStmt.getThenStatement();
            if (thenStmt.getKind() === SyntaxKind.Block) {
                scanInternal(thenStmt.asKind(SyntaxKind.Block)!, parentScope);
            } else {
                checkStmt(thenStmt, parentScope);
            }
            const elseStmt = ifStmt.getElseStatement()
            if (elseStmt) {
                if (elseStmt.getKind() === SyntaxKind.Block) {
                    scanInternal(elseStmt.asKind(SyntaxKind.Block)!, parentScope);
                } else {
                    checkStmt(elseStmt, parentScope);
                }
            }
            break;
        }
        case SyntaxKind.ForStatement:
        case SyntaxKind.ForInStatement:
        case SyntaxKind.ForOfStatement:
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement: {
            // 这些都继承自IterationStatement，有统一的getStatement方法
            const iterStmt = stmt as IterationStatement;
            scanInternal(iterStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            break;
        }
        case SyntaxKind.TryStatement: {
            const tryStmt = stmt.asKind(SyntaxKind.TryStatement)!;
            const catchBlock = tryStmt.getCatchClause()?.getBlock()
            const finallyBlock = tryStmt.getFinallyBlock()

            scanInternal(tryStmt.getTryBlock(), parentScope);
            if (catchBlock) {
                scanInternal(catchBlock, parentScope);
            }
            if (finallyBlock) {
                scanInternal(finallyBlock, parentScope);
            }
            break;
        }
        case SyntaxKind.SwitchStatement: {
            const switchStmt = stmt.asKind(SyntaxKind.SwitchStatement)!;
            const cases = switchStmt.getClauses();
            for (const caseStmt of cases) {
                scanInternal(caseStmt, parentScope);
            }
            break;
        }
        case SyntaxKind.LabeledStatement: {
            const labeledStmt: LabeledStatement = stmt.asKind(SyntaxKind.LabeledStatement)!;
            if (labeledStmt.getStatement().getKind() === SyntaxKind.Block) {
                scanInternal(labeledStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            } else {
                checkStmt(labeledStmt.getStatement(), parentScope);
            }
            break;
        }

        // With语句（虽然在严格模式下不推荐使用）
        case SyntaxKind.WithStatement: {
            const withStmt = stmt.asKind(SyntaxKind.WithStatement)!;
            scanInternal(withStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope);
            break;
        }
    }
    const ids = stmt.getDescendantsOfKind(SyntaxKind.Identifier)
    for (const id of ids) {
        parentScope.addInvokedVar(id)
    }
}

function scanInternal(stmtNode: StatementedNode, parentScope: Scope | undefined = undefined): Scope {
    const scope = new Scope(stmtNode, parentScope);
    if (stmtNode instanceof MethodDeclaration) {
        stmtNode.getParameters().forEach(param => {
            scope.addVariable(new Variable(param.getName(), toTypeText(param.getType()), stmtNode.getStartLineNumber(), stmtNode.getEndLineNumber()))
        })
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
    const newScope = buildScope(block)
    const parent = scope.getParent()
    if (parent !== undefined) {
        parent.updateChild(scope, newScope)
    }
    return newScope
}

/**
 * 递归扫描语句块中的所有语句，构建作用域树。目前仅扫描非独立块（如if、for等不拥有独立的this环境的代码块）中的语句
 * @param stmtNode 语句块节点
 * @returns 根作用域
 */
export function buildScope(stmtNode: StatementedNode): Scope {
    return scanInternal(stmtNode);
}