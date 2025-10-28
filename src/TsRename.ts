import { MethodDeclaration, PropertyDeclaration, Type, ClassDeclaration } from "ts-morph";
import { ClassMember, InvokeGraph } from "./InvokeGraph.ts";
import { CodeVisitor } from "./CodeScanner.ts";
import { RenameMap } from "./RenameMapBuilder.ts";

export class RenameVisitor implements CodeVisitor {

    private sdkClasses = new Map<string, Set<string>>()
    private renameMap = new Map<string, RenameMap>()

    constructor(
        private invokeGraph: InvokeGraph,
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
        if (classMap.getNewClassName() === className) {
            return true
        }
        console.log("rename class", className, classMap.getNewClassName())
        cls.rename(classMap.getNewClassName()!)
        this.renameMap.set(classMap.getNewClassName(), classMap)
        this.renameMap.delete(className)
        this.invokeGraph.setClassName(className, classMap.getNewClassName()!)
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
        if (this.extendFromSdk(cls.getType(), methodName)) {
            return false
        }
        console.log("rename method", className, methodName, newMethodName)
        method.rename(newMethodName)
        this.invokeGraph.setMethodName(className, methodName, newMethodName)
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
        if (this.extendFromSdk(cls.getType(), propertyName)) {
            return false
        }
        console.log("rename property", className, propertyName, newPropertyName)
        property.rename(newPropertyName)
        this.invokeGraph.setPropertyName(className, propertyName, newPropertyName)
        return true
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
}