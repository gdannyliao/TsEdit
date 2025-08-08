import { runCommand } from './test_tool';
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
    methodSplit.split("SplitMethodSample", "withConst")
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
    methodSplit.split("SplitMethodSample", "withReturn")
    methodSplit.saveSync(outputDir)

    const outputProject = new Project()
    outputProject.addSourceFileAtPath(`${outputDir}/SplitMethodSample.ts`)
    const diagnostics = outputProject.getPreEmitDiagnostics()
    expect(diagnostics.length).toBe(0)
})