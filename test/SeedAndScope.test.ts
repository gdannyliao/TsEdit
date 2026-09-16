import path from "node:path";
import os from "node:os";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { TsObfusBuilder } from "../src/TsObfusBuilder";

/**
 * P1 特性测试：--seed（可复现/差异化）、--emit-name-map（审计凭证）、
 * --uuid-scope（限定 uuid 重置范围）。
 *
 * **为什么用自己的一份 fixture 拷贝**：`test-case/BasicCocos` 被
 * TsRename.test.ts / CocosInvokeGraph.test.ts / 本套件共用，而这三套都会
 * **就地改写**它（移走源文件、改写 .fire 里的引用、改 .meta 的 uuid），
 * 靠 afterEach 的 `git checkout` 还原。jest 默认并行跑套件 → 互相 clobber
 * （实测：串行 34/34 过，并行随机挂 1 个）。
 *
 * 本套件不参与这个共享：每次跑前把 fixture 复制到**系统临时目录**，
 * 在自己的副本上折腾，跑完删掉。既不干扰别人，也不被别人干扰。
 * 放 os.tmpdir() 而不是仓内：测试中途被杀（CI 超时/手动 Ctrl-C）时
 * 残留物不会脏了 git status。
 */
const srcFixture = `${process.cwd()}/test-case/BasicCocos`
let workDir: string

function freshOutput() {
    const outputDir = `${workDir}/output`
    rmSync(outputDir, { recursive: true, force: true })
    mkdirSync(outputDir, { recursive: true })
    return outputDir
}

/** 用给定 seed 跑一遍改名，返回改名凭证 JSON 文本（源文件落到 outputDir）。 */
function renameWithSeed(seed: string | undefined, scope?: Array<string>): string {
    const outputDir = freshOutput()
    const builder = new TsObfusBuilder().setProjectDir(workDir)
    if (seed !== undefined) {
        builder.setSeed(seed)
    }
    builder.rename(undefined, "cocos")
    if (scope) {
        builder.resetUUIDInScope(scope)
    }
    const scanner = builder.build()
    scanner.scan()
    scanner.saveSync(outputDir)
    builder.saveSceneRefs()
    return builder.emitNameMap()
}

function readMetaUuid(rel: string): string {
    return JSON.parse(readFileSync(path.join(workDir, 'assets', rel), 'utf8')).uuid
}

/**
 * **每个用例都从干净副本开始**：本套件里多个用例会重置 uuid / 改写场景引用，
 * 而断言里写死了 fixture 的原始 uuid。共用一份 workDir 会让前一个用例的
 * 副作用泄进后一个（实测：["Texture/"] 用例先跑，把 Texture uuid 改了，
 * 后面断言"Texture 不在范围内应保持不变"的用例就假失败）。
 * 所以 beforeAll 只建目录骨架，beforeEach 重新铺一份 fixture。
 */
beforeAll(() => {
    workDir = path.join(os.tmpdir(), `tsedit-seed-scope-${process.pid}`)
})

beforeEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    cpSync(srcFixture, workDir, { recursive: true })
})

afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
})

// ---------- --seed：可复现与差异化 ----------

test("SameSeedProducesIdenticalNameMap", () => {
    const first = renameWithSeed("captain-sweet-2026")
    const second = renameWithSeed("captain-sweet-2026")

    // 同一 seed 必得同一份产物——这是"可复现"的定义，也是出问题能比对的前提
    expect(second).toEqual(first)
})

test("DifferentSeedProducesDifferentNames", () => {
    const a = JSON.parse(renameWithSeed("pkg-a"))
    const b = JSON.parse(renameWithSeed("pkg-b"))

    // 不同 seed 必须产生不同改名——这是"差异化"的定义
    const namesA = a.classes.map((c: any) => c.new)
    const namesB = b.classes.map((c: any) => c.new)
    expect(namesB).not.toEqual(namesA)
})

