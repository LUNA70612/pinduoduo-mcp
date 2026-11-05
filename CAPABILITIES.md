# 工具与能力

pinduoduo-mcp 提供 10 个 MCP 工具、3 个推荐模板，以及 stdio 和可选本机 Streamable HTTP 两种接入方式。默认以只读方式运行。

## 主要工具

| 工具 | 用途 | 主要参数 |
|---|---|---|
| `pdd_status` | 查询浏览器连接、冷却、锁、写权限及任务状态 | 无 |
| `pdd_search` | 搜索商品并筛选当前搜索卡片 | `query`、`limit`、`price_min`、`price_max`、`include_terms`、`exclude_terms`、`exclude_group_purchase` |
| `pdd_read_item` | 从搜索卡片读取商品详情、属性和可选主图 | `url`、`entry`、`budget_max`、`include_product_images` |
| `pdd_read_sku` | 核对完整规格组合及对应参考价 | `goods_id`、`spec_selection`、`budget_max` |
| `pdd_resume` | 检查会话并执行受保护的只读恢复 | `resume_id`、`retry` |
| `pdd_login` | 打开登录页面，由本人完成登录 | 无 |

`pdd_read_item` 使用 `entry:"search"` 保留同连接搜索来源。`include_product_images:true` 可返回最多 8 张已加载的商品主图。

另保留 `pdd_browse_home`、`pdd_read_cart`、`pdd_contact_seller`、`pdd_add_cart` 四个协议兼容入口及原参数。日常购物比较使用上表工具；加购与客服发送受写权限闸门保护，默认关闭。下单、结算和支付不在服务范围内。

具体参数类型、必填项及输出结构以 `tools/list` 返回的 schema 为准。

## 推荐模板

| 模板 | 用途 |
|---|---|
| `pdd_shopping` | 通用品类的需求整理与商品比较 |
| `pdd_cat_food` | 猫粮的适用阶段、主粮声明、规格和单位价比较 |
| `pdd_earphones` | 耳机的用途、兼容性、续航与佩戴方式比较 |

三个模板均接受必填的 `request` 字符串。客户端也可通过 `initialize.instructions` 和工具说明使用相同流程。

客户端理解预算、用途、硬条件和软偏好，MCP 返回页面事实及确定性筛选结果。服务端不接入模型 API，不生成商品质量总分。

## 搜索与比较

- 优先使用商品类型、明确型号及必要限定组成的短核心词，预算通过 `price_max` 传入。
- `include_terms`、`exclude_terms` 用于标题匹配；颜色、容量、适配性等由详情或规格核对。
- `exclude_group_purchase:true` 排除页面明确的多人团，普通拼单保留并注明价格条件。
- 每个推荐流程最多 3 组搜索、每组 10 条候选、6 个不同商品详情及 3 个商品规格核验。
- 候选结果按用户需求比较，列出具体规格、参考价、来源时间、参数、理由、取舍及未知项。

搜索筛选作用于当前读取的卡片；商品价格按完整规格核验。搜索显示价、标题价格及其他规格价格分别保留各自用途。

## 规格与价格字段

`spec_selection` 使用页面真实组名和值，包含所有必选规格。默认完整组合符合需求时可直接核验；指定其他组合时，通过商品绑定的可见规格控件选择。

| 字段 | 含义 |
|---|---|
| `variant_price_verified` | 当前完整组合的规格价核验结果 |
| `price_assessment.reference_price` | 已核验具体规格的一件商品参考价 |
| `price_assessment` | 规格价格、预算判断、条件和未知费用 |
| `unit_price` | 由明确净含量、包装数量及已核验价格计算的单位价 |
| `stock` | 对应 SKU 的页面可售数量；没有明确数据时为 `null` |
| `available` | 页面来源中的在售或可用标记 |
| `selection_available` | 当前规格控件的可选状态 |
| `unselectable_reason` | 规格控件不可选时返回的原因分类 |

型号匹配与规格核价分别核对。完整选择、商品身份、唯一 SKU 关联及稳定可见价格一致时，才使用该规格参考价。拼单、优惠资格、限件和运费分别保留；最终成交信息以平台结算页面为准。

完整字段口径见 [规格与价格](docs/SKU-MODEL-PRICE.md)。

## 连接与会话

stdio 通过 JSON-RPC 提供工具和模板。可选 HTTP 默认使用 `http://127.0.0.1:4176/mcp`，采用 Bearer 认证，每个会话转接同目录的 stdio 服务，保留结构化结果和图片。

同一搜索的后续读取保持同一连接，搜索来源有效期为 30 分钟。页面操作默认间隔 90 秒，按顺序执行；新连接或来源到期后重新搜索。

`pdd_status` 中的 `browser_connected` 表示 CDP 连接状态；`login_status:"not_checked"` 表示尚未检查页面登录，`login_policy:"manual"` 表示登录由使用者本人完成。兼容字段 `user_login_required:true` 描述登录策略，不是当前登录状态。

运行环境和接入配置见 [安装指南](AI-INSTALL.md)及[HTTP 接入指南](http/README.md)。
