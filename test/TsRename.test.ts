import path from "node:path";
import { Project } from "ts-morph";
import { CocosInvokeGraph } from "../src/CocosInvokeGraph"
import { RenameMap } from "../src/RenameMapBuilder";
import { TsObfusBuilder } from "../src/TsObfusBuilder"
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';

const cocosDir = `${process.cwd()}/test-case/BasicCocos`
const outputDir = `${cocosDir}/output`
beforeEach(() => {
    if (existsSync(outputDir)) {
        rmdirSync(outputDir, { recursive: true })
        mkdirSync(outputDir)
    }
})
test("NormalRename", () => {
    const renames = new Map<string, RenameMap>()
    const map = new RenameMap("Helloworld", "huawei")
    map.setMethod("onClick", "kk3")
    map.setProperty("text", "tt2")
    renames.set("Helloworld", map)

    const scanner = new TsObfusBuilder().setProjectDir(cocosDir).rename( renames, "cocos").build()
    scanner.scan()
    scanner.saveSync(outputDir)

    const project = new Project({ tsConfigFilePath: path.join(cocosDir, "tsconfig.json") });
    project.addSourceFileAtPath(path.join(outputDir, "Helloworld.ts"))
    project.resolveSourceFileDependencies();

    const sourceFile = project.getSourceFile(`${outputDir}/Helloworld.ts`)!
    const cls = sourceFile.getClass("huawei")
    expect(cls).toBeDefined()
    expect(cls!.getMethod("kk3")).toBeDefined()
    expect(cls!.getProperty("tt2")).toBeDefined()
})