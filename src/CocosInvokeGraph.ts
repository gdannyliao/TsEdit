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
    private methods = new Map<string, Method>()
    private properties = new Map<string, Property>()

    constructor(private cocosDir: string, private morphProject: Project) {
        this.shortId2file = new Map<string, string>()
    }

    private handleJson(json: Record<string, any>, file: string, fileContent: Record<string, any>[]) {
        if ("_componentId" in json && "handler" in json) {
            const shortId = json._componentId
            const key = `${shortId}.${json.handler}`
            let method: Method
            if (this.methods.has(key)) {
                method = this.methods.get(key)!
            } else {
                method = new Method()
                this.methods.set(key, method)
                method.name = json.handler
            }
            const invoke = new Invoke()
            invoke.file = file
            invoke.invoke = json
            invoke.content = fileContent
            method.invokes.push(invoke)
        } else if ("__type__" in json && !json.__type__.startsWith("cc.")) {
            const shortId = json.__type__
            const file: string | undefined = this.shortId2file.get(shortId)
            if (file === undefined) {
                return
            }
            this.morphProject.getSourceFile(file)?.getClasses().forEach(classDecl => {
                classDecl.getProperties().forEach(property => {
                    const propertyName = property.getName()
                    if (propertyName in json) {
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
        for (const k of this.properties.keys()) {
            const property = this.properties.get(k)!
            if (property.class === className && property.name === propertyName) {
                return property.invokes
            }
        }
    }

}