import { makeThing } from "./ImportedThing"

class SplitMethodSample {


    withParam(text: string) {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log(text)
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withConst() {
        console.log("line1")
        const constText = "constText"
        console.log("constText=" + constText);
        console.log("line2")
        console.log("line3")
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withReturn(): string {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
        return "returnText"
    }

    withIf(text: string) {
        console.log("line1")
        console.log("line2")
        if (text) {
            console.log("text is not empty")
        }
        console.log("line3")
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withIfAndConst() {
        console.log("line1")
        const c1 = "const1"
        console.log("line2")
        console.log("line3")
        console.log("line4")
        console.log("line5")
        if (c1) {
            console.log("c1 is not empty")
        }
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withVar() {
        /*遇到var，var应该保留在方法体中，赋值的地方需要通过return返回
        */
        var v1 = "var1"
        console.log("line1")
        console.log("line2")
        console.log("line3");
        v1 = "var2"
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("var=" + v1)
        console.log("line7")
        console.log("line8")
    }

    withIfReturn(text: string) {
        /* if中遇到return，需要外层函数中也保留中断逻辑。子函数返回true，表示子函数中有中断，否则表示子函数继续执行
        fun1(text:string):[boolean] {
            if (text) {
                console.log("text is not empty")
                return [true]
            }
            console.log("line5")
            console.log("line6")
            return [false]
        }
        withIfReturn(text: string) {
            console.log("line1")
            console.log("line2")
            console.log("line3")
            console.log("line4")

            let willBreak__ = false
            [willBreak__] = fun1(text);
            if (willBreak__) {
                return
            }

            console.log("line7")
            console.log("line8")
        }
        */
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4")
        if (text) {
            console.log("text is not empty")
            return
        }
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }


    withIfReturnHasValue(text: string): string {
        /* if中遇到含有值的return，需要将值传递回上层。子函数前添加Boolean值表示子函数是否有中断
    fun1(text: string): [boolean, string] {
        if (text) {
            console.log("text is not empty")
            return [true, "return1"]
        }
        console.log("line5")
        console.log("line6")
        return [false, ""]
    }
    withIfReturnHasValue(text: string): string {

        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4")

        let willBreak__ = false, returnValue__ = ""
        [willBreak__, returnValue__] = fun1(text);
        if (willBreak__) {
            return returnValue__
        }

        console.log("line7")
        console.log("line8")
        return "return2"
    }

        */
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4")
        if (text) {
            console.log("text is not empty")
            return "return1"
        }
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
        return "return2"
    }

    withIfReturnAndVarChange(text: string): string {
        /* if中遇到含有值的return，需要将值传递回上层。子函数前添加Boolean值表示子函数是否有中断
fun1(text: string, var1: string): [boolean, int, string] {
if (text) {
    var1 = 2
    console.log("text is not empty")
    return [true, var1, "return1"]
}
console.log("line5")
console.log("line6")
return [false, var1, ""]
}
withIfReturnAndVarChange(text: string): string {

console.log("line1")
console.log("line2")
let var1 = 1

console.log("line3")
console.log("line4")

let willBreak__ = false, returnValue__ = ""
[willBreak__, var1, returnValue__] = fun1(text);
if (willBreak__) {
    return returnValue__
}

console.log("line7")
console.log("var1=" + var1)
console.log("line8")
return "return2"
}
*/
        console.log("line1")
        console.log("line2")
        let var1 = 1
        console.log("line3")
        console.log("line4")
        if (text) {
            var1 = 2
            console.log("text is not empty")
            return "return1"
        }
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("var1=" + var1)
        console.log("line8")
        return "return2"
    }

    async withAsyncIfReturnAndVarChange(text: string): Promise<string> {
        console.log("line1")
        console.log("line2")
        let var1 = 1
        console.log("line3")
        console.log("line4")
        if (text) {
            var1 = 2
            console.log("text is not empty")
            return "return1"
        }
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("var1=" + var1)
        console.log("line8")
        return "return2"
    }

    withArrowFun() {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4");
        [1, 2, 3].forEach((item) => {
            console.log(item)
        })
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withArrowFunAndParam(text: string) {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        console.log("line4");
        [1, 2, 3].forEach((item) => {
            console.log(text + " " + item)
        })
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }
    forLoop() {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        for (let i = 0; i < 10; i++) {
            console.log(i)
        }
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    forLoopAndReturn() {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        for (let i = 0; i < 10; i++) {
            console.log(i)
            if (i == 5) {
                return //这个return会中断for循环
            }
        }
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    forEachReturn() {
        console.log("line1")
        console.log("line2")
        console.log("line3");
        [1, 2, 3].forEach((item) => {
            console.log(item)
            if (item == 2) {
                return //forEach中return不会中断forEach循环
            }
            console.log("after " + item)
        })
        console.log("line4")
        console.log("line5")
        console.log("line6")
    }

    doWhileLoop() {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        let i = 0
        do {
            console.log(i)
            i++
        } while (i < 10)
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    whileLoop() {
        console.log("line1")
        console.log("line2")
        console.log("line3")
        let i = 0
        while (i < 10) {
            console.log(i)
            i++
        }
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    delayAssign(text: string) {
        /*
        遇到延迟赋值，需要将返回值通过return返回
        */
        let i = 0
        console.log("line1")
        console.log("line2")
        if (text) {
            i = 1
        } else {
            i = 2
        }
        console.log("i=" + i)
        console.log("line3")
        console.log("line4")
        console.log("line5")
        console.log("line6")
        console.log("line7")
        console.log("line8")
    }

    withArrayReturn(flag: boolean): string[] {
        const a: string[] = ["x"]
        console.log("line1")
        console.log("line2")
        if (flag) {
            return a
        }
        console.log("line3")
        console.log("line4")
        return ["y"]
    }

    withUnionReturn(flag: boolean): string | number {
        console.log("line1")
        console.log("line2")
        if (flag) {
            return "s"
        }
        console.log("line3")
        console.log("line4")
        return 1
    }

    withImportedType(flag: boolean): number {
        const thing = makeThing()
        console.log("line1")
        console.log("line2")
        if (flag) {
            return thing.value
        }
        console.log("line3")
        console.log("line4")
        return 0
    }

    withSpilledArray(flag: boolean): number {
        console.log("line1")
        console.log("line2")
        if (flag) {
            return 0
        }
        const arr: string[] = []
        console.log("line3")
        console.log("line4")
        return arr.length
    }
}