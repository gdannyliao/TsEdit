import path from "node:path";
import { Project } from "ts-morph";
import { RenameMap } from "../src/RenameMapBuilder";
import { TsObfusBuilder } from "../src/TsObfusBuilder"
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { runCommand } from './test_tool';

const cocosDir = `${process.cwd()}/test-case/BasicCocos`
const outputDir = `${cocosDir}/output`
const sceneFile = `${cocosDir}/assets/Scene/helloworld.fire`

function buildRenameMap(): Map<string, RenameMap> {
    const renames = new Map<string, RenameMap>()
    const map = new RenameMap("Helloworld", "huawei")
    map.setMethod("onClick", "kk3")
    map.setProperty("text", "tt2")
    renames.set("Helloworld", map)
    return renames
}

/** 源文件与场景引用的落盘步骤：先源文件，再资源文件 */
function runRename(): TsObfusBuilder {
    const builder = new TsObfusBuilder().setProjectDir(cocosDir).rename(buildRenameMap(), "cocos")
    const scanner = builder.build()
    scanner.scan()
    scanner.saveSync(outputDir)
    builder.saveSceneRefs()
    return builder
}

beforeEach(() => {
    if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true, force: true })
        mkdirSync(outputDir)
    }
})

afterEach(async () => {
    // 源文件被移动到 outputDir，场景引用是就地改写，所以跑完必须还原 fixture
    if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true, force: true })
    }
    await runCommand(`git checkout --quiet ${cocosDir}`)
})

test("NormalRename", () => {
    runRename()

    const project = new Project({ tsConfigFilePath: path.join(cocosDir, "tsconfig.json") });
    project.addSourceFileAtPath(path.join(outputDir, "Helloworld.ts"))
    project.resolveSourceFileDependencies();

    const sourceFile = project.getSourceFile(`${outputDir}/Helloworld.ts`)!
    const cls = sourceFile.getClass("huawei")
    expect(cls).toBeDefined()
    expect(cls!.getMethod("kk3")).toBeDefined()
    expect(cls!.getProperty("tt2")).toBeDefined()
})

test("SceneRefsAreRewritten", () => {
    runRename()

    // Invoke.save() 用 JSON.stringify 整体写回，去掉空白差异后再断言
    const scene = readFileSync(sceneFile, "utf-8").replace(/\s+/g, "")
    expect(scene).toContain('"handler":"kk3"')  // 方法引用：_componentId 分支
    expect(scene).toContain('"tt2":"hello"')    // 属性引用：__type__ 分支
    expect(scene).not.toContain('"onClick"')
    expect(scene).not.toContain('"text"')
})
