import { Node, Project } from "ts-morph"
import { MethodSplitVisitor2 } from "../src/methodSplit/MethodSplit2"

/**
 * `--split-method` 的回归用例。
 *
 * 对应 docs/known-defects.md 记录的两类问题：
 *   1. 单行无花括号循环体 —— 旧实现 `asKind(Block)!` 拿 undefined，`new Scope()`
 *      里直接 `getStatements()` 崩溃，且报错不带文件名/方法名。
 *   2. 拆分循环体时丢掉循环绑定 —— `for (const candidate of groups) { ... }`
 *      写在一行里时，`candidate` 与循环体共享行号，被误判为“拆分范围内新声明的
 *      变量”，既没传参也没返回，产物 `Cannot find name 'candidate'`。
 *
 * 夹具放在内存里：这两个问题都由语法结构触发，不需要 Cocos 工程或磁盘文件。
 */

function splitAll(sourceText: string, seed: string = "pkg:regression"): {
    output: string
    diagnostics: string[]
} {
    const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { strict: true, target: 2, noEmit: true },
    })
    const sourceFile = project.createSourceFile("/fixture.ts", sourceText)
    const visitor = new MethodSplitVisitor2(seed)

    for (const cls of sourceFile.getClasses()) {
        // getMethods() 先取快照：拆分过程中会往类里追加 z_* 新方法，递归访问它们没有意义
        for (const method of cls.getMethods()) {
            visitor.visitMethod(cls, method)
        }
    }

    return {
        output: sourceFile.getFullText(),
        diagnostics: project.getPreEmitDiagnostics().map(d => {
            const message = d.getMessageText()
            return typeof message === "string" ? message : message.getMessageText()
        }),
    }
}

const UNBRACED_LOOPS: Array<[string, string]> = [
    ["for", `for (let i = 0; i < nums.length; i++) touch(nums[i]);`],
    ["for...of", `for (const n of nums) touch(n);`],
    ["for...in", `for (const key in table) touch(table[key]);`],
    ["while", `let i = 0; while (i < nums.length) touch(nums[i++]);`],
    ["do...while", `let i = 0; do touch(nums[i++]); while (i < nums.length);`],
    ["nested", `for (const n of nums) for (const m of nums) touch(n + m);`],
]

test.each(UNBRACED_LOOPS)("单行无花括号的 %s 循环体不再让拆分崩溃", (_name, loop) => {
    // 方法至少 3 句才会进入拆分路径
    const source = `
const nums = [1, 2, 3];
const table: Record<string, number> = { a: 1 };
function touch(x: number): void { console.log(x); }

class UnbracedLoop {
    run(): void {
        console.log("before");
        ${loop}
        console.log("after");
    }
}
`
    let result: ReturnType<typeof splitAll> | undefined
    expect(() => { result = splitAll(source) }).not.toThrow()

    expect(result!.diagnostics).toEqual([])
    // 真的拆了：原方法里只剩调用，循环体进了 z_* 新方法
    expect(result!.output).toMatch(/z_\w+/)
})

test("单行 for...of 循环体拆分后仍能拿到循环绑定", () => {
    const source = `
export interface Group { chapter: number }

export class ChapterPicker {
    pick(groups: Group[], level: Group): Group | null {
        let group: Group | null = null;
        for (const candidate of groups) { if (candidate.chapter === level.chapter) group = candidate; }
        return group;
    }
}
`
    const { output, diagnostics } = splitAll(source, "pkg:abc.domino.dev")

    // 产物的 tsc 诊断是最终判据：旧实现在这里报两条 Cannot find name 'candidate'
    expect(diagnostics).toEqual([])
    // 循环体被搬进了新方法，但循环本身仍在原方法里
    expect(output).toContain("for (const candidate of groups)")
})

test("拆分出的方法不会同时把局部变量当参数传入", () => {
    // 与 domino 的 GameScreen.placeAt 同型：一个局部 const 与注入参数同名时，
    // 旧实现会产出 `z_x(..., vertical: boolean) { const vertical = ... }`，
    // tsc 报 TS2300 Duplicate identifier。
    const source = `
class Engine {
    canPlace(id: number, row: number, column: number, vertical: boolean): boolean { return true; }
}

class Board {
    private horizontal = true;
    private engine = new Engine();
    private ghost: any = null;
    private hint: any = null;
    private selected = 0;
    private level = { movablePlanterCount: 3 };
    private movablePlanterAt(state: any, row: number, column: number): number { return -1; }
    private selectPlanter(id: number, vertical?: boolean): void { this.horizontal = vertical === undefined ? true : !vertical; }
    private tryPlace(id: number, row: number, column: number, vertical: boolean): void {}
    private setMessage(s: string): void {}
    private refresh(): void {}

    placeAt(row: number, column: number): void {
        if (!this.engine || !this.level) return;
        const state = this.snapshot();
        if (state.status !== "PLAYING") return;
        const id = this.selected;
        if (id < 0 || id >= this.level.movablePlanterCount) {
            this.setMessage("Pick a planter from the tray first.");
            return;
        }
        const occupant = this.movablePlanterAt(state, row, column);
        if (occupant >= 0 && occupant !== id) {
            this.selectPlanter(occupant, state.placements[occupant].vertical);
            return;
        }
        const vertical = !this.horizontal;
        if (this.engine.canPlace(id, row, column, vertical)) {
            this.tryPlace(id, row, column, vertical);
            return;
        }
        const flipped = !vertical;
        if (this.engine.canPlace(id, row, column, flipped)) {
            this.tryPlace(id, row, column, flipped);
            return;
        }
        this.ghost = { id: id, row: row, column: column, vertical: vertical };
        this.hint = null;
        this.setMessage("Two free soil cells are needed.");
        this.refresh();
    }

    snapshot(): any { return { status: "PLAYING", placements: [] }; }
}
`
    // 拆分点随 seed 变化，多跑几个种子，避免只测到“恰好没撞上”的那一条路径
    for (const seed of ["pkg:abc.domino.dev", "pkg:seed-1", "pkg:seed-2", "pkg:seed-3"]) {
        const { output, diagnostics } = splitAll(source, seed)
        expect({ seed, diagnostics }).toEqual({ seed, diagnostics: [] })

        // 结构上的硬约束：新方法的参数名不能同时出现在方法体的顶层局部声明里
        expect(paramLocalCollisions(output)).toEqual([])
    }
})

/** 解析产物，返回「同名参数 + 顶层 const/let」的冲突列表。 */
function paramLocalCollisions(output: string): string[] {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile("/output.ts", output)
    const collisions: string[] = []

    for (const cls of sourceFile.getClasses()) {
        for (const method of cls.getMethods()) {
            const body = method.getBody()
            if (!body || !Node.isBlock(body)) continue
            const params = new Set(method.getParameters().map(p => p.getName()))
            for (const stmt of body.getStatements()) {
                if (!Node.isVariableStatement(stmt)) continue
                for (const decl of stmt.getDeclarationList().getDeclarations()) {
                    const name = decl.getName()
                    if (params.has(name)) {
                        collisions.push(`${cls.getName()}.${method.getName()}:${name}`)
                    }
                }
            }
        }
    }
    return collisions
}
