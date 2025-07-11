import { Project } from 'ts-morph/dist/ts-morph';
import { CocosInvokeGraph } from "../src/CocosInvokeGraph";

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
})