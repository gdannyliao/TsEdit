import { MethodSplitVisitor2 } from "../src/methodSplit/MethodSplit2"
import { ClassDeclaration, MethodDeclaration, Project, SourceFile, SyntaxKind } from 'ts-morph';
import { existsSync, mkdirSync, rmSync } from 'node:fs';


const splitDir = `${process.cwd()}/test-case/methodSplit`
const outputDir = `${splitDir}/output`

function newFixtureProject(): Project {
    const project = new Project()
    project.addSourceFilesAtPaths(`${splitDir}/*.ts`)
    return project
}

/** 取出输出工程，并在 strict 下断言生成的代码没有类型错误 */
function loadOutputProject(): Project {
    const project = new Project({ compilerOptions: { strict: true } })
    project.addSourceFilesAtPaths(`${outputDir}/*.ts`)
    expect(diagnosticTexts(project)).toEqual([])
    return project
}

function diagnosticTexts(project: Project): string[] {
    return project.getPreEmitDiagnostics().map(d => {
        const message = d.getMessageText()
        return typeof message === "string" ? message : message.getMessageText()
    })
}

beforeEach(() => {
    if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true, force: true })
        mkdirSync(outputDir)
    }
})

function getMethod(project: Project, clsName: string, methodName: string):[ClassDeclaration|undefined, MethodDeclaration|undefined] {
    const [sourceFile, classDecl, method] = getFileMethod(project, clsName, methodName)
    return [classDecl, method]
}
function getFileMethod(project: Project, clsName: string, methodName: string):[SourceFile|undefined, ClassDeclaration|undefined, MethodDeclaration|undefined] {
    const sourceFile = project.getSourceFile(`${splitDir}/SplitMethodSample.ts`)
    if (!sourceFile) {
        return [undefined, undefined, undefined]
    }
    const classDecl = sourceFile.getClass(clsName)
    if (!classDecl) {
        return [undefined, undefined, undefined]
    }
    const method = classDecl.getMethod(methodName)
    if (!method) {
        return [undefined, undefined, undefined]
    }
    return [sourceFile, classDecl, method]
}

function saveSync(project: Project, outputDir?: string) {
    for (const file of project.getSourceFiles()) {
        if (outputDir) {
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true })
            }
            file.moveToDirectory(outputDir)
        }
        file.saveSync()
    }
}

test('MethodSplitWithParam', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withParam")!)
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withParam")!
    const statements = method.getStatements()
    expect(statements.length).toBe(6)
    let exprStmt = statements[2].asKind(SyntaxKind.ExpressionStatement)!
    let callExpr = exprStmt.getExpression().asKind(SyntaxKind.CallExpression)!
    let propExpr = callExpr.getExpression().asKind(SyntaxKind.PropertyAccessExpression)!
    let subMethodName = propExpr.getName()
    let subMethod = cls.getMethod(subMethodName)!
    expect(subMethod.getParameters().length).toBe(1)
    expect(subMethod.getParameters()[0].getName()).toBe("text")

    exprStmt = statements[5].asKind(SyntaxKind.ExpressionStatement)!
    callExpr = exprStmt.getExpression().asKind(SyntaxKind.CallExpression)!
    propExpr = callExpr.getExpression().asKind(SyntaxKind.PropertyAccessExpression)!
    subMethodName = propExpr.getName()
    subMethod = cls.getMethod(subMethodName)!
    expect(subMethod.getParameters().length).toBe(0)
})

test('MethodSplitWithConst', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withConst")!, [2, 5])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withConst")!
    const statements = method.getStatements()
    expect(statements.length).toBe(8)
    expect(statements[2].getText()).toBe("this.z_TZ98WFiybj(constText);")
})

test('MethodSplitIncludeConst', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withConst")!, [1, 5])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withConst")!
    const statements = method.getStatements()
    expect(statements.length).toBe(8)
    expect(statements[1].getText()).toBe("let constText:string;")
    expect(statements[2].getText()).toBe("[constText] = this.z_TZ98WFiybj();")
})

