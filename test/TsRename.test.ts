import { CocosInvokeGraph } from "../src/CocosInvokeGraph"
import { TsRenameBuilder } from "../src/TsRenameBuilder"
import { runCommand } from "./test_tool"

const cocosDir = `${process.cwd()}/test-case/BasicCocos`

afterEach(async () => {
    await runCommand(`git checkout --quiet ${cocosDir}`)
})

test("TsRename", () => {
    const rename = new TsRenameBuilder().setProjectDir(cocosDir).setInvokeGraph(CocosInvokeGraph).build()
    rename.setClassName("Helloworld", "huawei")
    const clsInfo = rename.getClass("huawei")
    expect(clsInfo).toBeDefined()

    rename.setMethodName("huawei", "onClick", "kk3")
    const methodInfo = rename.getMethod("huawei", "kk3")
    expect(methodInfo).toBeDefined()

    rename.setPropertyName("huawei", "text", "tt2")
    const propertyInfo = rename.getProperty("huawei", "tt2")
    expect(propertyInfo).toBeDefined()
    rename.save()
})