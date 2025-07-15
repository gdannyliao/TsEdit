import { writeFileSync } from "fs"

export interface InvokeGraph {
    setClassName(className: string, newName: string): void
    setPropertyName(className: string, propertyName: string, newName: string): void
    setMethodName(className: string, methodName: string, newName: string): void
    save(): void

    parse(): void

    findClass(className: string): Map<string, ClassMember> | undefined
    findMethod(className: string, methodName: string): ClassMember | undefined
    findProperty(className: string, propertyName: string): ClassMember | undefined

    findPropertyInvoke(className: string, propertyName: string): Invoke[] | undefined
    findMethodInvoke(className: string, methodName: string): Invoke[] | undefined
}

export class ClassMember {
    public class: string
    public name: string
    public invokes: Invoke[] = []
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
}