test('MethodSplitWithReturn', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('123')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withReturn")!, [4, -1])
    saveSync(project, outputDir)

    // 拆分范围吃掉了方法末句 return：调用方只剩 if (w_b_0) {return r_t_1}，末尾必须补一句不可达的 throw，
    // 否则 strict 下是 TS2366（诊断由 loadOutputProject 把关）
    const outputProject = loadOutputProject()

    const cls = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withReturn")!
    const statements = method.getStatements()
    expect(statements[3].getText()).toBe(`console.log("line4")`)
    expect(statements[5].getText()).toBe(`[w_b_0,r_t_1] = this.z_5WBm4a3nk7();`)
    expect(statements[statements.length - 1].getText())
        .toBe(`throw new Error("tsedit: unreachable after split z_5WBm4a3nk7");`)
})


test('MethodSplitWithReturn2', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('123')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withReturn")!, [4, 8])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withReturn")!
    const statements = method.getStatements()
    expect(statements.length).toBe(6)
    expect(statements[4].getText()).toBe(`this.z_5WBm4a3nk7();`)
    expect(statements[5].getText()).toBe(`return "returnText"`)
})

test('MethodSplitWithIf', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withIf")!, [2, 4])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIf")!
    const statements = method.getStatements()
    expect(statements[2].getText()).toBe("this.z_TZ98WFiybj(text);")
})


test('MethodSplitWithVar', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withVar")!, [4, 6])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withVar")!
    const statements = method.getStatements()
    expect(statements[4].getText()).toBe("[v1] = this.z_TZ98WFiybj(v1);")

})

test('MethodSplitWithIfReturn', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    let [sourceFile, cls, method] = getFileMethod(project, "SplitMethodSample", "withIfReturn")!
    if (!sourceFile) {
        throw new Error('sourceFile is undefined')
    }
    methodSplit.visitFile(sourceFile)
    // @ts-ignore
    methodSplit.visitMethodInternal(cls, method, [3, 6])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    cls = sourceFile!.getClass("SplitMethodSample")!
    method = cls.getMethod("withIfReturn")!
    const statements = method.getStatements()
    expect(statements[3].getText()).toBe("let w_b_0:boolean;")
    expect(statements[4].getText()).toBe("[w_b_0] = this.z_s19sFadh5Q(text);")

    const subMethod = cls.getMethod("z_s19sFadh5Q")!.getStatements()
    expect(subMethod[1].getText().includes("return [true]")).toBe(true)
    expect(subMethod[3].getText()).toBe("return [false]")
})

test('MethodSplitwithIfReturnHasValue', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withIfReturnHasValue")!, [3, 7])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIfReturnHasValue")!
    const statements = method.getStatements()
    expect(statements[3].getText()).toBe(`let w_b_0:boolean,r_t_1 = (undefined as unknown as string);`)
    expect(statements[4].getText()).toBe("[w_b_0,r_t_1] = this.z_s19sFadh5Q(text);")

    const subMethod = cls.getMethod("z_s19sFadh5Q")!.getStatements()
    expect(subMethod[1].getText().includes(`return [true,r_t_1]`)).toBe(true)
    expect(subMethod[4].getText()).toBe(`return [false,(undefined as unknown as string)]`)
})

test('withIfReturnAndVarChange', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withIfReturnAndVarChange")!, [4, 7])
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withIfReturnAndVarChange")!, [8, 11])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIfReturnAndVarChange")!
    const statements = method.getStatements()
    expect(statements[4].getText()).toBe(`let w_b_0:boolean,r_t_1 = (undefined as unknown as string);`)
    expect(statements[5].getText()).toBe("[w_b_0,var1,r_t_1] = this.z_s19sFadh5Q(var1,text);")

    const subMethod = cls.getMethod("z_s19sFadh5Q")!.getStatements()
    expect(subMethod[1].getText().includes(`return [true,var1,r_t_1]`)).toBe(true)
    expect(subMethod[3].getText()).toBe(`return [false,var1,(undefined as unknown as string)]`)
})

