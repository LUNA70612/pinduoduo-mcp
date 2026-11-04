# 第三方依赖与许可

## @jackwener/opencli 2.0.2

- 来源：[npm package](https://www.npmjs.com/package/@jackwener/opencli)
- 用途：本机 OpenCLI 浏览器桥和 CLI 运行时。
- 本项目未修改其源码；仅把本项目的 `pdd` 适配器复制到项目隔离的 OpenCLI user-clis 目录。
- 许可证：Apache-2.0，随包正文另保留在 `third-party/OpenCLI-LICENSE-2.0.txt`；随依赖的版权声明继续保留。

## 其他依赖

具体版本和许可证以 `package-lock.json` 及各依赖包自身的许可证文件为准。发布源码包时不得删除第三方许可证和本文件。

`linkedom` 0.18.12 仅用于 DOM fixture 测试，不用于生产采集。本项目的非商业条款不改变 OpenCLI 或其他第三方依赖各自授予的权利。

## @modelcontextprotocol/sdk 1.32.2

- 来源：[TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
- 用途：可选本机HTTP模块的标准MCP传输及独立协议验证；原stdio入口不依赖此SDK。
- HTTP依赖固定在`http/package-lock.json`，仅选择HTTP入口时安装；独立stdio协议验证仍可安装于本机work目录。
- 许可证：MIT，正文保留于`third-party/MCP-SDK-LICENSE-1.32.2.txt`。源码ZIP不内含下载的SDK或其node_modules。

HTTP的传递依赖版本以独立锁文件为准，各依赖保留自身许可。本项目的非商业条款不改变第三方依赖各自授予的权利。
