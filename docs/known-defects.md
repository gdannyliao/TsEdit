# 已知缺陷（2.0.3，待修）

两条都在 `--split-method` 的方法拆分路径上，都**不报错地**产出坏代码或直接崩在运行期/构建期。
2.0.3 至今未修；发现于 `mainPack/domino`（Cocos 2.4.15 主包）的首次接入，captain 包因为
"恰好全部写了花括号循环、且 `for...of` 循环体没有被拆到"而从未触发。

两处的**通用检测手段**见文末「建议的验收门」——不需要真机也能拦住。

---

## 缺陷 1：无花括号的单行循环体让 `--split-method` 直接崩溃

**严重度**：构建期硬失败（打包中断）。
**现象**：

```
TypeError: Cannot read properties of undefined (reading 'getStatements')
    at .../methodSplit/Scopes.js:110
```

报错信息里**没有文件名、没有方法名、没有行号**，只有工具内部的栈——排查成本极高：
必须靠二分整个工程才能定位到是哪个循环体。

**最小复现**（3 秒）：

```ts
// a.ts
const arr = [1, 2, 3];
export function touch(x: number) { console.log(x); }
export class A {
  run(): void {
    for (const x of arr) touch(x);   // 单行、无花括号
  }
}
```

```bash
tsedit --project <dir> --split-method --rename --seed pkg:x
```

给该循环体加上花括号后同一命令成功（`obfus success`）。

**根因**：`src/methodSplit/Scopes.ts` 里对循环/条件语句取循环体时用了非空断言：

```ts
// 现 2.0.3 写法（约 501/512/522/529/574 行，ForOf/For/ForIn/While/Do/With 各一处）
scanInternal(SyntaxKind.ForOfStatement, forOfStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope, ...)
```

`getStatement()` 返回的是 `Statement`——单行循环体是 `ExpressionStatement`，`asKind(Block)` 得
`undefined`，`!` 把类型掩盖过去，随后 `new Scope()` 里 `block.getStatements()` 抛异常。
作者在 `ForStatement` 分支留了 `//FIXME ... 单行时有可能不是 BlockStatement`，说明当时已知，
但只标注未处理。

**建议修法**（任一，推荐 A）：

- **A. 统一用"语句容器"抽象**：`Scope` 不接收 `Block`，接收 `StatementedNode`；对非 Block 的
  单行体，构造一个只含该语句的虚拟容器（ts-morph 的 `getStatements()` 等价物用
  `[stmt]` 数组包一层），`startLine/endLine` 取该语句行。
- **B. 先规范化再扫描**：在 `scanInternal` 入口把非 Block 循环体包成 Block
  （`stmt.replaceWithText('{ ... }')` 等价）再走原路径——改动小，但会改写出源码，需注意
  "只读分析"的语义边界。

**回归测试**（放在 `test/MethodSplit.test.ts` + `test-case/methodSplit/`）：

1. 夹具 `UnbracedLoopBody.ts`：包含 `for...of` / `for` / `for...in` / `while` / `do...while`
   五种**单行无花括号**循环体，各自在方法内。
2. 断言：`runSplit()` 不抛异常；输出工程 `getPreEmitDiagnostics()` 为空（现有
   `loadOutputProject()` 已具备 strict 断言）。
3. 参数化：同一夹具再跑一次"全部带花括号"的变体，确认两种写法都过。

---

## 缺陷 2：拆分 `for...of` 循环体时丢掉循环绑定（产物运行期 ReferenceError）

**严重度**：**最高**——构建成功、打包成功、`tsc`（对源码）通过，只在真机运行到该分支时崩。

**现象**（设备日志）：

```
Uncaught ReferenceError: candidate is not defined
  [0]t.z_iPiC5j7e4h@assets/main/index.a0a31.jsc:2497     ← 被拆出来的循环体
  [1]t.m_iRKhRd@...                                        ← 原方法
  ...
```

对应源码（拆分前完全合法）：

```ts
for (const candidate of groups) {
  if (candidate.chapter === level.chapter) group = candidate;
}
```

拆分后产物：

```ts
// 原方法里
[group] = this.z_iPiC5j7e4h(group, level);
// 拆出的新方法（groups 没传进来，candidate 更是从未在此作用域声明）
z_iPiC5j7e4h(group: { ... }, level: LevelDef): [{ ... }] {
  if (candidate.chapter === level.chapter) group = candidate;   // ← ReferenceError
  return [group];
}
```

同一路径还有第二种表现——**注入参数与局部 `const` 撞名**：

