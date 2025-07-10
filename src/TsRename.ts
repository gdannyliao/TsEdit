import { Project, SourceFile, SyntaxKind } from "ts-morph";
import path from "path";

export class TsRename {
    private project: Project;
    constructor(
        project: string | Project
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
        return this
    }


    save(): TsRename {
        this.changedFiles.forEach(file => {
            file.saveSync()
        })
        return this
    }
}