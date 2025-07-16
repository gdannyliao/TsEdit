import { Project, SourceFile, SyntaxKind } from "ts-morph";
import * as path from "node:path";
import { ClassMember, InvokeGraph } from "./InvokeGraph.ts";

export class TsRename {
    
    private project: Project;
    constructor(
        project: string | Project,
        private invokeGraph: InvokeGraph,
    ) {
        if (typeof project === 'string') {
            // 初始化工程
            this.project = new Project({
                tsConfigFilePath: path.join(project, "tsconfig.json"),
            });
        } else {
            this.project = project
        }
        this.project.resolveSourceFileDependencies();
    }

    private changedFiles = new Set<SourceFile>()

    setClassName(className: string, newName: string): TsRename {
        this.project.getSourceFiles().forEach(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return
            }
            const classDecl = file.getClass(className)
            if (!classDecl) {
                return
            }

            console.log("rename class", className, newName)

            this.changedFiles.add(file)
            classDecl.findReferencesAsNodes().forEach((refNode) => {
                this.changedFiles.add(refNode.getSourceFile())
            })
            classDecl.rename(newName)
        })
        this.invokeGraph.setClassName(className, newName)
        return this;
    }

    setMethodName(className: string, methodName: string, newName: string): TsRename {
        this.project.getSourceFiles().forEach(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return
            }
            const classDecl = file.getClass(className)
            if (!classDecl) {
                return
            }
            const method = classDecl.getMethod(methodName)
            if (!method) {
                return
            }
            console.log("rename method", className, methodName, newName)

            this.changedFiles.add(file)
            method.findReferencesAsNodes().forEach((refNode) => {
                this.changedFiles.add(refNode.getSourceFile())
            })
            method.rename(newName)
        })
        this.invokeGraph.setMethodName(className, methodName, newName)
        return this
    }

    setPropertyName(className: string, propertyName: string, newName: string): TsRename {
        this.project.getSourceFiles().forEach(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return
            }
            const classDecl = file.getClass(className)
            if (!classDecl) {
                return
            }
            const property = classDecl.getProperty(propertyName)
            if (!property) {
                return
            }
            console.log("rename property", className, propertyName, newName)
            this.changedFiles.add(file)
            property.findReferencesAsNodes().forEach((refNode) => {
                this.changedFiles.add(refNode.getSourceFile())
            })
            property.rename(newName)
        })
        this.invokeGraph.setPropertyName(className, propertyName, newName)
        return this
    }

    getClass(className: string): Map<string, ClassMember> | undefined {
        return this.invokeGraph.findClass(className)
    }

    getMethod(className: string, methodName: string): ClassMember | undefined {
        return this.invokeGraph.findMethod(className, methodName)
    }

    getProperty(className: string, propertyName: string): ClassMember | undefined {
        return this.invokeGraph.findProperty(className, propertyName)
    }
    save(): TsRename {
        this.changedFiles.forEach(file => {
            file.saveSync()
        })
        this.invokeGraph.save()
        return this
    }
}