# 第三方依赖与许可

## @jackwener/opencli 2.0.2

- 来源：[npm package](https://www.npmjs.com/package/@jackwener/opencli)
- 用途：本机 OpenCLI 浏览器桥和 CLI 运行时。
- 本项目未修改其源码；仅把本项目的 `pdd` 适配器复制到项目隔离的 OpenCLI user-clis 目录。
- 许可证：Apache-2.0，随包正文另保留在 `third-party/OpenCLI-LICENSE-2.0.txt`；随依赖的版权声明继续保留。

## 其他依赖

具体版本和许可证以 `package-lock.json` 及各依赖包自身的许可证文件为准。发布源码包时不得删除第三方许可证和本文件。

`linkedom` 0.18.12 仅用于 DOM fixture 测试，不用于生产采集。本项目的非商业条款不改变 OpenCLI 或其他第三方依赖各自授予的权利。

可选独立协议测试使用 `@modelcontextprotocol/sdk` 1.32.2（来源 https://github.com/modelcontextprotocol/typescript-sdk ），只安装在本地 work/ 下，不属于生产依赖或源码 ZIP 的内含代码。其许可随该依赖自身保留。
