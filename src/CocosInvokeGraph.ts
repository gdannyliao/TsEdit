import { readdirSync, readFileSync } from 'node:fs';
import { UuidUtils } from './UuidUtil.ts';
import { ClassDeclaration, MethodDeclaration, Project } from 'ts-morph';
import { ClassMember, Invoke, InvokeGraph, Method, Property } from './InvokeGraph.ts';
function isRecord(obj: unknown): obj is Record<string, any> {
    // 函数实现
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

export class CocosInvokeGraph implements InvokeGraph {
    private shortId2file = new Map<string, string>()
    private class2ShortId = new Map<string, string>()
    private methods = new Map<string, Method>()
    private properties = new Map<string, Property>()
    private classMembers = new Map<string, Map<string, ClassMember>>()
    setClassName(className: string, newName: string) {
        const classMember = this.classMembers.get(className)
        if (classMember === undefined) {
            return
        }
        const classMemberSet = new Set(classMember.values())
        this.classMembers.delete(className)
        classMemberSet.forEach((member) => {
            console.log(`handle ${member.getClassName()}.${member.getMemberName()}`)
            member.setClassName(newName)
            //拖拽引用不使用类名，所以要修改的地方不多
            const id = `${className}.${member.getMemberName()}`
            if (member instanceof Method) {
                const method = this.methods.get(id)!
                this.methods.delete(id)
                this.methods.set(`${newName}.${member.getMemberName()}`, method)
            } else {
                const property = this.properties.get(id)!
                this.properties.delete(id)
                this.properties.set(`${newName}.${member.getMemberName()}`, property)
            }
        })
        this.classMembers.set(newName, classMember)
    }

    setMethodName(className: string, methodName: string, newName: string) {
        const key = `${className}.${methodName}`
        const method: Method | undefined = this.methods.get(key)
        if (method === undefined) {
            return
        }

        method.setMemberName(newName)
        method.getInvokes().forEach((invoke) => {
            invoke.changeInvokePointMethod(methodName, newName)
        })
        this.methods.delete(key)
        this.methods.set(`${className}.${newName}`, method)
        const members = this.classMembers.get(className)!
        members.delete(methodName)
        members.set(newName, method)
    }

    setPropertyName(className: string, propertyName: string, newName: string) {
        const key = `${className}.${propertyName}`
        const property = this.properties.get(key)
        if (property === undefined) {
            return
        }
        property.getInvokes().forEach((invoke) => {
            invoke.changeInvokePointProperty(property.getMemberName(), newName)
        })
        property.setMemberName(newName)
        this.properties.delete(key)
        this.properties.set(`${className}.${newName}`, property)
        const members = this.classMembers.get(className)!
        members.delete(propertyName)
        members.set(newName, property)
    }


    constructor(private cocosDir: string, private morphProject: Project) {
        this.shortId2file = new Map<string, string>()
    }

    private getExportClass(file: string): ClassDeclaration | undefined {
        const sourceFile = this.morphProject.getSourceFile(file)
        if (sourceFile === undefined) {
            return undefined
        }
        for (const c of sourceFile.getClasses()) {
            if (c.isExported()) {
                return c
            }
        }
        return undefined
    }

    private getMethod(classDecl: ClassDeclaration, methodName: string): MethodDeclaration | undefined {
        const methods = classDecl.getMethods()
        for (let i = 0; i < methods.length; i++) {
            const method = methods[i];
            if (method.getName() === methodName) {
                return method
            }
        }
        return undefined
    }

    private cacheClassInvoke(className: string, memberName: string, MemberType: typeof ClassMember, invokeFile: string, invokeJson: Record<string, any>, invokeFileContent: Record<string, any>[]) {
        const key = `${className}.${memberName}`
        let map: Map<string, ClassMember>
        if (MemberType === Method) {
            map = this.methods
        } else {
            map = this.properties
        }

        let member: ClassMember
        if (map.has(key)) {
            member = map.get(key)!
        } else {
            member = new MemberType(className, memberName)
            map.set(key, member)
        }
        if (this.classMembers.has(className)) {
            const classMember = this.classMembers.get(className)!
            classMember.set(memberName, member)
        } else {
            const classMember = new Map<string, ClassMember>()
            classMember.set(memberName, member)
            this.classMembers.set(className, classMember)
        }
        member.addInvoke(new Invoke(invokeFile, invokeFileContent, invokeJson))
    }

    private getDefaultExportClassByShortId(shortId: string): ClassDeclaration | undefined {
        const file = this.shortId2file.get(shortId)
        if (file === undefined) {
            return undefined
        }
        const classDecl = this.getExportClass(file)
        if (classDecl === undefined) {
            return undefined
        }
        this.class2ShortId.set(classDecl.getName()!, shortId)
        return classDecl
    }

    private handleJson(json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {
        if ("_componentId" in json && "handler" in json) { //处理方法引用
            const shortId = json._componentId
            const classDecl = this.getDefaultExportClassByShortId(shortId)
            if (classDecl === undefined) {
                return
            }
            const method = this.getMethod(classDecl, json.handler)
            if (method === undefined) {
                return
            }
            this.cacheClassInvoke(classDecl.getName()!, json.handler, Method, file, json, fileContent)
        } else if ("__type__" in json && !json.__type__.startsWith("cc.")) { //处理变量引用
            const shortId = json.__type__
            const classDecl = this.getDefaultExportClassByShortId(shortId)
            if (classDecl === undefined) {
                return
            }
            const properties = classDecl.getProperties()
            for (let i = 0; i < properties.length; i++) {
                const property = properties[i];
                const propertyName = property.getName()
                if (!(propertyName in json)) {
                    continue
                }
                this.cacheClassInvoke(classDecl.getName()!, propertyName, Property, file, json, fileContent)
            }
        } else {
            return
        }


        for (const k in json) {
            if (isRecord(json[k])) {
                this.handleJson(json[k], file, fileContent)
            }
        }
    }

    public parse() {
        const assetsDir = `${this.cocosDir}/assets`
        const files = readdirSync(assetsDir, { recursive: true }) as string[]
        const jsonFiles: string[] = []
        files.forEach((file: string) => {
            //先获取所有文件的.meta，方便后续根据UUID识别文件
            const filePath = `${assetsDir}/${file}`
            if (file.endsWith(".fire") || file.endsWith(".prefab")) {
                jsonFiles.push(filePath)
            }
            if (file.endsWith(".meta")) {
                const meta = JSON.parse(readFileSync(filePath, "utf8"))
                const shortUuid = UuidUtils.compressUuid(meta.uuid, false)
                this.shortId2file.set(shortUuid, filePath.replace(".meta", ""))
            }
        })

        jsonFiles.forEach(file => {
            const jsonArr: Record<string, any>[] = JSON.parse(readFileSync(file, "utf8"))
            jsonArr.forEach(json => {
                this.handleJson(json, file, jsonArr)
            })
        })
    }

    public findPropertyInvoke(className: string, propertyName: string): Invoke[] | undefined {
        const propertyId = `${className}.${propertyName}`
        return this.properties.get(propertyId)?.getInvokes()
    }

    public findMethodInvoke(className: string, methodName: string): Invoke[] | undefined {
        const methodId = `${className}.${methodName}`
        return this.methods.get(methodId)?.getInvokes()
    }

    findClass(className: string): Map<string, ClassMember> | undefined {
        return this.classMembers.get(className)
    }

    findMethod(className: string, methodName: string) {
        return this.classMembers.get(className)?.get(methodName)
    }

    findProperty(className: string, propertyName: string): ClassMember | undefined {
        return this.classMembers.get(className)?.get(propertyName)
    }

    save(): void {
        this.classMembers.forEach((classMember, className) => {
            classMember.forEach((member, memberName) => {
                member.getInvokes().forEach(invoke => {
                    invoke.save()
                })
            })
        })
    }
}