```ts
// 拆出的方法签名注入了 vertical，而方法体里有 const vertical
z_XvXpLLJ9ke(state, id, row, column, vertical: boolean): [boolean, number, boolean, boolean] {
  ...
  const vertical = !this.p_R8tAAI;   // TS2300 Duplicate identifier 'vertical'
```

ES5 产物里 `var vertical` 会覆盖同名参数——本例因该参数"是死的"而侥幸无害，但这是
**偶然**，不是正确性。

**最小复现**（不需要 Cocos 工程，一个文件即可）：

```ts
// b.ts
export interface G { chapter: number }
export class L {
  pick(groups: G[], level: G): G | null {
    let group: G | null = null;
    for (const candidate of groups) {
      if (candidate.chapter === level.chapter) group = candidate;
    }
    return group;
  }
}
```

```bash
tsedit --project <dir> --split-method --rename --seed pkg:x
cd <dir> && npx tsc --noEmit   # → TS2304: Cannot find name 'candidate'
```

真实工程里一次 `--split-method` 跑出 4 条这类错误（2 处 `candidate` + 2 处 `Duplicate identifier`），
把循环改成 `groups.filter(g => g.chapter === level.chapter).pop()` 之后降到 0。

**根因（推测，需在 `Scopes.ts` 确认）**：`for...of` 的绑定（`candidate`）声明在
`ForOfStatement` 自己的作用域里，而拆分把循环体的**语句块**提升成同级方法。自由变量注入列表
里没有把 `for...of` 的绑定算进"被捕获变量"，于是新方法既没收到 `candidate`，也没有收到
`groups`。缺陷 1 的 `asKind(Block)!` 与这里同属"循环体不是一个普通 Block、却被当成普通 Block
处理"。

**建议修法**：

1. `Scopes.ts` 扫描 `ForOfStatement` / `ForInStatement` 时，把
   `getInitializer()`（`const candidate`）显式登记进该循环体作用域的 variables，使其成为
   子作用域的自由变量，从而进入注入参数列表。
2. 注入参数名与目标作用域已有局部声明/参数的冲突检测：撞名时加后缀（或把局部改名），
   不要产出 `Duplicate identifier`。
3. 若短期难修，**降级策略**：对含有"非平凡 `for...of` / `for...in` 循环体"的方法跳过拆分
   （宁可少拆，也不要产出运行期会崩的代码），并在日志里记一条 `skip split: <class>.<method>`。

**回归测试**：

1. 夹具 `SplitWithForOf.ts`：方法体内 `for...of` 循环体引用循环绑定、参数、`this` 成员各一处。
2. 断言（现有 `loadOutputProject()` 的 strict 诊断为空即可覆盖绝大部分）：输出必须 0 诊断。
3. 再加一条**行为**断言：把输出工程编译成 JS 后调用一次该方法的等价逻辑（或在输出上做
   `Candidate` 名称可达性检查），确保不是"能编译但语义丢了"。
4. 夹具覆盖 `for...in`、`while` 内 `const` 与参数同名的情况（缺陷 2 的第二形态）。

---

## 建议的验收门（调用方侧，已被下游工程采用）

跑一次 `--split-method --rename --reset-uuid --seed <真实种子>` 后，**对产物**（不是源码）跑
`tsc --noEmit`：

- 缺陷 1：拆分阶段直接抛异常，命令非零退出即可发现。
- 缺陷 2：产物里 `Cannot find name` / `Duplicate identifier` 会被 tsc 抓出来。

下游参考实现：`mainPack/domino/tools/obfus-check.mjs`（复制工程 → 同款参数跑 tsedit →
对产物 tsc → 任一 `error TS` 即失败）。**注意种子要与真实构建一致**（本工具用
`pkg:<application_id>`），因为拆分点随种子变化——换种子就是换一组拆分点，等于换一批潜在崩溃点。

建议本仓库把它做进自己的测试：`npm test` 里加一个"对 `test-case/methodSplit` 产物跑 strict
诊断"的用例（现有 `loadOutputProject()` 已有该断言，只需补夹具）。

---

## 附：环境与证据

- tsedit 2.0.3（`bin/tsedit` 由 `npm run package` 产出；`dist/` 与 `bin/` 同步）。
- 发现工程：`mainPack/domino`（Cocos Creator 2.4.15，TS 目标 es5，`--split-method --rename
  --reset-uuid --seed pkg:abc.domino.dev`）。
- 相关记录：`mainPack/domino/README.md`「已知限制」；实施侧报告
  `.superpowers/sdd/2026-10-19-domino-cocos-mainpack/{task-11-report.md,split-safety-report.md}`；
  设计文档 `upCentral/docs/superpowers/specs/2026-10-19-domino-cocos-mainpack-design.md` §11。
