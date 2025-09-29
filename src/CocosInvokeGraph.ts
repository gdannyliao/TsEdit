import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ClassDeclaration, MethodDeclaration, Project } from 'ts-morph';
import { ClassMember, Invoke, InvokeGraph, Method, Property } from './InvokeGraph.ts';
// import UuidUtils from './cocos_uuid.js';
import { UuidUtils } from './UuidUtil.ts';
function isRecord(obj: unknown): obj is Record<string, any> {
    // 函数实现
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

class MetaFile {
    private fileName: string = ""
    private shortId: string = ""
    private data: any | undefined
    private filePath: string = ""
    private changed: boolean = false
    constructor(filePath: string, shortId: string, data: any | undefined) {
        this.filePath = filePath
        this.fileName = filePath.replace(".meta", "")
        this.shortId = shortId
        this.data = data
    }

    getFileName(): string {
        return this.fileName
    }

    getShortId(): string {
        return this.shortId
    }

    getData(): any | undefined {
        return this.data
    }

    setUUID(uuid: string): void {
        if (this.data === undefined) {
            return
        }
        if (this.data?.uuid) {
            this.data.uuid = uuid
        }
        const shortId = UuidUtils.compressUuid(uuid, false)
        console.log(`setShortId ${this.fileName} ${this.shortId} to ${shortId}/:/${this.data.uuid}`)
        this.shortId = shortId
        this.changed = true
    }

    saveSync(): void {
        if (!this.changed) {
            return
        }
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 4))
        this.changed = false
    }
}

export class CocosInvokeGraph implements InvokeGraph {
    /**
     * key: shortId
     * value: MetaFile
     */
    private shortId2file = new Map<string, MetaFile>()


    private shortIdInvokes = new Map<string, Array<Invoke>>()
    /**
     * key: className
     * value: shortId
     */
    private class2ShortId = new Map<string, string>()
    /**
     * key: className.methodName
     * value: Method
     */
    private methods = new Map<string, Method>()
    /**
     * key: className.propertyName
     * value: Property
     */
    private properties = new Map<string, Property>()
    /**
     * key: className
     * value: Map<memberName, ClassMember>
     */
    private classMembers = new Map<string, Map<string, ClassMember>>()

    setShortId(shortId: string, newUUID: string): void {
        const file = this.shortId2file.get(shortId)
        if (file === undefined) {
            return
        }
        file.setUUID(newUUID)
        const newShortId = file.getShortId()
        this.shortId2file.set(newShortId, file)
        this.shortId2file.delete(shortId)
        const invoke = this.shortIdInvokes.get(shortId)
        if (invoke !== undefined) {
            this.shortIdInvokes.set(newShortId, invoke)
            this.shortIdInvokes.delete(shortId)
            invoke.forEach((inv) => {
                inv.changeInvokePointShortId(shortId, newShortId)
            })
        }

        for (const [key, value] of this.class2ShortId) {
            if (value === shortId) {
                this.class2ShortId.set(key, newShortId)
            }
        }
    }

    getShortIds(): Set<string> {
        return new Set(this.shortId2file.keys())
    }

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
        this.shortId2file = new Map<string, MetaFile>()
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
        const classDecl = this.getExportClass(file.getFileName()) //FIXME 通过文件名来获取类声明，不太准确
        if (classDecl === undefined) {
            return undefined
        }
        this.class2ShortId.set(classDecl.getName()!, shortId)
        return classDecl
    }

    private handleJson(json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {
        const recordShortId = (shortId: string) => {
            if (this.shortId2file.has(shortId)) {
                if (this.shortIdInvokes.has(shortId)) {
                    this.shortIdInvokes.get(shortId)!.push(new Invoke(file, fileContent, json))
                } else {
                    this.shortIdInvokes.set(shortId, [new Invoke(file, fileContent, json)])
                }
            }
        }


        for (const k in json) {
            if (isRecord(json[k])) {
                this.handleJson(json[k], file, fileContent)
            } else if (Array.isArray(json[k])) {
                // 处理数组中的每个元素
                json[k].forEach((item: any) => {
                    if (isRecord(item)) {
                        this.handleJson(item, file, fileContent)
                    }
                })
            } else if ("_componentId" === k) { //处理方法引用
                const shortId = json._componentId
                recordShortId(shortId)
                const classDecl = this.getDefaultExportClassByShortId(shortId)
                if (classDecl !== undefined) {
                    const method = this.getMethod(classDecl, json.handler)
                    if (method !== undefined) {
                        this.cacheClassInvoke(classDecl.getName()!, json.handler, Method, file, json, fileContent)
                    }
                }
            } else if ("__type__" === k) { //处理变量引用
                const shortId = json.__type__
                recordShortId(shortId)
                const classDecl = this.getDefaultExportClassByShortId(shortId)
                if (classDecl !== undefined) {
                    const properties = classDecl.getProperties()
                    for (let i = 0; i < properties.length; i++) {
                        const property = properties[i];
                        const propertyName = property.getName()
                        if (!(propertyName in json)) {
                            continue
                        }
                        this.cacheClassInvoke(classDecl.getName()!, propertyName, Property, file, json, fileContent)
                    }
                }
            } else if ("__uuid__" === k) {
                const shortId = UuidUtils.compressUuid(json.__uuid__, false)
                recordShortId(shortId)
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
                this.shortId2file.set(shortUuid, new MetaFile(filePath, shortUuid, meta))
            }
        })

        jsonFiles.forEach(file => {
            const json = JSON.parse(readFileSync(file, "utf8"))
            if (Array.isArray(json)) {
                json.forEach(j => {
                    this.handleJson(j, file, json)
                })
            } else if (json !== null && typeof json === 'object') {
                this.handleJson(json, file, json)
            }
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

    saveSync(): void {
        this.classMembers.forEach((classMember, className) => {
            classMember.forEach((member, memberName) => {
                member.getInvokes().forEach(invoke => {
                    invoke.save()
                })
            })
        })

        this.shortId2file.forEach((file, shortId) => {
            file.saveSync()
        })

        this.shortIdInvokes.forEach((invokes, shortId) => {
            // 这里和classMembers中的invoke不会相互覆盖。因为两者的内存对象是一样的
            invokes.forEach(invoke => {
                invoke.save()
            })
        })
    }
}