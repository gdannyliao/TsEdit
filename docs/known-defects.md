# 已修复缺陷（2.0.3 之后的 `--split-method` 修复）

两条都在 `--split-method` 的方法拆分路径上，都**不报错地**产出坏代码或直接崩在运行期/构建期。
发现于 `mainPack/domino`（Cocos 2.4.15 主包）的首次接入：captain 包因为
"恰好全部写了花括号循环、且 `for...of` 循环体没有被拆到"而从未触发。

**当前状态：两条均已修复**，回归用例在
[`test/MethodSplitRegression.test.ts`](../test/MethodSplitRegression.test.ts)：

- 单行无花括号的 `for` / `for...of` / `for...in` / `while` / `do...while` 均不再崩溃；
- 单行 `for...of` 循环体拆分后仍能拿到循环绑定；
- 拆分方法不会再把局部变量同时当参数注入（`Duplicate identifier`）。

验证：`npm test` 45 passed（5 suites）；另取 domino 修复前的完整快照（含 15 处单行循环体）
用当前源码跑 `--split-method --rename --reset-uuid --seed pkg:abc.domino.dev`，再对产物跑
`tsc --noEmit`，0 诊断。

两处的历史分析保留在下面，末尾的「建议的验收门」仍适用于下游工程。

---

## 缺陷 1：无花括号的单行循环体让 `--split-method` 直接崩溃

**状态**：已修复。`Scopes.ts` 的 `ensureBlock()` 在扫描循环/`with` 体前，把非 Block
的单条语句包成 Block（只加一对花括号、不改变行数），后续作用域分析与拆分继续面对
真正的 Block。`asKind(Block)!` 的非空断言已全部移除。

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
// 2.0.3 的写法（ForOf/For/ForIn/While/Do/With 各一处）
scanInternal(SyntaxKind.ForOfStatement, forOfStmt.getStatement().asKind(SyntaxKind.Block)!, parentScope, ...)
```

`getStatement()` 返回的是 `Statement`——单行循环体是 `ExpressionStatement`，`asKind(Block)` 得
`undefined`，`!` 把类型掩盖过去，随后 `new Scope()` 里 `block.getStatements()` 抛异常。
作者在 `ForStatement` 分支留了 `//FIXME ... 单行时有可能不是 BlockStatement`，说明当时已知，
但只标注未处理。

**修复**：采用"先规范化再扫描"（历史建议 B）。`ensureBlock()` 对非 Block 的单行体执行
`stmt.replaceWithText('{ ' + stmt.getText() + ' }')`，只增加一对花括号、不改变行数；
`ForOf` / `For` / `ForIn` / `While` / `Do` / `With` 六个分支统一经过它。

**回归测试**：`test/MethodSplitRegression.test.ts` 参数化覆盖上述五种循环体，断言
`visitMethod()` 不抛异常、输出 `getPreEmitDiagnostics()` 为空，并确认确实生成了 `z_*` 新方法。
（夹具体量小，放内存即可，不需要 `test-case/` 磁盘工程。）

---

## 缺陷 2：拆分 `for...of` 循环体时丢掉循环绑定（产物运行期 ReferenceError）

**状态**：已修复（含 `Duplicate identifier` 同源表现）。修复点见本节末尾。
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
// b.ts —— 注意循环体必须和 for 写在同一行
export interface G { chapter: number }
export class L {
  pick(groups: G[], level: G): G | null {
    let group: G | null = null;
    for (const candidate of groups) { if (candidate.chapter === level.chapter) group = candidate; }
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

**根因（已确认，与最初的推测不同）**：循环绑定其实**已经**被登记进了 `ForOfStatement`
作用域，问题出在同一行的两个语法位置无法用行号区分：

- `candidate` 的 `startLine/endLine` 是循环所在的**同一行**；
- 被拆出去的循环体也是同一行。

`Scope.collectDataIn()` 只看行号，`compare()` 认为两者范围相等（case 0），于是把
`candidate` 当成"拆分范围内新声明的变量"（`newVarsInRange`），既不注入参数、也不返回，
产物就成了 `Cannot find name 'candidate'`。多行写法下循环头在第 1 行、循环体在第 2 行，
比较结果不同，所以最初的最小复现无法稳定触发。

第二形态（`Duplicate identifier`）来自同一条链路的另一个对象身份问题：
`rebuildScope()` 把旧 `Variable` 当参数传给新作用域，重新扫描同一声明时又创建了一个
同名的新 `Variable`。旧对象残留在 `invokedVars` 里，与新 `vars` 里的对象"同名不同身份"，
于是同一个 `vertical` 既被当成注入参数、又被当成方法体内的 `const`。

**修复**：

1. `Variable` 增加 `startPos`（声明起点）。`collectDataIn()` 额外接收拆分范围的
   `startPos/endPos`；声明起点在拆分范围之前的变量一律视为外部变量，不再参与
   "新方法内新变量"的判定。循环头与同一行循环体由此可以区分。
2. `Scope.addVariable()` 在同一作用域内替换同名 `Variable` 时，把 `invokedVars` 里的
   旧对象记录移交给新对象，消除"同名不同身份"，不再给已声明为局部的变量注入同名参数。

**回归测试**：`test/MethodSplitRegression.test.ts` 包含：

1. 单行 `for...of` 且循环体引用循环绑定的夹具，断言输出 0 诊断；
2. 与 domino `GameScreen.placeAt` 同型的 `const vertical` 夹具，多 seed 跑拆分，
   断言 0 诊断且新方法参数名不出现在方法体局部声明中。

---

## 建议的验收门（调用方侧，已被下游工程采用）

跑一次 `--split-method --rename --reset-uuid --seed <真实种子>` 后，**对产物**（不是源码）跑
`tsc --noEmit`：

- 缺陷 1：拆分阶段直接抛异常，命令非零退出即可发现。
- 缺陷 2：产物里 `Cannot find name` / `Duplicate identifier` 会被 tsc 抓出来。

下游参考实现：`mainPack/domino/tools/obfus-check.mjs`（复制工程 → 同款参数跑 tsedit →
对产物 tsc → 任一 `error TS` 即失败）。**注意种子要与真实构建一致**（本工具用
`pkg:<application_id>`），因为拆分点随种子变化——换种子就是换一组拆分点，等于换一批潜在崩溃点。

本仓库自己的防线：`test/MethodSplitRegression.test.ts` 用内存夹具锁住上述两类语法结构，
不依赖 Cocos 工程或真实 seed；下游的 `obfus-check.mjs` 仍是最终闸门，两者互补。

---

## 附：环境与证据

- tsedit 2.0.3（`bin/tsedit` 由 `npm run package` 产出；`dist/` 与 `bin/` 同步）。
- 发现工程：`mainPack/domino`（Cocos Creator 2.4.15，TS 目标 es5，`--split-method --rename
  --reset-uuid --seed pkg:abc.domino.dev`）。
- 相关记录：`mainPack/domino/README.md`「已知限制」；实施侧报告
  `.superpowers/sdd/2026-10-19-domino-cocos-mainpack/{task-11-report.md,split-safety-report.md}`；
  设计文档 `upCentral/docs/superpowers/specs/2026-10-19-domino-cocos-mainpack-design.md` §11。
