# 测试与验收

本地回归、真实页面证据、客户端兼容与用户确认分别记录。fixture不代表生产页面验证成功，页面缺失资料也不等于软件缺陷。

## 本地检查

```powershell
npm ci --ignore-scripts
npm run install:adapters
npm test
npm run check
npm run smoke
```

npm test使用Node内置runner并按文件串行执行；测试内部仍覆盖并发、跨进程互斥与队列恢复。check检查源码语法，smoke检查本地协议和发现，不操作购物页面。

这些检查使用本地fixture和隔离测试环境，不需要登录，也不操作购物页面。测试数量及结果以实际命令输出为准；页面与客户端支持情况见 [CAPABILITIES.md](CAPABILITIES.md)。

## 分层覆盖

| 层级 | 检查内容 |
|---|---|
| 解析与参数 | OpenCLI envelope、对象/数组、失败输出、金额和严格schema |
| 协议 | 10工具、3模板、旧调用、错误码、业务isError、stdout纯度 |
| 页面fixture | 目标身份、搜索返回、来源过期、价格格式、完整规格、异步状态及安全入口 |
| 状态与互斥 | 串行、90秒冷却、锁恢复、历史任务、未知执行不重放、并发恢复一次 |
| 真机 | 正常搜索卡片、连续三个详情、明确规格及窄DOM交叉核对 |
| 客户端 | 官方SDK独立连接、Codex实际工具调用与GUI重启恢复 |
| 交付 | 干净安装、配置、适配器发现、哈希、许可与隐私排除 |

官方SDK为可选独立验证工具，安装在work中，不作为生产依赖：

```powershell
npm install --prefix work/mcp-sdk-validation --ignore-scripts --no-package-lock --no-save @modelcontextprotocol/sdk@1.32.2
npm run test:sdk
```

SDK重连不替代GUI实际重启。自然未出现的真机异常可标为仅本地覆盖，不主动制造风控或关闭当前浏览器。

## 可选本机HTTP与核心冻结

原服务以`25c3df1`冻结。运行`npm run check:frozen`核对130个原文件、原依赖、安装流程及根脚本；CI使用`--verify-git`与完整固定提交核对，不接受自动更新基线。换行仅兼容Git LF与Windows CRLF检出差异。

HTTP可选依赖通过`npm run setup:http`单独安装，`npm run test:http`使用官方SDK测试两次独立HTTP连接、原工具和模板、原错误、图片转发、会话隔离、过期、断线、超时、不重放及子进程清理。浏览器断开使用独立端点；图像和延迟fixture仅证明协议行为。

原stdio与HTTP定向真机分批、依次执行，分别保持自己的搜索来源，核对详情、主图、完整规格及参考价。HTTP内部调用上限300秒；客户端超时另行配置。具体客户端接入、SDK协议和干净目录安装分别记账，不互相替代。

SDK记录可使用node scripts/sdk-check.cjs --output work/SDK-VALIDATION.json保存于已忽略的本地目录；已有记录时更换文件名，避免覆盖。客户端需重新加载MCP服务后才会重新获取initialize指引和工具schema；仅新建对话不保证底层服务已经重连。

## 真实页面执行

使用显式独立批次、唯一活动控制器和同一MCP连接。默认90秒间隔，每次调用预留至少240秒。完整记录提交、运行哈希、时间、输入摘要、预期/实际、脱敏页面证据及代理核对结果。

详情或规格失败立即保存现场并暂停，修复后另建批次。登录、验证码、繁忙或断开时停止全部页面操作，不自动重试、不替换商品、不覆盖已有记录。

新品类每类一次搜索、同搜索三个相关详情、至少一个明确规格价。非默认规格按不同商品计数，不把默认成功冒充切换；同次搜索要求不能跨批拼接。

## 发布门禁

```powershell
npm run release:check
npm run release:source
```

这两个命令供维护者验收发布使用。release:check校验本机docs/dev/recommendation/release-gate.json，release:source在全部门槛通过后本地打包。公开仓库不包含个人验收档案，缺少档案时发布检查会拒绝打包；安装、运行和本地测试不依赖该档案。

完整预览包要求十品类、至少三个不同商品非默认组合、猫粮/耳机两类比较，以及协议、部署和GUI恢复验证。引用的原始调用、页面证据、版本、哈希和批次均需对应，不能重复计数、跨批拼接或使用未核验价格。

人工确认需绑定具体证据和哈希；证据改变后重新审阅，不能用自动测试替代人工确认。

打包后校验MANIFEST逐文件哈希、ZIP内容、固定依赖、默认写关闭、许可和隐私排除。历史验证按实际变更范围继承或补测，保留原版本和适用范围。

SOURCE-INFO.json记录实际打包提交；交付源码必须完整对应已提交的白名单文件。无关缓存、日志和个人配置即使位于scripts、tools或tests内也会排除。脱敏fixture和回归测试仍随源码保留，便于接收方重复验证；它们不等于本机历史测试日志或账号运行数据。

## 写操作

当前预览版保持PDD_ENABLE_WRITES=0，不为测试执行加购、发送、下单、结算或支付。写流程fixture不代表真实写操作已验证。
