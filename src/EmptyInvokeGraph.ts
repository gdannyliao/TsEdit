import { ClassMember, Invoke, InvokeGraph } from "./InvokeGraph.ts";

export class EmptyInvokeGraph implements InvokeGraph {
  setClassName(className: string, newName: string): void {
  }
  setPropertyName(className: string, propertyName: string, newName: string): void {
  }
  setMethodName(className: string, methodName: string, newName: string): void {
  }
  saveSync(): void {
  }
  parse(): void {
  }
  findClass(className: string): Map<string, ClassMember> | undefined {
    return undefined
  }
  findMethod(className: string, methodName: string): ClassMember | undefined {
    return undefined
  }
  findProperty(className: string, propertyName: string): ClassMember | undefined {
    return undefined
  }
  findPropertyInvoke(className: string, propertyName: string): Invoke[] | undefined {
    return undefined
  }
  findMethodInvoke(className: string, methodName: string): Invoke[] | undefined {
    return undefined
  }

}