test("SeedIsIndependentOfProjectDir", () => {
    // 同一个 seed 配不同 projectDir 也必须同产物：种子显式时，路径不该再影响结果。
    // （历史行为是反过来——以 projectDir 为种子，同一源码换目录就变样。）
    const viaA = renameWithSeed("fixed-seed")

    // 换一个目录名放同一份 fixture，重跑同一 seed
    const other = path.join(os.tmpdir(), `tsedit-seed-alt-${process.pid}-${Date.now()}`)
    rmSync(other, { recursive: true, force: true })
    cpSync(srcFixture, other, { recursive: true })
    try {
        const saved = workDir
        workDir = other
        const viaB = renameWithSeed("fixed-seed")
        workDir = saved
        expect(viaB).toEqual(viaA)
    } finally {
        rmSync(other, { recursive: true, force: true })
    }
})

test("NoSeedFallsBackToProjectDir", () => {
    // 不传 seed 时保持历史行为（回落 projectDir），存量调用方零改动
    const map = JSON.parse(renameWithSeed(undefined))
    expect(map.seed).toEqual(workDir)
    expect(map.seed_source).toEqual("projectDir")
})

test("ExplicitSeedIsReportedAsSuch", () => {
    // 凭证要能自证种子来源——审计时得知道这个结果是"可复现"还是"碰运气"
    const map = JSON.parse(renameWithSeed("declared"))
    expect(map.seed).toEqual("declared")
    expect(map.seed_source).toEqual("explicit")
})

// ---------- --emit-name-map：审计凭证 ----------

test("NameMapHasStableShape", () => {
    const map = JSON.parse(renameWithSeed("shape-check"))
    expect(map).toHaveProperty('seed')
    expect(map).toHaveProperty('seed_source')
    expect(Array.isArray(map.classes)).toBe(true)
    expect(map.classes.length).toBeGreaterThan(0)

    const cls = map.classes[0]
    expect(cls).toHaveProperty('old')
    expect(cls).toHaveProperty('new')
    expect(Array.isArray(cls.properties)).toBe(true)
    expect(Array.isArray(cls.methods)).toBe(true)
})

test("NameMapIsSortedForByteStability", () => {
    // 排序保证同一输入两次运行产出逐字节相同的 JSON——否则凭证本身是噪声
    const map = JSON.parse(renameWithSeed("sort-check"))
    const olds = map.classes.map((c: any) => c.old)
    expect(olds).toEqual([...olds].sort())

    for (const cls of map.classes) {
        const pOlds = cls.properties.map((p: any) => p.old)
        expect(pOlds).toEqual([...pOlds].sort())
        const mOlds = cls.methods.map((m: any) => m.old)
        expect(mOlds).toEqual([...mOlds].sort())
    }
})

test("NameMapRecordsActualRenames", () => {
    // 凭证要能回答"到底改了哪些符号"——Helloworld 类必须出现在里面
    const map = JSON.parse(renameWithSeed("record-check"))
    const cls = map.classes.find((c: any) => c.old === "Helloworld")
    expect(cls).toBeDefined()
    expect(cls.new).not.toEqual("Helloworld")  // 真的改了，不是原样保留
})

test("EmitNameMapBeforeBuildThrows", () => {
    // 没 build 就没有改名结果，此时导出应当是响亮错误而不是空凭证
    const builder = new TsObfusBuilder().setProjectDir(workDir).rename(undefined, "cocos")
    expect(() => builder.emitNameMap()).toThrow(/build/)
})

test("WriteNameMapWritesFile", () => {
    const outputDir = freshOutput()
    const dest = path.join(outputDir, "name-map.json")
    const builder = new TsObfusBuilder().setProjectDir(workDir).setSeed("write-check")
    builder.rename(undefined, "cocos")
    const scanner = builder.build()
    scanner.scan()
    scanner.saveSync(outputDir)
    builder.saveSceneRefs()
    builder.writeNameMap(dest)

    expect(existsSync(dest)).toBe(true)
    const parsed = JSON.parse(readFileSync(dest, "utf8"))
    expect(parsed.seed).toEqual("write-check")
})

