import { MethodDeclaration, PropertyDeclaration, Type, ClassDeclaration } from "ts-morph";
import { CodeVisitor } from "./CodeScanner";
import { RenameMap } from "./RenameMapBuilder";
import { RenameSink } from "./RenameSink";

export class RenameVisitor implements CodeVisitor {

    private sdkClasses = new Map<string, Set<string>>()
    private renameMap = new Map<string, RenameMap>()

    constructor(
        private sink: RenameSink,
    ) {
    }

    setRenameMap(renameMap: Map<string, RenameMap>) {
        this.renameMap = renameMap
    }

    setSdkClasses(sdkClasses: Map<string, Set<string>>) {
        this.sdkClasses = sdkClasses
    }

    visitClass(cls: ClassDeclaration): boolean {
        const className = cls.getName()!
        const classMap = this.renameMap.get(className)
        if (!classMap) {
            return false
        }
        const newClassName = classMap.getNewClassName()!
        if (!newClassName) {
            return false
        }
        if (newClassName === className) {
            return true
        }
        console.log("rename class", className, newClassName)
        cls.rename(newClassName)
        this.renameMap.set(newClassName, classMap)
        this.renameMap.delete(className)
        this.sink.setClassName(className, newClassName)
        return true
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

    visitMethod(cls: ClassDeclaration, method: MethodDeclaration): boolean {
        const className = cls.getName()!
        const classMap = this.renameMap.get(className)
        if (!classMap) {
            return false
        }
        const methodName = method.getName()!
        const newMethodName = classMap.getNewMethod(methodName)
        if (!newMethodName) {
            return false
        }
        if (newMethodName === methodName) {
            return false
        }
        if (this.extendFromSdk(cls.getType(), methodName)) {
            return false
        }
        //FIXME 如果重命名的是一个子类的函数，但父类这个函数是保留的，子类的函数也应该保留。（目前没有处理这个情况）
        console.log("rename method", className, methodName, newMethodName)
        method.rename(newMethodName)
        this.sink.setMethodName(className, methodName, newMethodName)
        return true

    }

    visitProperty(cls: ClassDeclaration, property: PropertyDeclaration): boolean {
        const className = cls.getName()!
        const classMap = this.renameMap.get(className)
        if (!classMap) {
            return false
        }
        const propertyName = property.getName()!
        const newPropertyName = classMap.getNewProperty(propertyName)
        if (!newPropertyName) {
            return false
        }
        if (newPropertyName === propertyName) {
            return false
        }
        if (this.extendFromSdk(cls.getType(), propertyName)) {
            return false
        }
        console.log("rename property", className, propertyName, newPropertyName)
        property.rename(newPropertyName)
        this.sink.setPropertyName(className, propertyName, newPropertyName)
        return true
    }

}