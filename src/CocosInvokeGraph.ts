import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { ClassDeclaration, MethodDeclaration, Project } from 'ts-morph';
// import UuidUtils from './cocos_uuid.js';
import { UuidUtils } from './UuidUtil';
import { RenameSink } from './RenameSink';

/**
 * 符号（某个类的某个方法或属性）在资源文件里的引用点集合
 */
export class ClassMember {
    constructor(private className: string, private memberName: string) { }
    getClassName(): string {
        return this.className
    }
    setClassName(newName: string) {
        this.className = newName
    }
    getMemberName(): string {
        return this.memberName
    }

    setMemberName(newName: string) {
        this.memberName = newName
    }

    addInvoke(invoke: Invoke) {
        this.invokes.push(invoke)
    }

    getInvokes(): Invoke[] {
        return this.invokes
    }
    private invokes: Invoke[] = []
}

export class Method extends ClassMember { }
export class Property extends ClassMember { }

export class Invoke {
    /**
     * file, 引用所在的文件。 invokePoint引用点的json，fileContent引用所在的文件的文件内容，方便修改后整体保存
     */
    constructor(private file: string, private fileContent: Record<string, any>[], private invokePoint: Record<string, any>) { }
    private invokeChanged = false

    changeInvokePointProperty(propertyName: string, newName: string) {
        const value = this.invokePoint[propertyName]
        delete this.invokePoint[propertyName]
        this.invokePoint[newName] = value
        this.invokeChanged = true
    }

    changeInvokePointMethod(methodName: string, newName: string) {
        this.invokePoint["handler"] = newName
        this.invokeChanged = true
    }

    changeInvokePointShortId(oldShortId: string, newShortId: string) {
        if (this.invokePoint["_componentId"] === oldShortId) {
            this.invokePoint["_componentId"] = newShortId
            this.invokeChanged = true
        } else if (this.invokePoint["__type__"] === oldShortId) {
            this.invokePoint["__type__"] = newShortId
            this.invokeChanged = true
        } else {
            const uuid = UuidUtils.decompressUuid(oldShortId)
            if (this.invokePoint["__uuid__"] === uuid) {
                this.invokePoint["__uuid__"] = UuidUtils.decompressUuid(newShortId)
                this.invokeChanged = true
            } else if (this.invokePoint["rawTextureUuid"] === uuid) {
                this.invokePoint["rawTextureUuid"] = UuidUtils.decompressUuid(newShortId)
                this.invokeChanged = true
            }
        }
    }

    save() {
        if (this.changed()) {
            this.invokeChanged = false
            writeFileSync(this.file, JSON.stringify(this.fileContent))
        }
    }

    changed(): boolean {
        return this.invokeChanged
    }

