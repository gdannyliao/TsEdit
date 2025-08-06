import { Project } from 'ts-morph';
import { CocosInvokeGraph } from "../src/CocosInvokeGraph";
import { runCommand } from './test_tool';


const cocosDir = `${process.cwd()}/test-case/BasicCocos`
afterEach(async () => {
    await runCommand(`git checkout --quiet ${cocosDir}`)
})


test('CocosInvokeGraphBasic', () => {
    const cocosDir = `${process.cwd()}/test-case/BasicCocos`
    const project = new Project({ tsConfigFilePath: `${cocosDir}/tsconfig.json` })
    project.resolveSourceFileDependencies()
    const graph = new CocosInvokeGraph(cocosDir, project)
    graph.parse()
    const labelInvokes = graph.findPropertyInvoke("Helloworld", "label")
    expect(labelInvokes).toBeDefined()
    const textInvokes = graph.findPropertyInvoke("Helloworld", "text")
    expect(textInvokes).toBeDefined()

    const methodInvokes = graph.findMethodInvoke("Helloworld", "onClick")
    expect(methodInvokes).toBeDefined()
    expect(methodInvokes![0].getFile().includes('HelloWorld.ts'))
})

test("CocosInvokeGraphChangeClsName", () => {
    const cocosDir = `${process.cwd()}/test-case/BasicCocos`
    const project = new Project({ tsConfigFilePath: `${cocosDir}/tsconfig.json` })
    project.resolveSourceFileDependencies()
    const graph = new CocosInvokeGraph(cocosDir, project)
    graph.parse()

    const newClsName = "huawei"
    graph.setClassName("Helloworld", newClsName)
    const methodInvokes = graph.findMethodInvoke(newClsName, "onClick")
    expect(methodInvokes?.length === 1)
    const labelInvoke = graph.findPropertyInvoke(newClsName, "label")
    expect(labelInvoke?.length === 1)
    const textInvoke = graph.findPropertyInvoke(newClsName, "text")
    expect(textInvoke?.length === 1)
})

test("CocosInvokeGraphChangeMethodName", () => {
    const cocosDir = `${process.cwd()}/test-case/BasicCocos`
    const project = new Project({ tsConfigFilePath: `${cocosDir}/tsconfig.json` })
    project.resolveSourceFileDependencies()
    const graph = new CocosInvokeGraph(cocosDir, project)
    graph.parse()

    const newMethodName = "kk3"
    graph.setMethodName("Helloworld", "onClick", newMethodName)
    const methodInvokes = graph.findMethodInvoke("Helloworld", newMethodName)
    expect(methodInvokes?.length === 1)
    const oldInvoke = graph.findMethodInvoke("Helloworld", "onClick")
    expect(oldInvoke?.length === 0)
})