test('withAsyncIfReturnAndVarChange', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withAsyncIfReturnAndVarChange")!, [4, 7])
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withAsyncIfReturnAndVarChange")!, [8, 11])
    saveSync(project, outputDir)

    const outputProject = loadOutputProject()

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withAsyncIfReturnAndVarChange")!
    const statements = method.getStatements()
    expect(statements[4].getText()).toBe(`let w_b_0:boolean,r_t_1 = (undefined as unknown as string);`)
    expect(statements[5].getText()).toBe(`[w_b_0,var1,r_t_1] = this.z_s19sFadh5Q(var1,text);`)

    const subMethod = cls.getMethod("z_s19sFadh5Q")!.getStatements()
    expect(subMethod[1].getText().includes(`return [true,var1,r_t_1]`)).toBe(true)
    expect(subMethod[3].getText()).toBe(`return [false,var1,(undefined as unknown as string)]`)
})

test('MethodSplitWithArrayReturn', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withArrayReturn")!, [3, 6])
    saveSync(project, outputDir)

    const cls = loadOutputProject().getSourceFile(`${outputDir}/SplitMethodSample.ts`)!.getClass("SplitMethodSample")!
    const statements = cls.getMethod("withArrayReturn")!.getStatements()
    // 数组没有可用的自然零值，占位值是一条渲染成 string[] 的断言
    expect(statements[3].getText()).toBe(`let w_b_0:boolean,r_t_1 = (undefined as unknown as string[]);`)
    expect(statements[4].getText()).toMatch(/^\[w_b_0,r_t_1\] = this\.z_\w+\(a,flag\);$/)

    const subMethod = cls.getMethods().find(m => m.getName().startsWith("z_"))!
    expect(subMethod.getReturnTypeNode()!.getText()).toBe("[boolean,string[]]")
    expect(subMethod.getStatements()[subMethod.getStatements().length - 1].getText())
        .toBe(`return [false,(undefined as unknown as string[])]`)
})

test('MethodSplitWithUnionReturn', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withUnionReturn")!, [2, 5])
    saveSync(project, outputDir)

    const cls = loadOutputProject().getSourceFile(`${outputDir}/SplitMethodSample.ts`)!.getClass("SplitMethodSample")!
    const statements = cls.getMethod("withUnionReturn")!.getStatements()
    expect(statements[2].getText()).toBe(`let w_b_0:boolean,r_t_1 = (undefined as unknown as string | number);`)

    const subMethod = cls.getMethods().find(m => m.getName().startsWith("z_"))!
    expect(subMethod.getReturnTypeNode()!.getText()).toBe("[boolean,string | number]")
})

test('MethodSplitWithImportedType', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withImportedType")!, [3, 6])
    saveSync(project, outputDir)

    // 类型在生成位置不可引用时退化成 any，而不是照模块路径猜一个不存在的名字（那会留下 Cannot find name）
    const cls = loadOutputProject().getSourceFile(`${outputDir}/SplitMethodSample.ts`)!.getClass("SplitMethodSample")!
    const subMethod = cls.getMethods().find(m => m.getName().startsWith("z_"))!
    expect(subMethod.getParameters().map(p => p.getText())).toEqual(["thing: any", "flag: boolean"])
})

test('MethodSplitWithSpilledArray', () => {
    const project = newFixtureProject()
    const methodSplit = new MethodSplitVisitor2('1234')
    // @ts-ignore
    methodSplit.visitMethodInternal(...getMethod(project, "SplitMethodSample", "withSpilledArray")!, [2, 6])
    saveSync(project, outputDir)

    const cls = loadOutputProject().getSourceFile(`${outputDir}/SplitMethodSample.ts`)!.getClass("SplitMethodSample")!
    const statements = cls.getMethod("withSpilledArray")!.getStatements()
    expect(statements[2].getText()).toBe(`let w_b_0:boolean,arr:string[],r_t_1 = (undefined as unknown as number);`)

    // 跳转语句排在 arr 声明之前，那个槽位同样要拿到能编译的占位值
    const subMethod = cls.getMethods().find(m => m.getName().startsWith("z_"))!
    expect(subMethod.getText()).toContain(`return [true,(undefined as unknown as string[]),0]`)
})
