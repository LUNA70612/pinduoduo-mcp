# HTTP 接入检查

本页用于配置客户端与检查本机 Streamable HTTP 连接。安装和端口设置见 [HTTP 接入指南](README.md)。

## 客户端要求

- 能从本机访问 `http://127.0.0.1:4176/mcp`，或本机配置的其他端口。
- 支持 MCP Streamable HTTP 及 Bearer 请求头。
- 在一次搜索、详情和规格流程中保持同一 MCP 会话。
- 每次工具调用预留至少 300 秒，并按顺序调用。

## 检查步骤

1. 保持项目浏览器和 HTTP 服务运行。
2. 在客户端填写本机生成的 URL 和认证请求头，建立 MCP 连接。
3. 通过 `tools/list` 发现 10 个工具，通过 `prompts/list` 发现 3 个模板。
4. 调用 `pdd_status`，检查浏览器连接和只读权限。
5. 按[使用指南](../USAGE.md)执行搜索、详情读取与完整规格核验。
6. 结束使用后关闭会话；再次连接时重新搜索建立来源。

`browser_connected` 表示浏览器 CDP 连接，登录由本人在浏览器完成。连接资料保留在本机，公开反馈使用脱敏后的配置摘要。

## 开发检查

```powershell
npm run check:frozen
npm run test:http
```

HTTP 模块通过官方 SDK 检查初始化、工具与模板、图片和结构化结果转发、认证及会话生命周期。测试使用本地 fixture 和隔离环境，执行命令见[测试指南](../TESTING.md)。
