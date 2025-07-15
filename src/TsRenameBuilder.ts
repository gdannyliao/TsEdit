import { Project } from "ts-morph"
import { InvokeGraph } from "./InvokeGraph"
import { TsRename } from "./TsRename"
import * as path from "path"

export class TsRenameBuilder {
    private projectDir: string
    private graphType: new (projectDir:string, morphProject:Project) => InvokeGraph
    setProjectDir(projectDir: string): TsRenameBuilder {
        this.projectDir = projectDir
        return this
    }

    setInvokeGraph(graph: new (projectDir:string, morphProject:Project) => InvokeGraph): TsRenameBuilder {
        this.graphType = graph
        return this
    }

    build(): TsRename {
        const project = new Project({ tsConfigFilePath: path.join(this.projectDir, "tsconfig.json") });
        project.resolveSourceFileDependencies();
        const invokeGraph = new this.graphType(this.projectDir, project)
        invokeGraph.parse()
        return new TsRename(project, invokeGraph)
    }

}