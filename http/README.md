# 本机 HTTP 接入

可选 HTTP 模块提供 MCP Streamable HTTP 接口，将每个会话转接到同一安装目录的 stdio 服务，复用商品读取、图片、规格、价格和状态能力。10 个工具、3 个模板及原参数保持兼容，HTTP 子进程强制关闭写权限。

## 安装与启动

先按[安装指南](../AI-INSTALL.md)安装主项目并连接自己的浏览器，再在同一源码目录执行：

```powershell
npm.cmd run setup:http
npm.cmd run start:http
```

默认监听 `http://127.0.0.1:4176/mcp`。保持启动终端运行；停止 HTTP 服务即可关闭该入口，stdio 和浏览器独立运行。

HTTP 依赖使用独立锁文件，安装在 `http/` 目录。只使用 stdio 时无需安装本模块。

## 客户端配置

`setup:http` 生成 `outputs/mcp-http.connection.local.json`，按客户端界面填写其中的连接信息：

| 配置项 | 设置 |
|---|---|
| 传输 | MCP Streamable HTTP |
| URL | 默认 `http://127.0.0.1:4176/mcp` |
| 认证 | `Authorization: Bearer <本机生成的令牌>` |
| 工具超时 | 建议至少 300 秒 |
| 调用方式 | 同一会话内按步骤串行执行 |

令牌通过请求头传入，连接文件仅供本机使用。HTTP 支持 `/mcp` 的 POST、GET 和 DELETE，并校验 Bearer、Host 和 Origin。

客户端需要从本机访问回环 URL、发送认证请求头并保持 MCP 会话。此入口用于本机接入；浏览器 CDP 端口与 MCP HTTP 端口分别配置。

## 修改端口

停止旧 HTTP 服务，在同一终端设置新端口并启动：

```powershell
$env:PDD_HTTP_PORT = '4177'
npm.cmd run setup:http
npm.cmd run start:http
```

端口范围为 1024～65535。配置使用明确指定的端口，重复 setup 保留已有令牌。项目配置均保存在本机，不改写客户端全局设置。

## 会话与浏览器

一次搜索及后续详情、规格调用保持同一 MCP 会话。新会话重新搜索，搜索来源有效期为 30 分钟。

最多保留 4 个 HTTP 会话，空闲 30 分钟后释放；执行中的调用结束后再清理子进程。连接中断或结果待确认时，按状态提示检查原调用，再继续建立搜索来源。

HTTP 和 stdio 共用同一安装目录的浏览器锁及默认 90 秒间隔。连接可以共存，同一浏览器的页面任务依次执行。

每位使用者在自己的电脑安装项目、绑定浏览器并人工登录。HTTP 仅监听本机回环地址，采用本机生成的 Bearer 令牌。

## 开发检查

```powershell
npm.cmd run check:frozen
npm.cmd run test:http
```

核心保护核对固定基线及经过审阅的逐文件变更；HTTP 测试使用官方 SDK 检查协议、转发和会话管理。客户端设置检查步骤见 [HTTP 接入检查](VALIDATION.md)，开发命令见[测试指南](../TESTING.md)。

本模块使用 MCP SDK 1.32.2，项目采用非商业许可，第三方依赖保留各自许可。令牌、个人配置、依赖目录和运行数据均排除 Git 与源码包。
