# 测试与检查

本项目使用 Node.js 内置测试框架，并提供语法、MCP 协议、HTTP 和核心文件保护检查。以下命令用于本地开发及持续集成。

## 基础检查

在源码目录执行：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run install:adapters
npm.cmd test
npm.cmd run check
npm.cmd run smoke
npm.cmd run check:frozen
```

| 命令 | 用途 |
|---|---|
| `npm.cmd test` | 页面解析、规格与价格、筛选、状态和队列回归 |
| `npm.cmd run check` | JavaScript 语法检查 |
| `npm.cmd run smoke` | stdio 初始化、工具发现、只读闸门与 ping |
| `npm.cmd run check:frozen` | 固定基线、逐文件哈希及依赖保护 |
| `npm.cmd run doctor` | 本机安装、适配器发现及连接检查 |

本地回归使用脱敏 fixture 和隔离环境。测试按文件串行执行，具体数量和结果以命令输出为准。

## 官方 SDK 检查

SDK 安装在独立工作目录，不加入主项目生产依赖：

```powershell
npm.cmd install --prefix work/mcp-sdk-validation --ignore-scripts --no-package-lock --no-save @modelcontextprotocol/sdk@1.32.2
node scripts/sdk-check.cjs --output work/sdk-protocol.json
```

检查内容包括独立连接、工具和模板发现、参数校验、业务返回及 ping。输出保存在忽略目录，仅供本机使用。

## HTTP 检查

```powershell
npm.cmd run setup:http
npm.cmd run test:http
```

HTTP 检查覆盖官方 SDK 接入、工具与模板、结构化结果和图片转发、认证、会话隔离、超时、连接生命周期及子进程清理。客户端配置步骤见 [HTTP 接入检查](http/VALIDATION.md)。

## 持续集成

仓库 CI 在 Windows 和 Node.js 22 环境安装锁定依赖，运行核心保护、Node.js 回归、语法、stdio 和 HTTP 检查。Git 仓库中可执行以下命令核对冻结清单的历史来源：

```powershell
node http/check-frozen.cjs --verify-git
```

源码 ZIP 使用固定文件清单检查；Git 来源核对由带有完整历史的仓库执行。

## 维护者打包

```powershell
npm.cmd run release:check
npm.cmd run release:source
```

发布命令使用维护者本机发布材料，检查通过后生成源码包。普通安装、运行和本地测试不依赖这些材料。

生成包按白名单收录源码、文档、锁文件、许可和必要测试，使用 `SOURCE-INFO.json` 记录提交，使用 `MANIFEST.sha256` 记录文件哈希。发布检查保持只读权限，并排除本机配置、浏览器资料、Cookie、缓存和运行记录。
