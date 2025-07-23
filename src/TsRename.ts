import { Project, SourceFile, MethodDeclaration, PropertyDeclaration, Type } from "ts-morph";
import * as path from "node:path";
import { ClassMember, InvokeGraph } from "./InvokeGraph.ts";

export class TsRename {

    private project: Project
    private sdkClasses = new Map<string, Set<string>>()
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
        this.project.getSourceFiles().forEach(file => {
            if (!file.getBaseName().endsWith(".d.ts")) {
                return
            }
            file.getModules().forEach(module => {
                module.getClasses().forEach(classDecl => {
                    const clsMember = new Set<string>()
                    this.sdkClasses.set(`${module.getName()}.${classDecl.getName()}`, clsMember)
                    classDecl.getMembers().forEach(member => {
                        if (member instanceof PropertyDeclaration || member instanceof MethodDeclaration)
                            clsMember.add(member.getName()!)
                    })
                })
            })
        })
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

    /**
     * 检查是否是继承自SDK类的成员，是的话直接应该忽略
     * @param cls 
     * @param member 
     * @returns 
     */
    private extendFromSdk(cls: Type, member: string): boolean {
        if (this.sdkClasses.has(cls.getText())) {
            const members = this.sdkClasses.get(cls.getText())
            if (members?.has(member)) {
                return true
            }
        }
        return cls.getBaseTypes().some(baseType => {
            return this.extendFromSdk(baseType, member)
        })
    }

    setMethodName(className: string, methodName: string, newName: string): TsRename {
        this.project.getSourceFiles().some(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return false
            }
            const classDecl = file.getClass(className)
            if (!classDecl) {
                return false
            }
            const method = classDecl.getMethod(methodName)
            if (!method) {
                return false
            }
            if (this.extendFromSdk(classDecl.getType(), methodName)) {
                return true
            }

            console.log("rename method", className, methodName, newName)
            this.changedFiles.add(file)
            method.findReferencesAsNodes().forEach((refNode) => {
                this.changedFiles.add(refNode.getSourceFile())
            })
            method.rename(newName)
            this.invokeGraph.setMethodName(className, methodName, newName)
            return true
        })
        return this
    }

    setPropertyName(className: string, propertyName: string, newName: string): TsRename {
        this.project.getSourceFiles().some(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return false
            }
            const classDecl = file.getClass(className)
            if (!classDecl) {
                return false
            }
            const property = classDecl.getProperty(propertyName)
            if (!property) {
                return false
            }
            if (this.extendFromSdk(classDecl.getType(), propertyName)) {
                return true
            }
            console.log("rename property", className, propertyName, newName)
            this.changedFiles.add(file)
            property.findReferencesAsNodes().forEach((refNode) => {
                this.changedFiles.add(refNode.getSourceFile())
            })
            property.rename(newName)
            this.invokeGraph.setPropertyName(className, propertyName, newName)
            return true
        })
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