import { readdirSync, readFileSync } from 'fs';
import { UuidUtils } from './UuidUtil';
import { Project } from 'ts-morph/dist/ts-morph';
function isRecord(obj: unknown): obj is Record<string, any> {
    // 函数实现
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

class Invoke {
    /**
     * 引用所在的文件
     */
    public file: string
    /**
     * 引用点的json
     */
    public invoke: Record<string, any> = {}
    /**
     * 引用所在的文件的文件内容，方便修改后整体保存
     */
    public content: Record<string, any>[] = []
}
class ClassMember {
    public class: string
    public name: string
    public invokes: Invoke[] = []
}

class Method extends ClassMember { }
class Property extends ClassMember { }

export class CocosInvokeGraph {
    private shortId2file = new Map<string, string>()
    private class2ShortId = new Map<string, string>()
    private methods = new Map<string, Method>()
    private properties = new Map<string, Property>()

    constructor(private cocosDir: string, private morphProject: Project) {
        this.shortId2file = new Map<string, string>()
    }

    private handleJson(json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {
        if ("_componentId" in json && "handler" in json) {
            const shortId = json._componentId
            const file: string | undefined = this.shortId2file.get(shortId)
            if (file === undefined) {
                return
            }
            this.morphProject.getSourceFile(file)?.getClasses().forEach(classDecl => {
                this.class2ShortId.set(classDecl.getName(), shortId)
                const methods = classDecl.getMethods()
                for (let i = 0; i < methods.length; i++) {
                    const method = methods[i];
                    const methodName = method.getName()
                    if (methodName !== json.handler) {
                        continue
                    }
                    const key = `${shortId}.${json.handler}`
                    let methodStruct: Method
                    if (this.methods.has(key)) {
                        methodStruct = this.methods.get(key)!
                    } else {
                        methodStruct = new Method()
                        this.methods.set(key, methodStruct)
                        methodStruct.name = json.handler
                        methodStruct.class = classDecl.getName()
                    }
                    const invoke = new Invoke()
                    invoke.file = file
                    invoke.invoke = json
                    invoke.content = fileContent
                    methodStruct.invokes.push(invoke)
                    break
                }
            })

        } else if ("__type__" in json && !json.__type__.startsWith("cc.")) {
            const shortId = json.__type__
            const file: string | undefined = this.shortId2file.get(shortId)
            if (file === undefined) {
                return
            }
            this.morphProject.getSourceFile(file)?.getClasses().forEach(classDecl => {
                this.class2ShortId.set(classDecl.getName(), shortId)
                const properties = classDecl.getProperties()
                for (let i = 0; i < properties.length; i++) {
                    const property = properties[i];
                    const propertyName = property.getName()
                    if (!(propertyName in json)) {
                        continue
                    }
                    const propertyId = `${shortId}.${propertyName}`
                    let propertyStruct: Property
                    if (this.properties.has(propertyId)) {
                        propertyStruct = this.properties.get(propertyId)!
                    } else {
                        propertyStruct = new Property()
                        propertyStruct.class = classDecl.getName()
                        propertyStruct.name = property.getName()
                        this.properties.set(propertyId, propertyStruct)
                    }
                    const invoke = new Invoke()
                    invoke.file = file
                    invoke.invoke = json
                    invoke.content = fileContent
                    propertyStruct.invokes.push(invoke)
                }
            })
        }


        for (const k in json) {
            if (isRecord(json[k])) {
                this.handleJson(json[k], file, fileContent)
            }
        }
    }

    public parse() {
        const assetsDir = `${this.cocosDir}/assets`
        const files = readdirSync(assetsDir, { recursive: true })
        const jsonFiles: string[] = []
        files.forEach(file => {
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
        const shortId = this.class2ShortId.get(className)
        if (shortId === undefined) {
            return undefined
        }
        const propertyId = `${shortId}.${propertyName}`
        return this.properties.get(propertyId)?.invokes
    }

    public findMethodInvoke(className: string, methodName: string): Invoke[] | undefined {
        const shortId = this.class2ShortId.get(className)
        if (shortId === undefined) {
            return undefined
        }
        const methodId = `${shortId}.${methodName}`
        return this.methods.get(methodId)?.invokes
    }

}