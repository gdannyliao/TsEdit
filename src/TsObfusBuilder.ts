import { Project } from "ts-morph"
import { RenameVisitor } from "./TsRename"
import * as path from "path"
import { writeFileSync } from "fs"
import { RenameMap, RenameMapBuilder } from "./RenameMapBuilder";
import { CodeScanner } from "./CodeScanner";
import { CocosInvokeGraph } from "./CocosInvokeGraph";
import { NoopRenameSink, RenameSink } from "./RenameSink";
// import UuidUtils from "./cocos_uuid.js";
import { UuidUtils } from './UuidUtil';
import { MethodSplitVisitor2 } from "./methodSplit/MethodSplit2";

export class TsObfusBuilder {

    private projectDir: string = ""
    private willRename = false
    private willSplitMethod = false
    private keepMap: Map<string, Set<string>> | undefined
    private renameMap: Map<string, RenameMap> | undefined
    private willResetUUID = false
    private projectType:string|undefined
    /**
     * uuid 重置范围（相对 assets/ 的路径前缀）。空 = 全量（历史行为）。
     */
    private uuidScope: Array<string> = []
    /**
     * 随机种子。未显式设置时回落到 projectDir（历史行为）——见 seedOf()。
     */
    private seed: string | undefined = undefined
    /**
     * 场景引用存储。只有 cocos 工程会有；由驱动方在源文件写完之后调用 saveSceneRefs() 落盘
     */
    private sceneRefs: CocosInvokeGraph | undefined = undefined
    /**
     * build() 算出的改名映射。emitNameMap() 用它产出审计凭证——留着才能回答
     * "这次到底改了哪些符号"，否则改名是一次性随机、事后无从追溯。
     */
    private lastRenameMaps: Map<string, RenameMap> | undefined = undefined

    setProjectDir(projectDir: string): TsObfusBuilder {
        this.projectDir = projectDir
        return this
    }

    /**
     * 显式指定随机种子。
     *
     * 为什么需要：改名与拆分的随机名原先以 **projectDir** 为种子——工程的
     * 目录路径。这带来两个问题：
     *   1. 同一份源码换个目录构建 → 产物不同（不可复现，出问题难比对）
     *   2. 不同马甲包若共用目录名 → 产物相同（**差异化失效**，正是要避免的）
     * 显式种子把"产物由什么决定"变成一件可声明的事：同一个 seed 必得同一份
     * 产物（可复现、可 diff），不同包给不同 seed 则必然不同（差异化可控）。
     */
    setSeed(seed: string): TsObfusBuilder {
        this.seed = seed
        return this
    }

    /**
     * 本次实际使用的种子：显式 seed 优先，否则回落 projectDir（保持向后兼容，
     * 存量调用方与测试行为不变）。
     */
    private seedOf(): string {
        return this.seed !== undefined ? this.seed : this.projectDir
    }

    rename(renameMap: Map<string, RenameMap>|undefined=undefined, projectType: string|undefined=undefined): TsObfusBuilder {
        this.willRename = true
        if (renameMap && renameMap.size > 0) {
            this.renameMap = renameMap
        }
        this.projectType = projectType
        return this
    }

    splitMethod(): TsObfusBuilder {
        this.willSplitMethod = true
        return this
    }

    setKeepMap(keepMap: Map<string, Set<string>>): TsObfusBuilder {
        this.keepMap = keepMap
        return this
    }
    resetUUID() {
        this.willResetUUID = true
    }

    /**
     * 限定 uuid 重置范围（配合 resetUUID 使用）。参数是相对 assets/ 的路径前缀，
     * 例如 ["Piggies/"]——只重置该子目录下资源的 uuid。
     *
     * 不传 = 全量重置（历史行为）。为什么要能限定：一个 Cocos 工程里可能同时
     * 存在多个游戏/多个模块的 assets，而**只有属于本包的资源才该换身份**；
     * 引用了别人的资源却改了 uuid，运行时会找不到资源（黑屏）。
     */
    resetUUIDInScope(prefixes: Array<string>): TsObfusBuilder {
        this.willResetUUID = true
        this.uuidScope = prefixes
        return this
    }

