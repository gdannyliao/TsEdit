import {MethodSplit} from "../src/MethodSplit"
import { Project, SyntaxKind } from 'ts-morph';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';


const splitDir = `${process.cwd()}/test-case/methodSplit`
const outputDir = `${splitDir}/output`
beforeEach(() => {
    if (existsSync(outputDir)) {
        rmdirSync(outputDir, { recursive: true })
        mkdirSync(outputDir)
    }
})

test('MethodSplitWithParam',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '123')
    methodSplit.split("SplitMethodSample", "withParam")
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withParam")!
    const statements = method.getStatements()
    expect(statements.length === 1)
    const exprStmt = statements[0].asKind(SyntaxKind.ExpressionStatement)!
    const callExpr = exprStmt.getExpression().asKind(SyntaxKind.CallExpression)!
    const propExpr = callExpr.getExpression().asKind(SyntaxKind.PropertyAccessExpression)!
    const subMethodName = propExpr.getName()
    const subMethod = cls.getMethod(subMethodName)!
    expect(subMethod.getParameter("text")).toBeDefined()
    expect(subMethod.getParameters().length).toBe(1)
    expect(subMethod.getReturnType().isTuple()).toBe(true)
    expect(subMethod.getReturnType().getText()).toBe("[]")
})

test('MethodSplitWithConst',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withConst", [2, -1])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withConst")!
    const statements = method.getStatements()
    expect(statements.length === 3)
    expect(statements[2].getText()).toBe("this.z_TZ98WFiybj(constText)")
})

test('MethodSplitWithReturn',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '123')
    methodSplit.split("SplitMethodSample", "withReturn", [4, -1])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withReturn")!
    const statements = method.getStatements()
    expect(statements.length === 6)
    expect(statements[4].getText()).toBe("this.z_5WBm4a3nk7()")
    expect(statements[5].getText()).toBe(`return "returnText"`)
})

test('MethodSplitWithIf',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withIf", [2, 4])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIf")!
    const statements = method.getStatements()
    expect(statements[2].getText()).toBe("this.z_TZ98WFiybj(text)")
})


test('MethodSplitWithVar',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withVar", [4, 6])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)

    
    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withVar")!
    const statements = method.getStatements()
    expect(statements[4].getText()).toBe("let w_b_=false, r_t_:void;")
    expect(statements[5].getText()).toBe("[v1] = this.z_TZ98WFiybj(v1);")
    expect(statements[6].getText()).toBe("if (w_b_) {return r_t_;}")
    
})

test('MethodSplitWithIfReturn',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withIfReturn", [3, 6])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIfReturn")!
    const statements = method.getStatements()
    expect(statements[3].getText()).toBe("let w_b_=false, r_t_:void;")
    expect(statements[4].getText()).toBe("[w_b_] = this.z_TZ98WFiybj(text);")

    const subMethod = cls.getMethod("z_TZ98WFiybj")!.getStatements()
    expect(subMethod[1].getText().includes("return [true]")).toBe(true)
    expect(subMethod[3].getText()).toBe("return [false]")
})

test('MethodSplitwithIfReturnHasValue',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withIfReturnHasValue", [3, 7])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)


    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIfReturnHasValue")!
    const statements = method.getStatements()
    expect(statements[3].getText()).toBe("let w_b_=false, r_t_:string;")
    expect(statements[4].getText()).toBe("[w_b_,r_t_] = this.z_TZ98WFiybj(text);")

    const subMethod = cls.getMethod("z_TZ98WFiybj")!.getStatements()
    expect(subMethod[1].getText().includes(`return [true,"return1"]`)).toBe(true)
    expect(subMethod[4].getText()).toBe(`return [false,""]`)
})

test('withIfReturnAndVarChange',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withIfReturnAndVarChange", [4, 7])
    methodSplit.split("SplitMethodSample", "withIfReturnAndVarChange", [8, 11])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)

    const sourceFile = outputProject.getSourceFile(`${outputDir}/SplitMethodSample.ts`)
    const cls = sourceFile!.getClass("SplitMethodSample")!
    const method = cls.getMethod("withIfReturnAndVarChange")!
    const statements = method.getStatements()
    expect(statements[4].getText()).toBe("let w_b_=false, r_t_:string;")
    expect(statements[5].getText()).toBe("[w_b_,var1,r_t_] = this.z_TZ98WFiybj(text,var1);")

    const subMethod = cls.getMethod("z_TZ98WFiybj")!.getStatements()
    expect(subMethod[1].getText().includes(`return [true,var1,"return1"]`)).toBe(true)
    expect(subMethod[3].getText()).toBe(`return [false,var1,""]`)
})