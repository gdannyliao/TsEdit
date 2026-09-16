/**
 * 重命名落点：接收"某个符号改名了"这件事，并把它落到 TypeScript 源码之外的地方。
 *
 * 适配器有两个：
 * - CocosInvokeGraph —— cocos 工程，改写资源文件里的场景引用
 * - NoopRenameSink   —— 普通工程，源码之外没有需要改的东西
 */
export interface RenameSink {
    setClassName(className: string, newName: string): void
    setMethodName(className: string, methodName: string, newName: string): void
    setPropertyName(className: string, propertyName: string, newName: string): void
}

export class NoopRenameSink implements RenameSink {
    setClassName(): void { }
    setMethodName(): void { }
    setPropertyName(): void { }
}
