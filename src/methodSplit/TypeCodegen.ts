import { Node, Type } from "ts-morph";

/**
 * 把类型渲染成一个可以写进 at 处代码的名字。
 *
 * 关键是带上 at 再问 TS 一次：类型在这个位置能被引用时，TS 会给出作用域里的名字
 * （按别名 import 时给的就是别名）；不能被引用时，它印出来的是 import("路径").X 形式——
 * 那种写法没法写进生成代码，只能退化成 any。
 */
export function renderTypeName(type: Type | undefined, at: Node): string {
    if (type === undefined) {
        return "any";
    }
    // const 推断出来的字面量类型（如 "constText"）要放宽成它的基础类型，
    // 否则生成出来的声明会把变量钉死在那一个字面量上
    const printable = type.isLiteral() ? type.getBaseTypeOfLiteralType() : type;
    const text = printable.getText(at);
    if (text.includes("import(")) {
        return "any";
    }
    return text;
}

/**
 * 生成代码里的占位值。
 *
 * 它从不被观察：不发生跳转时，元组里装的是变量的真实值、带占位值的那条通道被 w_b_ 挡住；
 * 发生跳转时，元组赋值之后立刻就是 return / break / continue。所以它唯一的要求是能编译，
 * 而不是"这个类型的零值是什么"——后者在联合类型、对象类型、导入类型上都没有答案。
 */
export function placeholderFor(type: Type, at: Node): string {
    const name = renderTypeName(type, at);
    return name === "any" ? "undefined" : `(undefined as unknown as ${name})`;
}
