import { Project } from "ts-morph"
import { InvokeGraph } from "./InvokeGraph.ts"
import { RenameVisitor } from "./TsRename.ts"
import * as path from "node:path"
import { RenameMap, RenameMapBuilder } from "./RenameMapBuilder.ts";
import { CodeScanner } from "./CodeScanner.ts";
import { MethodSplitVisitor } from "./methodSplit/MethodSplit.ts";

export class TsObfusBuilder {
    private projectDir: string = ""
    private willRename = false
    private willSplitMethod = false
    private keepMap: Map<string, Set<string>> | undefined
    private renameMap: Map<string, RenameMap> | undefined

    private graphType: (new (projectDir: string, morphProject: Project) => InvokeGraph) | undefined
    setProjectDir(projectDir: string): TsObfusBuilder {
        this.projectDir = projectDir
        return this
    }

    rename(graph: new (projectDir: string, morphProject: Project) => InvokeGraph, renameMap: Map<string, RenameMap>|undefined=undefined): TsObfusBuilder {
        this.willRename = true
        if (renameMap && renameMap.size > 0) {
            this.renameMap = renameMap
        }
        this.graphType = graph
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

    build(): CodeScanner {
        const project = new Project({ tsConfigFilePath: path.join(this.projectDir, "tsconfig.json") });
        project.resolveSourceFileDependencies();
        const scanner = new CodeScanner(project)

        if (this.willRename) {
            if (this.graphType === undefined) {
                throw new Error("请指定InvokeGraph类型")
            }
            const invokeGraph = new this.graphType(this.projectDir, project)
            invokeGraph.parse()

            scanner.addInvokeGraph(invokeGraph)
            const tsRename = new RenameVisitor(invokeGraph)

            scanner.addVisitor(tsRename)
            const [renameMaps, sdkClasses] = new RenameMapBuilder(project).specifyNames(this.renameMap).setKeepMap(this.keepMap ?? new Map()).build(this.projectDir)
            tsRename.setRenameMap(renameMaps)
            tsRename.setSdkClasses(sdkClasses)
        }

        if (this.willSplitMethod) {
            scanner.addVisitor(new MethodSplitVisitor(this.projectDir))
        }

        return scanner
    }

}