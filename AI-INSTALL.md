# 安装与客户端接入

目标环境：Windows、本机Chrome/Edge、Node.js 22及以上。默认只读，面向非商业学习与技术研究，非官方API。

本文件供安装者和协助安装的AI使用。购物使用见 [USAGE.md](USAGE.md)，能力范围见 [CAPABILITIES.md](CAPABILITIES.md)。

## 首次安装

1. 克隆仓库或解压源码ZIP；维护者另行提供的预览包如附有MANIFEST.sha256，可核对逐文件哈希。
2. 确认Node.js和浏览器已安装，进入实际解压目录。
3. 执行安装器：

```powershell
Set-Location 'E:/Codex/pinduoduo-mcp' # 替换为实际源码目录
.\Install.ps1
```

安装器按锁文件执行npm ci --ignore-scripts，在项目内初始化依赖、缓存和运行目录，安装9个适配器，并运行doctor、语法和协议检查。它生成JSON和Codex TOML两种配置，不自动改写客户端全局配置。

环境禁止执行PowerShell脚本时，使用以下现有入口，无需修改系统执行策略：

```powershell
npm run setup
npm run doctor
npm run check
npm run smoke
```

4. 首次启动项目隔离浏览器：

```powershell
npm run browser
```

5. 在该窗口人工扫码登录。不要在聊天里提交密码、验证码或Cookie。
6. 合并生成配置，并让客户端加载MCP；确认可发现10个工具和3个prompts。客户端未提供prompts界面时，工具及initialize.instructions仍可使用。

浏览器需在执行页面工具前启动。项目通过本机CDP连接，不需要浏览器扩展或云端转发服务。

## 复用已有登录会话

如果已有项目Chrome/Edge、登录profile和本机CDP绑定，直接复用原窗口和配置。以下以9335为例；实际端口不同则使用原值，不按新用户默认9222重开，也不要清登录数据。

配置优先读取显式环境及runtime/browser-config.json。只有绑定确实需要修正时，才在当前终端设置正确值：

```powershell
$env:OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9335'
$env:PDD_BROWSER_PROFILE = 'E:/Codex/pinduoduo-mcp/runtime/browser-profile-chrome-normal'
npm run bind-browser
```

profile必须替换为已有浏览器实际使用的目录，不能为绑定而新建登录环境。bind-browser会检查本机CDP并更新生成配置，不导航购物页面。若只需重新生成配置和安装适配器，使用npm run setup -- --skip-install。环境只影响当前进程及子进程，不修改系统全局设置。

## 客户端配置

| 客户端 | 生成文件 | 要求 |
|---|---|---|
| Codex | outputs/codex-mcp.generated.toml | 合并pinduoduo片段，保留其他设置 |
| mcpServers JSON客户端 | outputs/mcp-config.generated.json | 合并pinduoduo项，保留其他服务 |

生成配置使用Node与server.cjs的绝对路径，PDD_ENABLE_WRITES=0。Codex片段启用服务并设置startup_timeout_sec=30、tool_timeout_sec=240。其他客户端需支持本地stdio，并给每次工具调用至少240秒；按步骤串行调用，排队仍可能超时。

Codex已有实际调用和重启恢复验证。其他客户端需支持本地stdio MCP及可配置的调用超时，实际兼容性需自行确认。服务端不需要模型API Key，客户端本身需提供模型能力。

## 加载与恢复检查

先调用pdd_status。browser_connected=true只说明CDP可连接；login_status=not_checked表示尚未检查登录，login_policy=manual表示登录由本人完成。兼容字段user_login_required=true不表示当前页面未登录，不应据此打开登录页。当前任务与历史记录分别统计，历史等待记录不能证明当前需要登录或验证。

pdd_resume默认只检查当前页，不导航、不刷新。session_unknown表示现场证据不足，不等于未登录。仅有明确登录墙或验证码时才需要人工处理。新连接必须重新执行pdd_search，再读取该次搜索的商品。

显式retry:true还须满足原执行已结束、会话有效和同连接搜索来源可用。执行是否结束未知时不重放。恢复和来源期限均为30分钟。

异常退出如留下锁，先检查拥有者进程与页面；npm run unlock仅清理已退出进程的锁，不删除操作记录，不重试请求。不要运行会覆盖维护记录的旧live-*脚本来验证日常连接。

## 文件与许可

运行时、profile、Cookie、缓存、state和个人客户端配置均留在本机，不纳入Git或源码包。固定OpenCLI2.0.2，依赖升级另行验证。

项目使用PolyForm Noncommercial1.0.0。分发需保留LICENSE、NOTICE、LICENSING.md及THIRD-PARTY-NOTICES.md。
