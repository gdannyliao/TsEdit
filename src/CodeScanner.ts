import { ClassDeclaration, PropertyDeclaration, MethodDeclaration, Project, SourceFile } from "ts-morph";
import { existsSync, mkdirSync } from "node:fs";

export interface CodeVisitor {
    visitFile?(file: SourceFile): boolean
    visitClass?(cls: ClassDeclaration): boolean
    visitProperty?(cls: ClassDeclaration, prop: PropertyDeclaration): boolean
    visitMethod?(cls: ClassDeclaration, method: MethodDeclaration): boolean
}

export class CodeScanner {
    private visitors: CodeVisitor[] = []
    private changedFiles = new Set<SourceFile>()

    constructor(private proj: Project) {
    }

    addVisitor(visitor: CodeVisitor) {
        this.visitors.push(visitor)
    }

    scan() {
        this.proj.getSourceFiles().forEach(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return
            }
            file.getClasses().forEach(cls => {
                let fileChanged = false
                const relatedFiles = new Set<SourceFile>()
                cls.findReferencesAsNodes().forEach((refNode) => {
                    relatedFiles.add(refNode.getSourceFile())
                })
                this.visitors.forEach(visitor => {
                    if (visitor.visitClass?.(cls)) {
                        fileChanged = true
                    }
                })
                cls.getProperties().forEach(prop => {
                    this.visitors.forEach(visitor => {
                        if (visitor.visitProperty?.(cls, prop)) {
                            fileChanged = true
                        }
                    })
                })
                cls.getMethods().forEach(method => {
                    this.visitors.forEach(visitor => {
                        if (visitor.visitMethod?.(cls, method)) {
                            fileChanged = true
                        }
                    })
                })
                if (fileChanged) {
                    this.changedFiles.add(file)
                    relatedFiles.forEach(relatedFile => {
                        this.changedFiles.add(relatedFile)
                    })
                }
            })
        })
    }
    saveSync(outputDir?: string) {
        for (const file of this.changedFiles) {
            if (outputDir) {
                if (!existsSync(outputDir)) {
                    mkdirSync(outputDir, { recursive: true })
                }
                file.moveToDirectory(outputDir)
            }
            file.saveSync()
        }
    }
}