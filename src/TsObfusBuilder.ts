import { Project } from "ts-morph"
import { InvokeGraph } from "./InvokeGraph"
import { RenameVisitor } from "./TsRename"
import * as path from "path"
import { RenameMap, RenameMapBuilder } from "./RenameMapBuilder";
import { CodeScanner } from "./CodeScanner";
import { CocosInvokeGraph } from "./CocosInvokeGraph";
import { EmptyInvokeGraph } from "./EmptyInvokeGraph";
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

    setProjectDir(projectDir: string): TsObfusBuilder {
        this.projectDir = projectDir
        return this
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
    build(): CodeScanner {
        const project = new Project({ tsConfigFilePath: path.join(this.projectDir, "tsconfig.json") });
        project.resolveSourceFileDependencies();
        const scanner = new CodeScanner(project)

        if (this.willRename) {
            let invokeGraph:InvokeGraph
            if (this.projectType === "cocos") {
                const graph = new CocosInvokeGraph(this.projectDir, project)
                graph.parse()
                invokeGraph = graph
                if (this.willResetUUID) {
                    const shortIds = graph.getShortIds()
                    for (const shortId of shortIds) {
                        graph.setShortId(shortId, UuidUtils.uuid())
                    }
                }
            } else {
                invokeGraph = new EmptyInvokeGraph()
            }

            scanner.addInvokeGraph(invokeGraph)
            const tsRename = new RenameVisitor(invokeGraph)

            scanner.addVisitor(tsRename)
            const [renameMaps, sdkClasses] = new RenameMapBuilder(project).specifyNames(this.renameMap).setKeepMap(this.keepMap).build(this.projectDir)
            tsRename.setRenameMap(renameMaps)
            tsRename.setSdkClasses(sdkClasses)
        }

        if (this.willSplitMethod) {
            const methodSplitVisitor = new MethodSplitVisitor2(this.projectDir)
            methodSplitVisitor.setKeepMap(this.keepMap)
            scanner.addVisitor(methodSplitVisitor)
        }

        return scanner
    }

}