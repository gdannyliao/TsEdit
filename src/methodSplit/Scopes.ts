
import { ArrayBindingPattern, BinaryExpression, BindingElement, Block, BreakStatement, ContinueStatement, ExpressionStatement, Identifier, IterationStatement, MethodDeclaration, ObjectBindingPattern, PostfixUnaryExpression, PrefixUnaryExpression, ReturnStatement, Statement, StatementedNode, SyntaxKind, Type, VariableDeclaration, VariableDeclarationList } from 'ts-morph';
import { isAssignmentStatement, isUnaryExpression } from '../ASTTools';

export class Variable {
    constructor(private name: string, private type: Type, private startLine: number, private endLine: number,
        /** 声明在源码中的起点。行号无法区分“循环头”与“同一行的循环体”，位置可以。 */
        private startPos: number = -1) {
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

    getStartPos() {
        return this.startPos
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
    // Should never reach here, but TypeScript requires a return
    return -100
}

export class JumpStmt {
    constructor(private stmt: ReturnStatement | ContinueStatement | BreakStatement, private returnScope: Scope) {
    }

    getStmt() {
        return this.stmt
    }

    setStmt(stmt: ReturnStatement | ContinueStatement | BreakStatement) {
        this.stmt = stmt
    }

    /**
     * 获取break、continue中断时指向的scope，或是return返回时指向的scope
     * @returns 
     */
    getReturnScope() {
        return this.returnScope
    }
}
export class Scope {
    private startLine: number
    private endLine: number
    private parent: Scope | undefined = undefined
    private children: Map<number, Scope> = new Map()
    private block: StatementedNode | undefined = undefined
    private kind: SyntaxKind

    private vars: Map<string, Variable> = new Map()
    private jumpStmts: Set<JumpStmt> = new Set()
    private assignExprs: Set<BinaryExpression> = new Set()
    private unaryExprs: Set<PrefixUnaryExpression | PostfixUnaryExpression> = new Set()
    private invokedVars: Map<Variable, number[]> = new Map()

    constructor(kind: SyntaxKind, block: StatementedNode, parent: Scope | undefined = undefined, start: number = -1) {
        this.block = block
        this.kind = kind
        const stmts = block.getStatements()
        if (start === -1)
            this.startLine = stmts[0].getStartLineNumber()
        else
            this.startLine = start
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
        for (const child of this.children.values()) {
            child.getInvokedVars().forEach((line, var_) => invokedVars.set(var_, line))
        }
        this.invokedVars.forEach((line, var_) => invokedVars.set(var_, line))
        return invokedVars
    }


    updateChild(scope: Scope, newScope: Scope) {
        this.children.set(scope.startLine, newScope)
        newScope.parent = this

        const statements = this.block?.getStatements()
        if (statements && statements.length > 0) {
            const newEndLine = statements[statements.length - 1].getEndLineNumber()
            for (const v of this.vars.values()) {
                if (v.getEndLine() === this.endLine) {
                    v.updateRange(v.getStartLine(), newEndLine)
                }
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
        for (const child of this.children.values()) {
            child.getAssignExprs().forEach(assignExpr => assignExprs.add(assignExpr))
        }
        this.assignExprs.forEach(assignExpr => assignExprs.add(assignExpr))
        return assignExprs
    }

    getUnaryExprs() {
        const unaryExprs = new Set<PrefixUnaryExpression | PostfixUnaryExpression>()
        for (const child of this.children.values()) {
            child.getUnaryExprs().forEach(unaryExpr => unaryExprs.add(unaryExpr))
        }
        this.unaryExprs.forEach(unaryExpr => unaryExprs.add(unaryExpr))
        return unaryExprs
    }

    /**
     * 比较当前作用域与给定作用域的包含关系
     * @param scope 要比较的作用域
    * @returns 0：相等， 1：1包含2， 2：1底部与2交叉，3：1包含2，且1与2顶部齐平 -1：2包含1， -2：1顶部与2交叉， -3：2包含1，且1与2顶部齐平， -100：不相交
     */
    compare(scope: Scope): number {
        return compare(this.startLine, this.endLine, scope.startLine, scope.endLine)
    }

    compareRange(startLine: number, endLine: number): number {
        return compare(this.startLine, this.endLine, startLine, endLine)
    }

    addChild(child: Scope) {
        if (!this.children.has(child.startLine)) {
            this.children.set(child.startLine, child)
        } else {
            const existingChild = this.children.get(child.startLine)
            if (existingChild !== undefined) {
                this.updateChild(existingChild, child)
            }
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

    addVariable(variable: Variable) {
        const old = this.vars.get(variable.getName())
        this.vars.set(variable.getName(), variable)
        if (old !== undefined && old !== variable && this.invokedVars.has(old)) {
            // rebuildScope 会把旧变量当参数传进来，随后重新扫描时又为同一声明
            // 创建了一个新 Variable。若不移交引用记录，invokedVars 会一直指向
            // 旧对象，与新 vars 里的对象“同名但不同身份”，导致它既被当成
            // 已注入参数、又被当成新方法内的局部声明（Duplicate identifier）。
            const lines = this.invokedVars.get(old)!
            this.invokedVars.delete(old)
            const existing = this.invokedVars.get(variable)
            this.invokedVars.set(variable, existing === undefined ? lines : existing.concat(lines))
        }
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
            for (const child of this.children.values()) {
                child.getJumpStmts().forEach(ret => returns.add(ret))
            }
        }
        this.jumpStmts.forEach(ret => returns.add(ret))
        return returns
    }
    getBlock(): StatementedNode | undefined {
        return this.block
    }

    collectDataIn(startLine: number, endLine: number, startPos: number = -1, endPos: number = -1): {
        invokedVars: Set<Variable>, spilledVars: Set<Variable>, changedVars: Set<Variable>
        , jumpStmts: Array<JumpStmt>
    } {
        const spilledVars = new Set<Variable>()
        const changedVars = new Set<Variable>()
        const jumpStmts = new Array<JumpStmt>()
        const invokedVars = new Set<Variable>()
        const newVarsInRange = new Set<Variable>()

        this.vars.forEach(v => {
            // 行号无法区分“循环头里的绑定”和“同一行的循环体”：单行
            // `for (const x of xs) { use(x) }` 中 x 与循环体同处一行，
            // 旧的按行比较会把 x 当成“在拆分范围内新声明的变量”，从而
            // 既不传参也不返回，产出 `Cannot find name 'x'`。
            // 声明位置不在拆分范围内的，一定是外部变量（循环头、外层 let、
            // 方法参数），或在本次拆分之后才声明；都不能算进新方法自己的变量。
            if (startPos >= 0 && endPos >= 0 && v.getStartPos() >= 0 &&
                (v.getStartPos() < startPos || v.getStartPos() > endPos)) {
                return
            }
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
                    switch (jump.getReturnScope().compare(this)) {
                        case 0:
                        case 1:
                        case 3:
                            jumpStmts.push(jump) // 切分的语句在ReturnScope中时，才应该把break和continue语句，传递给上层函数

                    }
                } else {
                    jumpStmts.push(jump)
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
        const parent = curScope.getParent()
        if (parent === undefined) {
            return scope
        }
        curScope = parent
    }
    return scope
}

function toVariable(decl: VariableDeclaration, endLine: number): Variable[] {
    const vars: Variable[] = []
    const nameNode = decl.getNameNode()
    if (nameNode instanceof ObjectBindingPattern) {
        nameNode.getElements().forEach(elem => {
            vars.push(new Variable(elem.getName(), elem.getType(), decl.getStartLineNumber(), endLine, decl.getStart()))
        })
    } else if (nameNode instanceof ArrayBindingPattern) {
        nameNode.getElements().forEach(elem => {
            if (elem instanceof BindingElement) {
                vars.push(new Variable(elem.getName(), elem.getType(), decl.getStartLineNumber(), endLine, decl.getStart()))
            }
        })
    } else {
        vars.push(new Variable(decl.getName(), decl.getType(), decl.getStartLineNumber(), endLine, decl.getStart()))
    }
    return vars
}
function toVariables(decls: VariableDeclarationList, endLine: number): Variable[] {
    const vars: Variable[] = []
    for (const decl of decls.getDeclarations()) {
        vars.push(...toVariable(decl, endLine))
    }
    return vars
}

/**
 * 循环体/with 体可能是单条语句而不是 Block（`for (...) touch(x);`）。
 *
 * 原来的调用点用 `asKind(SyntaxKind.Block)!` 把 undefined 掩盖成 Block，
 * 随后 `Scope` 构造时 `block.getStatements()` 直接崩溃。这里把非 Block
 * 的体包成 Block，只增加一对花括号、不改变行数，后续的作用域分析与拆分
 * 就能继续面对真正的 Block。
 */
function ensureBlock(stmt: Statement): Block {
    if (stmt instanceof Block) {
        return stmt
    }
    return stmt.replaceWithText(`{ ${stmt.getText()} }`).asKindOrThrow(SyntaxKind.Block)
}
function checkStmt(stmt: Statement, parentScope: Scope) {
    switch (stmt.getKind()) {
        case SyntaxKind.VariableStatement: {
            const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!
            parentScope.addVariables(toVariables(varStmt.getDeclarationList(), parentScope.getEndLine()))
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
                scanInternal(SyntaxKind.IfStatement, thenStmt.asKind(SyntaxKind.Block)!, parentScope, undefined, stmt.getStartLineNumber());
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
            }
            scanInternal(SyntaxKind.ForOfStatement, ensureBlock(forOfStmt.getStatement()), parentScope, variables, stmt.getStartLineNumber());
            break
        }
        case SyntaxKind.ForStatement: {
            const forStmt = stmt.asKind(SyntaxKind.ForStatement)!
            const initStmt = forStmt.getInitializer()
            let variables: Variable[] = []
            if (initStmt instanceof VariableDeclarationList) {
                variables = toVariables(initStmt, forStmt.getEndLineNumber())
            }
            scanInternal(SyntaxKind.ForStatement, ensureBlock(forStmt.getStatement()), parentScope, variables, stmt.getStartLineNumber());
            break
        }
        case SyntaxKind.ForInStatement: {
            const forInStmt = stmt.asKind(SyntaxKind.ForInStatement)!
            const initStmt = forInStmt.getInitializer()
            let variables: Variable[] = []
            if (initStmt instanceof VariableDeclarationList) {
                variables = toVariables(initStmt, forInStmt.getEndLineNumber())
            }
            scanInternal(SyntaxKind.ForInStatement, ensureBlock(forInStmt.getStatement()), parentScope, variables, stmt.getStartLineNumber());
            break
        }
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement: {
            // 这些都继承自IterationStatement，有统一的getStatement方法
            const iterStmt = stmt as IterationStatement;
            scanInternal(stmt.getKind(), ensureBlock(iterStmt.getStatement()), parentScope, undefined, stmt.getStartLineNumber());
            break;
        }
        case SyntaxKind.TryStatement: {
            const tryStmt = stmt.asKind(SyntaxKind.TryStatement)!;
            const catchClause = tryStmt.getCatchClause()
            const finallyBlock = tryStmt.getFinallyBlock()

            scanInternal(SyntaxKind.TryStatement, tryStmt.getTryBlock(), parentScope, undefined, tryStmt.getStartLineNumber());
            if (catchClause) {
                const varDecl = catchClause.getVariableDeclaration()
                if (varDecl !== undefined) {
                    const vars = toVariable(varDecl, catchClause.getEndLineNumber())
                    scanInternal(SyntaxKind.TryStatement, catchClause.getBlock(), parentScope, vars, catchClause.getStartLineNumber());
                } else {
                    scanInternal(SyntaxKind.TryStatement, catchClause.getBlock(), parentScope, undefined, catchClause.getStartLineNumber());
                }
            }
            if (finallyBlock) {
                scanInternal(SyntaxKind.TryStatement, finallyBlock, parentScope, undefined, finallyBlock.getStartLineNumber());
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
            scanInternal(SyntaxKind.WithStatement, ensureBlock(withStmt.getStatement()), parentScope, undefined, stmt.getStartLineNumber());
            break;
        }
    }
    const ids = stmt.getDescendantsOfKind(SyntaxKind.Identifier)
    for (const id of ids) {
        parentScope.addInvokedVar(id)
    }
}

function scanInternal(kind: SyntaxKind, stmtNode: StatementedNode, parentScope: Scope | undefined = undefined, params: Variable[] = [], start: number = -1): Scope {
    const scope = new Scope(kind, stmtNode, parentScope, start);
    for (const param of params) {
        scope.addVariable(param)
    }

    const stmts = stmtNode.getStatements();
    for (const stmt of stmts) {
        checkStmt(stmt, scope);
    }
    return scope
}


export function rebuildScope(scope: Scope): Scope {
    const block = scope.getBlock()
    const parent = scope.getParent()
    const vars = scope.getVariables(false)
    const newScope = scanInternal(scope.getKind(), block!, parent, Array.from(vars.values()), scope.getStartLine())
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
            params.push(new Variable(param.getName(), param.getType(), stmtNode.getStartLineNumber(), stmtNode.getEndLineNumber(), param.getStart()))
        })
    }
    return scanInternal(kind, stmtNode, undefined, params);
}