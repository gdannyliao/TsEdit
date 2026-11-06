# 项目介绍
本项目为TS修改工具。使用deno编译。支持修改TS文件的类名、方法名、属性名。

# 注意
    测试目录(test dir) 不使用deno编译，仅使用jest运行测试用例
    测试用例目录(test-case dir) 为测试用例目录，不参与编译。

# 已修复缺陷（2.0.3 之后）
`--split-method` 曾有两条会直接崩溃或产出坏代码的缺陷：单行无花括号循环体导致崩溃、
拆分单行 `for...of` 循环体时丢掉循环绑定（产物 `Cannot find name` / 运行期
`ReferenceError`），以及注入参数与局部变量同名（`Duplicate identifier`）。
两条现已修复，并由 [test/MethodSplitRegression.test.ts](test/MethodSplitRegression.test.ts)
覆盖；最小复现、根因与修复方式见 [docs/known-defects.md](docs/known-defects.md)。

## Building

### Compile TypeScript
```bash
npm run build
```

### Package as executable

For current platform (macOS):
```bash
npm run package
```

For all platforms:
```bash
npm run package:all
```

The packaged executable will be in `bin/tsedit`.