    getFile(): string {
        return this.file
    }
}

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

    getFilePath(): string {
        return this.filePath
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

export class CocosInvokeGraph implements RenameSink {
    /**
     * key: shortId
     * value: MetaFile
     */
    private shortId2file = new Map<string, MetaFile>()

    /**
     * 重置 uuid 的范围：只重置路径以这些前缀开头的 meta。
     *
     * 为什么必须限定范围（而不是"全重置、拉黑几个"）：资源文件里引用的
     * uuid 有相当一部分**不属于本项目**——captain 实测 54 个被引用 uuid 里
     * 有 40 个来自引擎内置资源（builtin-2d-sprite.mtl 等），它们没有 meta
     * 文件、也无从改写。给这些 uuid 改名 = 引用指向不存在的资源 = 运行时黑屏。
     *
     * 空集合（默认）= 不限定，保持历史行为（全量重置）。
     */
    private uuidScopePrefixes: Array<string> = []


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

    /**
     * 限定 uuid 重置的范围：只重置 meta 路径以 prefixes 之一开头的那些。
     *
     * 传空数组 = 不限定（历史行为）。前缀是相对 assets/ 的路径，例如
     * `["Piggies/", "Script/"]`。末尾斜杠要带上，否则 "Sweet" 会误配 "SweetX"。
     */
    setUuidScope(prefixes: Array<string>): void {
        this.uuidScopePrefixes = prefixes
    }

    /**
     * 可重置 uuid 的 shortId 集合（受 uuidScopePrefixes 限定）。
     *
     * 拿不到 meta 文件路径的（引擎内置资源）天然不在 shortId2file 里，本就不会
     * 被重置；这里再按前缀收一道窄，是为了不误伤**同工程里不属于本包**的资源。
     */
    getShortIds(): Set<string> {
        if (this.uuidScopePrefixes.length === 0) {
            return new Set(this.shortId2file.keys())
        }
        const assetsPrefix = `${this.cocosDir}/assets/`
        const out = new Set<string>()
        this.shortId2file.forEach((metaFile, shortId) => {
            const filePath = metaFile.getFilePath()
            const rel = filePath.startsWith(assetsPrefix)
                ? filePath.slice(assetsPrefix.length)
                : filePath
            if (this.uuidScopePrefixes.some(p => rel.startsWith(p))) {
                out.add(shortId)
            }
        })
        return out
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

    private getExportClass(file: string): ClassDeclaration[] {
        const sourceFile = this.morphProject.getSourceFile(file)
        const classDecls: ClassDeclaration[] = []
        if (sourceFile === undefined) {
            return classDecls
        }
        for (const c of sourceFile.getClasses()) {
            if (c.isExported()) {
                classDecls.push(c)
            }
        }
        return classDecls
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

    private getExportClassByShortId(shortId: string): ClassDeclaration[] {
        const file = this.shortId2file.get(shortId)
        if (file === undefined) {
            return []
        }
        const classDecls = this.getExportClass(file.getFileName()) //FIXME 通过文件名来获取类声明，不太准确
        if (classDecls.length === 0) {
            return classDecls
        }
        for (const c of classDecls) {
            this.class2ShortId.set(c.getName()!, shortId)
        }
        return classDecls
    }

    private recordShortId(shortId: string, json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {
        if (this.shortId2file.has(shortId)) {
            if (this.shortIdInvokes.has(shortId)) {
                this.shortIdInvokes.get(shortId)!.push(new Invoke(file, fileContent, json))
            } else {
                this.shortIdInvokes.set(shortId, [new Invoke(file, fileContent, json)])
            }
        }
    }
    private isShortId(text: string | undefined): boolean {
        if (text === undefined) {
            return false
        }
        return !(text.startsWith("cc.") || text === 'TypedArray')
    }
    private handleJson(json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {

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
                this.recordShortId(shortId, json, file, fileContent)
                const classDecls = this.getExportClassByShortId(shortId)
                for (const c of classDecls) {
                    const method = this.getMethod(c, json.handler)
                    if (method !== undefined) {
                        this.cacheClassInvoke(c.getName()!, json.handler, Method, file, json, fileContent)
                        break
                    }
                }
            } else if ("__type__" === k) { //处理变量引用
                if (!this.isShortId(json.__type__)) {
                    if (json.__type__ === 'TypedArray') {
                        continue
                    }
                    if ("component" in json && "handler" in json) { //处理组件引用
                        const clsName = json.component
                        const methodName = json.handler
                        if (clsName === undefined || methodName === undefined ) {
                            continue
                        }
                        this.cacheClassInvoke(clsName, methodName, Method, file, json, fileContent)
                    }
                } else {
                    const shortId = json.__type__
                    this.recordShortId(shortId, json, file, fileContent)
                    const classDecls = this.getExportClassByShortId(shortId)
                    for (const c of classDecls) {
                        const decorators = c.getDecorators()
                        if (decorators.length === 0 || !decorators.some((d) => d.getName() === "ccclass")) {
                            continue
                        }
                        const properties = c.getProperties()
                        for (let i = 0; i < properties.length; i++) {
                            const property = properties[i];
                            const decorators = property.getDecorators()
                            if (decorators.length === 0 || !decorators.some((d) => d.getName() === "property")) {
                                continue
                            }
                            const propertyName = property.getName()
                            if (!(propertyName in json)) {
                                continue
                            }
                            this.cacheClassInvoke(c.getName()!, propertyName, Property, file, json, fileContent);
                        }
                    }
                }
            } else if ("__uuid__" === k) {
                const shortId = UuidUtils.compressUuid(json.__uuid__, false)
                this.recordShortId(shortId, json, file, fileContent)
            } else if ("rawTextureUuid" === k) {
                const shortId = UuidUtils.compressUuid(json.rawTextureUuid, false)
                this.recordShortId(shortId, json, file, fileContent)
            }
        }
    }

    /**
     * 递归列出 assets/ 下所有文件的**相对路径**。
     *
     * **为什么手写而不 `readdirSync(dir, {recursive:true})`**：那个选项要
     * Node **18.17+**（18.17.0 / 20.1.0 才加），而 pkg 打包的基线是
     * **node18.5.0**——在不支持的 Node 上该选项被**静默忽略**，只返回顶层条目。
     *
     * 后果有多严重（实测，captain 工程）：
     *   - `assets/` 顶层只有 8 个 .meta，于是 `--reset-uuid` 只重置 **8/156**
     *     个 uuid，其余 148 个带着源工程的 uuid 出厂；
     *   - 更糟的是 `.fire`/`.prefab` 只收到顶层那几个 → **子目录里的 prefab
     *     场景引用根本没被解析**，改名后的方法名不会落到 prefab 的 handler 上，
     *     运行时按钮回调全断。
     * 而源码测试跑在开发机的 Node（18.17+）上，所以这个问题**只在打包二进制里出现**，
     * 单测永远发现不了。
     *
     * 手写遍历不依赖 Node 版本，从根本上消除这个版本耦合。
     */
    private listAssetFiles(dir: string, prefix: string = ""): string[] {
        const out: string[] = []
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
                out.push(...this.listAssetFiles(`${dir}/${entry.name}`, rel))
            } else {
                out.push(rel)
            }
        }
        return out
    }

    public parse() {
        const assetsDir = `${this.cocosDir}/assets`
        const files = this.listAssetFiles(assetsDir)
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

        this.shortId2file.forEach((file, shortId) => {
            const data = file.getData()
            if (Array.isArray(data)) {
                data.forEach(j => {
                    this.handleJson(j, file.getFilePath(), data)
                })
            } else if (data !== null && typeof data === 'object') {
                this.handleJson(data, file.getFilePath(), data)
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