// ---------- --uuid-scope：限定重置范围 ----------

test("UuidScopeOnlyResetsMatchingPrefix", () => {
    // 只重置 Scene/ 下的 uuid，Script/ 必须原样不动
    const scriptBefore = readMetaUuid('Script/Helloworld.ts.meta')

    renameWithSeed("scope-check", ["Scene/"])

    expect(readMetaUuid('Script/Helloworld.ts.meta')).toEqual(scriptBefore)
})

test("UuidScopeDoesResetInRange", () => {
    // 范围内必须真的换掉（与上一条配对：一个验"不动"，一个验"动了"）
    const before = readMetaUuid('Scene/helloworld.fire.meta')
    renameWithSeed("scope-moves", ["Scene/"])
    expect(readMetaUuid('Scene/helloworld.fire.meta')).not.toEqual(before)
})

test("UuidScopePrefixBoundaryIsRespected", () => {
    // 只给 Texture/，"Script/Helloworld.ts.meta" 不该被误伤
    const before = readMetaUuid('Script/Helloworld.ts.meta')
    renameWithSeed("boundary-check", ["Texture/"])
    expect(readMetaUuid('Script/Helloworld.ts.meta')).toEqual(before)
})

test("EmptyScopeMeansFullReset", () => {
    // 不传范围 = 全量重置（历史行为），Script/ 与 Scene/ 都该换
    const scriptBefore = readMetaUuid('Script/Helloworld.ts.meta')
    const sceneBefore = readMetaUuid('Scene/helloworld.fire.meta')

    const outputDir = freshOutput()
    const builder = new TsObfusBuilder().setProjectDir(workDir).setSeed("full-check")
    builder.rename(undefined, "cocos")
    builder.resetUUID()
    const scanner = builder.build()
    scanner.scan()
    scanner.saveSync(outputDir)
    builder.saveSceneRefs()

    expect(readMetaUuid('Script/Helloworld.ts.meta')).not.toEqual(scriptBefore)
    expect(readMetaUuid('Scene/helloworld.fire.meta')).not.toEqual(sceneBefore)
})

test("ScopedResetStillRewritesSceneReferences", () => {
    // 改了 uuid 之后场景引用必须仍然可解析，否则运行时找不到资源（黑屏）。
    // 这是 uuid 重命名最容易踩的坑：改了被引用者的身份，却没改引用点。
    //
    // 注意 Texture 的引用走的是 **subMetas** 里的 sprite-frame uuid
    // （HelloWorld.png.meta 顶层 uuid 是 texture 本身，场景引用的是子资源），
    // 所以不能拿顶层 uuid 去比对——那会误报。
    renameWithSeed("resolvable-check", ["Scene/"])

    const scene = readFileSync(path.join(workDir, 'assets/Scene/helloworld.fire'), 'utf8')
    expect(() => JSON.parse(scene)).not.toThrow()

    const meta = JSON.parse(readFileSync(
        path.join(workDir, 'assets/Texture/HelloWorld.png.meta'), 'utf8'))
    const spriteFrameUuid = meta.subMetas['HelloWorld'].uuid

    // Texture/ 不在重置范围内 → 它的 uuid 与引用点都应保持原值
    expect(meta.uuid).toEqual('6aa0aa6a-ebee-4155-a088-a687a6aadec4')
    expect(scene).toContain(spriteFrameUuid)
})

test("InScopeResetKeepsRawTextureUuidConsistent", () => {
    // subMetas 的 rawTextureUuid 指回父资源：重置父 uuid 时这个反向引用
    // 必须一起改，否则 sprite-frame 找不到贴图。锁住这条一致性的现状。
    renameWithSeed("rawtex-check", ["Texture/"])
    const meta = JSON.parse(readFileSync(
        path.join(workDir, 'assets/Texture/HelloWorld.png.meta'), 'utf8'))
    expect(meta.subMetas['HelloWorld'].rawTextureUuid).toEqual(meta.uuid)
})