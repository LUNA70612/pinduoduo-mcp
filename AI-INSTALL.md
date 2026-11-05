# 安装与客户端接入

目标环境为 Windows、Node.js 22 或以上及本机 Chrome/Edge。项目默认只读，面向非商业学习与技术研究。

日常使用见 [使用指南](USAGE.md)，工具说明见 [工具与能力](CAPABILITIES.md)，可选 HTTP 见 [HTTP 接入指南](http/README.md)。

## 安装

克隆仓库，或下载源码 ZIP 并解压，在源码目录执行：

```powershell
git clone https://github.com/LUNA70612/pinduoduo-mcp.git
Set-Location '.\pinduoduo-mcp'
.\Install.ps1
```

安装器按锁文件安装依赖、初始化项目内运行目录、安装 9 个 OpenCLI 适配器，并执行安装自检、语法及协议检查。OpenCLI 固定为 2.0.2，stdio 使用者无需安装 HTTP 依赖。

安装自检对 OpenCLI 命令发现单次最多等待 60 秒，检查全部 9 个入口。此预算独立于客户端初始化和工具调用超时。

PowerShell 脚本受限时，可使用以下入口，无需修改系统执行策略：

```powershell
npm run setup
npm run doctor
npm run check
npm run smoke
```

## 启动浏览器

首次使用执行：

```powershell
npm run browser
```

在打开的项目浏览器中人工登录。浏览器使用项目隔离配置，CDP 默认端口为 9222，可按本机需要配置。

已有项目浏览器和登录会话时，直接复用原窗口、CDP 端口及 profile。配置优先读取显式环境变量和 `runtime/browser-config.json`。需要绑定已有浏览器时，将以下示例替换为本机实际值：

```powershell
$env:OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9335'
$env:PDD_BROWSER_PROFILE = 'C:/projects/pinduoduo-mcp/runtime/browser-profile'
npm run bind-browser
```

profile 填写已有浏览器实际使用的目录。`bind-browser` 检查本机 CDP 并生成连接配置；只重新生成项目配置和安装适配器时，可使用 `npm run setup -- --skip-install`。

## 配置 stdio 客户端

安装器生成以下文件，使用 Node 和 `server.cjs` 的本机绝对路径：

| 客户端配置方式 | 生成文件 |
|---|---|
| Codex TOML | `outputs/codex-mcp.generated.toml` |
| mcpServers JSON | `outputs/mcp-config.generated.json` |

将 `pinduoduo` 配置合并到客户端，保留原有设置和其他 MCP 服务，然后重新加载 MCP 连接。

生成的 Codex 配置使用 `startup_timeout_sec=30`、`tool_timeout_sec=240`，并设置 `PDD_ENABLE_WRITES=0`。其他 stdio 客户端需支持本机启动 Node 子进程，每次工具调用预留至少 240 秒。

客户端需提供模型能力；MCP 服务端无需模型 API Key。客户端没有 prompts 界面时，可通过工具说明和 `initialize.instructions` 使用推荐流程。

## 配置本机 HTTP

需要通过本机 URL 连接的客户端，在同一安装目录执行：

```powershell
npm run setup:http
npm run start:http
```

从 `outputs/mcp-http.connection.local.json` 读取 URL、Bearer 请求头及超时设置，按客户端界面填写。HTTP 默认地址为 `http://127.0.0.1:4176/mcp`，建议每次调用至少预留 300 秒。

本机 HTTP 使用独立依赖和配置，原 stdio 配置保持可用。完整参数见 [HTTP 接入指南](http/README.md)。

## 加载检查

客户端加载后，可发现 10 个工具和 3 个模板。先调用 `pdd_status` 检查浏览器连接，再提出购物需求或执行新的搜索。

| 状态字段 | 含义 |
|---|---|
| `browser_connected` | 本机 CDP 是否可连接 |
| `login_status:"not_checked"` | 状态查询尚未检查页面登录 |
| `login_policy:"manual"` | 登录由使用者本人完成 |
| `writes_enabled:false` | 写权限关闭 |

兼容字段 `user_login_required:true` 表示人工登录策略。日常连接检查使用 `pdd_status`；`pdd_resume` 默认检查会话，显式恢复按工具返回的条件执行。

页面调用按默认 90 秒间隔串行执行。一次搜索及后续读取使用同一 MCP 连接，搜索来源有效期为 30 分钟；新连接或来源到期后重新搜索。

## 本机数据

运行配置、登录 profile、Cookie、缓存、任务状态和客户端连接资料保存在使用者自己的电脑，不进入 Git 或源码包。含令牌的 HTTP 连接文件仅供本机配置使用。

项目采用 [PolyForm Noncommercial 1.0.0](LICENSE)，分发需保留许可及第三方声明。
