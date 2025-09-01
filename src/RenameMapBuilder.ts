import { MethodDeclaration, Project, PropertyDeclaration, SourceFile } from "ts-morph";
import { RandomSeed } from "./random.ts";

export enum CodeType {
    Class,
    Property,
    Method,
}

export class CodeName {
    constructor(
        public name: string,
        public type: CodeType,
    ) {
    }
}

export class RenameMap {
    constructor(
        private oldClassName: string,
        private newClassName: string,
    ) {
    }

    private propertyMap = new Map<string, string>()
    private methodMap = new Map<string, string>()

    setProperty(oldName: string, newName: string) {
        this.propertyMap.set(oldName, newName)
    }
    setMethod(oldName: string, newName: string) {
        this.methodMap.set(oldName, newName)
    }

    getNewProperty(oldName: string) {
        return this.propertyMap.get(oldName)
    }
    getNewMethod(oldName: string) {
        return this.methodMap.get(oldName)
    }
    getClassName() {
        return this.oldClassName
    }

    getNewClassName() {
        return this.newClassName
    }
}

export class RenameMapBuilder {
    private keepMap: Map<string, Set<string>> | undefined
    private specifiedNames: Map<string, RenameMap> | undefined
    constructor(private project: Project) {
    }

    setKeepMap(keepMap: Map<string, Set<string>>): RenameMapBuilder {
        this.keepMap = keepMap
        return this
    }

    specifyNames(renameMap: Map<string, RenameMap> | undefined): RenameMapBuilder {
        this.specifiedNames = renameMap
        return this
    }

    private checkInheritance(sdkClasses: Map<string, Set<string>>, file: SourceFile) {
        if (!file.getBaseName().endsWith(".d.ts")) {
            return
        }
        file.getModules().forEach(module => {
            module.getClasses().forEach(classDecl => {
                const clsMember = new Set<string>()
                sdkClasses.set(`${module.getName()}.${classDecl.getName()}`, clsMember)
                classDecl.getMembers().forEach(member => {
                    if (member instanceof PropertyDeclaration || member instanceof MethodDeclaration)
                        clsMember.add(member.getName()!)
                })
            })
        })
    }

    private getSpecifiedPropName(className: string, propName: string): string | undefined {
        if (this.specifiedNames !== undefined && this.specifiedNames.has(className)) {
            return this.specifiedNames.get(className)!.getNewProperty(propName)
        }
        return undefined
    }
    build(seed: string): [Map<string, RenameMap>, Map<string, Set<string>>] {
        const renameMaps = new Map<string, RenameMap>()
        const sdkClasses = new Map<string, Set<string>>()
        const random = new RandomSeed(seed)
        this.project.getSourceFiles().forEach(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                // console.warn(`忽略d.ts文件: ${file.getFilePath()}`)
                this.checkInheritance(sdkClasses, file)
                return
            }
            file.getClasses().forEach(classDecl => {
                const className = classDecl.getName()
                if (className === undefined) {
                    return
                }

                const keepSet = this.keepMap?.get(className)

                if (keepSet !== undefined && keepSet.size === 0) {
                    console.warn(`保留类${className}`) //如果没有指定哪些属性要保留，则保留整个类所有的属性和类名
                    return
                }

                let renameMap: RenameMap
                if (this.specifiedNames !== undefined && this.specifiedNames.has(className)) {
                    renameMap = this.specifiedNames.get(className)!
                } else {
                    renameMap = new RenameMap(className, random.getString(6, "C_"))
                }
                renameMaps.set(className, renameMap);

                classDecl.getProperties().forEach(property => {
                    const propertyName = property.getName()
                    if (propertyName === undefined) {
                        return
                    }
                    if (keepSet?.has(propertyName)) {
                        console.warn(`保留类${className}的属性${propertyName}`)
                        return
                    }

                    if (renameMap.getNewProperty(propertyName)) {
                        return
                    }
                    renameMap.setProperty(propertyName, random.getString(6, "p_"))
                })

                classDecl.getMethods().forEach(method => {
                    const methodName = method.getName()
                    if (methodName === undefined) {
                        return
                    }
                    if (keepSet?.has(methodName)) {
                        console.warn(`保留类${className}的方法${methodName}`)
                        return
                    }
                    if (renameMap.getNewMethod(methodName)) {
                        return
                    }

                    const newPropName = this.getSpecifiedPropName(className, methodName)
                    if (newPropName) { //如果有指定名，指定名同时视为方法名
                        renameMap.setMethod(methodName, newPropName)
                        return
                    }
                    renameMap.setMethod(methodName, random.getString(6, "m_"))
                })
            })
        })
        return [renameMaps, sdkClasses]
    }
}