    /**
     * 把场景引用落盘。驱动方在写完源文件之后调用，步骤顺序与改动前一致：
     * 先保存源文件，再改写资源文件里的场景引用。
     */
    saveSceneRefs(): void {
        this.sceneRefs?.saveSync()
    }

    /**
     * 产出改名审计凭证（JSON）。必须在 build() 之后调用。
     *
     * 为什么需要：改名是**一次性随机**的，跑完就没了——事后无法回答
     * "这个包和上个包有没有改到同一个名字"。落盘一份映射，差异化审计
     * 才有据可查（upCentral 的 diff_audit 拿它做跨包比对）。
     *
     * 返回结构是稳定可序列化的：{seed, classes: [{old, new, properties, methods}]}。
     * 类与成员都按旧名排序，保证同一份输入两次运行产出逐字节相同的 JSON
     * （否则凭证本身会成为噪声）。
     */
    emitNameMap(): string {
        const maps = this.lastRenameMaps
        if (maps === undefined) {
            throw new Error('emitNameMap 必须在 build() 之后调用（没有任何改名结果可导出）')
        }
        const classes = Array.from(maps.values())
            .map(m => ({
                old: m.getClassName(),
                new: m.getNewClassName(),
                properties: m.getPropertyEntries()
                    .map(([o, n]) => ({ old: o, new: n }))
                    .sort((a, b) => a.old.localeCompare(b.old)),
                methods: m.getMethodEntries()
                    .map(([o, n]) => ({ old: o, new: n }))
                    .sort((a, b) => a.old.localeCompare(b.old)),
            }))
            .sort((a, b) => a.old.localeCompare(b.old))

        return JSON.stringify({
            seed: this.seedOf(),
            seed_source: this.seed !== undefined ? 'explicit' : 'projectDir',
            classes,
        }, null, 2)
    }

    /**
     * 把改名凭证写到文件。适用场景同 emitNameMap。
     */
    writeNameMap(filePath: string): void {
        writeFileSync(filePath, this.emitNameMap(), 'utf8')
    }

    build(): CodeScanner {
        const project = new Project({ tsConfigFilePath: path.join(this.projectDir, "tsconfig.json") });
        project.resolveSourceFileDependencies();
        const scanner = new CodeScanner(project)

        if (this.willRename) {
            let sink: RenameSink
            if (this.projectType === "cocos") {
                const graph = new CocosInvokeGraph(this.projectDir, project)
                graph.parse()
                sink = graph
                this.sceneRefs = graph
                if (this.willResetUUID) {
                    if (this.uuidScope.length > 0) {
                        graph.setUuidScope(this.uuidScope)
                    }
                    const shortIds = graph.getShortIds()
                    for (const shortId of shortIds) {
                        graph.setShortId(shortId, UuidUtils.uuid())
                    }
                    console.log(`[reset-uuid] 重置 ${shortIds.size} 个 meta uuid` +
                        (this.uuidScope.length > 0 ? `（范围: ${this.uuidScope.join(', ')}）` : '（全量）'))
                }
            } else {
                sink = new NoopRenameSink()
            }

            const tsRename = new RenameVisitor(sink)

            scanner.addVisitor(tsRename)
            const [renameMaps, sdkClasses] = new RenameMapBuilder(project).specifyNames(this.renameMap).setKeepMap(this.keepMap).build(this.seedOf())
            tsRename.setRenameMap(renameMaps)
            tsRename.setSdkClasses(sdkClasses)
            this.lastRenameMaps = renameMaps
        }

        if (this.willSplitMethod) {
            const methodSplitVisitor = new MethodSplitVisitor2(this.seedOf())
            methodSplitVisitor.setKeepMap(this.keepMap)
            scanner.addVisitor(methodSplitVisitor)
        }

        return scanner
    }

}