import { Project } from "ts-morph"
import { InvokeGraph } from "./InvokeGraph.ts"
import { TsRename } from "./TsRename.ts"
import * as path from "node:path"

export class TsRenameBuilder {
    private projectDir: string = ""
    private graphType: (new (projectDir: string, morphProject: Project) => InvokeGraph) | undefined
    setProjectDir(projectDir: string): TsRenameBuilder {
        this.projectDir = projectDir
        return this
    }

    setInvokeGraph(graph: new (projectDir: string, morphProject: Project) => InvokeGraph): TsRenameBuilder {
        this.graphType = graph
        return this
    }

    build(): TsRename {
        const project = new Project({ tsConfigFilePath: path.join(this.projectDir, "tsconfig.json") });
        project.resolveSourceFileDependencies();
        if (this.graphType === undefined) {
            throw new Error("请指定InvokeGraph类型")
        }
        const invokeGraph = new this.graphType(this.projectDir, project)
        invokeGraph.parse()
        return new TsRename(project, invokeGraph)
    }

}