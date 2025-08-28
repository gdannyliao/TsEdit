import { writeFileSync } from "node:fs"

export interface InvokeGraph {
    setClassName(className: string, newName: string): void
    setPropertyName(className: string, propertyName: string, newName: string): void
    setMethodName(className: string, methodName: string, newName: string): void
    saveSync(): void

    parse(): void

    findClass(className: string): Map<string, ClassMember> | undefined
    findMethod(className: string, methodName: string): ClassMember | undefined
    findProperty(className: string, propertyName: string): ClassMember | undefined

    findPropertyInvoke(className: string, propertyName: string): Invoke[] | undefined
    findMethodInvoke(className: string, methodName: string): Invoke[] | undefined
}

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