import {MethodSplit} from "../src/MethodSplit"
import { Project } from 'ts-morph';
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
})

test('withIfReturnAndVarChange',  () => {
    const project = new Project()
    project.addSourceFileAtPath(`${splitDir}/SplitMethodSample.ts`)
    const methodSplit = new MethodSplit(project, '1234')
    methodSplit.split("SplitMethodSample", "withIfReturnAndVarChange", [4, 7])
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)
})