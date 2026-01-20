# 项目介绍
本项目为TS修改工具。使用deno编译。支持修改TS文件的类名、方法名、属性名。

# 注意
    测试目录(test dir) 不使用deno编译，仅使用jest运行测试用例
    测试用例目录(test-case dir) 为测试用例目录，不参与编译。

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