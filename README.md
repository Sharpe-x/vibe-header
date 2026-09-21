# VibeHeader for Surge

像 Chrome 的 **VibeHeader** 插件一样，在 Surge 里按「域名 / 路径」给 HTTP(S) 请求头做 **增加 / 覆盖 / 删除**。
多条规则可共存、可逐条启用、可限定生效域名，配置界面在 **BoxJs**，并附带一个内置自检页。

```
https://github.com/Sharpe-x/vibe-header
```

---

## 0. 先读这三条硬性前提

否则大概率「配了没反应」。

| 前提 | 说明 |
| --- | --- |
| ① HTTPS 需要 MITM | 只有写进 Surge `[MITM] hostname` 的域名，脚本才能看到它的 HTTPS 请求。明文 http 不需要 MITM |
| ② 一个请求只跑一个 http-request 脚本 | Surge 对同一请求**只运行最先匹配的 http-request 脚本**。本模块 pattern 是 `^https?://`，会抢占 Cookie 抓取等脚本，需要时请收窄 pattern |
| ③ 模块脚本行按需精简 | 模块里的 `[Script]` 行会插到配置顶部、优先级最高，且**无法从 UI 单独关闭**，不需要的行请直接删掉 |

> 为什么不用 Surge 原生 `[Header Rewrite]`？它是静态的：值不能带变量、不能从 BoxJs 读配置、不能按需逐条启停。需要「可选择的 k/v」就必须走脚本。

---

## 1. 安装（3 步）

### 步骤 1：装模块

Surge → **模块** → 右上角 `+` → **从 URL 安装**，粘贴：

```
https://raw.githubusercontent.com/Sharpe-x/vibe-header/main/VibeHeader.sgmodule
```

国内若 `raw.githubusercontent.com` 不通（Surge 走代理即可），可换成 jsDelivr 同源地址：

```
https://cdn.jsdelivr.net/gh/Sharpe-x/vibe-header@main/VibeHeader.sgmodule
```

装完在「模块」里能看到 **VibeHeader（请求头管理器）**。

> 模块里的脚本地址（`script-path`）已经指向同仓库的 `vibe-header.js`，**不需要你手填**。
> 上面两个模块地址对应两种脚本地址，二选一整套使用即可。

### 步骤 2：配置 BoxJs

BoxJs（需先装 BoxJs 本体）→ 底部「**订阅**」→ 添加：

```
https://raw.githubusercontent.com/Sharpe-x/vibe-header/main/boxjs.vibeheader.json
```

回到 BoxJs 首页会出现 **VibeHeader** 卡片，进去即可图形化配置 —— **不用手写规则**：

| 设置项 | 说明 |
| --- | --- |
| 总开关 | 关闭后所有请求原样放行 |
| ① 生效范围 | 对哪些域名生效，默认 `*`（全部）。多个用逗号分隔，支持 `*.a.com` 这类通配（**覆盖该后缀下所有层级子域**） |
| ② 头名 | 要设置 / 覆盖的请求头名，例如 `x-dev` |
| ③ 选择取值 | **单选列表**，点一下就切换（默认给了 kitty / sharpezhang / kevincheng / uranus） |
| ④ 自定义取值 | 填了就以它为准，用于临时试列表以外的值，不必改订阅 |
| 多条规则（高级） | 原文本域保留；与快速设置**同时生效**（快速设置排在前面） |
| 排除域名 | 这些域名不做任何修改，优先级高于规则 |
| 调试日志与命中记录 | 开启后写日志并在自检页记录最近 20 次命中，排查完请关掉 |

> ①~④ 会被脚本拼成一条普通规则 `生效范围 set 头名: 取值`，所以自检页的规则表、最近命中、`${host}` 变量这些照旧可用。
> ⚠️ 在 ① 里写了域名**不等于**生效 —— HTTPS 请求还需要该域名在 Surge 的 `[MITM]` 里（见下面步骤 3）。

> **不装 BoxJs 也行**：脚本读的就是普通持久化键（`vibe_header_rules` 等，无前缀）。Surge Mac 可直接编辑
> `~/Library/Application Support/com.nssurge.surge-mac/SGJSVMPersistentStore/` 下对应文件写入。

### 步骤 3：把目标域名加进 MITM（**最容易漏的一步**）

编辑模块末尾的 `[MITM]`：

```ini
[MITM]
# 方案 A：只解密你要改请求头的域名
hostname = %APPEND% example.com, *.foo.com

# 方案 B：让规则对所有域名生效（先注释掉上一行再启用这行）
# hostname = %APPEND% -*.apple.com, -*.icloud.com, -*.mzstatic.com, -*.crashlytics.com, *
```

方案 B 会解密全部 HTTPS 流量，**证书固定（pinning）的 App 可能直接断网**，且日志量、耗电都会上升，请自行权衡。

### 验证：三种看状态的方式

**① 最可靠：在 Surge 里长按运行（推荐）**

Surge → **脚本** → 找到 **VibeHeaderStatus** → **长按 → 运行**。手机会弹一条通知，把总开关、规则条数、语法问题、最近命中一次列全。**不依赖浏览器、不依赖域名解析、不依赖 MITM**，装了模块就能用。

**② 万能触发：用浏览器访问任意明文 http 网址**

打开任意一个**能正常解析的真实域名**的 `http://` 网址，把路径写成 `/vibeheader-status`，例如 `http://neverssl.com/vibeheader-status`。页面会照常打开，同时弹出一条状态通知。（请求本身不做任何修改）

**③ 自检页（辅助，请用裸 IP 打开）**

浏览器打开 **`http://192.0.2.1/`** —— 明文 http，**不需要 MITM，也不需要任何 DNS 解析**：总开关 / 调试开关 / 排除域名、每条规则的解析结果、**语法错误清单**、最近 20 次命中；`/reset` 清空命中记录。右上角的「刷新」链接自带时间戳，用来绕开浏览器缓存。

> 也可以用 `http://vibeheader.local/`，但 `.local` 是 mDNS/Bonjour 的保留后缀，**部分 iOS 上会解析失败**（表现就是"打不开"）—— 这正是 `192.0.2.1` 这个入口存在的原因：它在 RFC 5737 保留的测试网段里，保证不会连到真实主机；连接会被 Surge 的 HTTP 引擎接住，由脚本直接返回页面。

**④ 信息面板（推荐：装一个模块就有，不用改你自己的配置）**

```
https://raw.githubusercontent.com/Sharpe-x/vibe-header/main/VibeHeader.panel.sgmodule
```

装上后，面板显示在 **策略选择视图**（iOS 从 Surge 首页点进某个策略组即可看到），内容为总开关 / 规则条数 / 语法问题 / 最近命中。这个模块是自包含的（脚本行自带），不需要依赖主模块。

> Surge 文档列出的「模块可覆盖段落」清单里**没有 `[Panel]`**，但**实测在模块里写 `[Panel]` 是生效的**。
> 模块里的 `script-update-interval=300` 是必要的：远程脚本默认缓存 24 小时，值太大时面板会一直停在静态文字。

<details>
<summary>手工版（不想多装一个模块时）</summary>

在你自己的配置里加这两行：

```ini
[Script]
VibeHeaderPanel = type=generic,script-path=https://raw.githubusercontent.com/Sharpe-x/vibe-header/main/vibe-header.js,argument=status,script-update-interval=300

[Panel]
VibeHeader = title="VibeHeader",content="点刷新读取状态",style=info,script-name=VibeHeaderPanel,update-interval=1
```

注意：如果已经装了上面的面板模块，就**不要**再在配置里写同名 `[Panel]`，否则会出现重复面板。

</details>

此外模块每天 9 点自检一次配置，**只在语法有错时发通知**；`VibeHeaderSelfCheck` 那行可以直接删掉。

---

## 2. 规则语法

一行一条：`作用域 动作 头名 值`

### 作用域（可写多个，满足任一即生效）

多个作用域用**逗号或空格**分隔（逗号后的空格可有可无），也可以拆成多行 —— 三者完全等价：

```text
*.a.com, *.b.com set X-Demo: 1     # 一行多个作用域
a.com b.com set X-Demo: 1          # 空格分隔
*.a.com set X-Demo: 1              # 拆成多行（等价）
*.b.com set X-Demo: 1
```

| 写法 | 含义 |
| --- | --- |
| `*` | 所有域名 |
| `example.com` | 精确匹配该 host |
| `*.example.com` | `example.com` 及其**所有层级**子域 |
| `\|\|example.com` | 同上（AdGuard 风格，方便从规则集里抄过来） |
| `api-*.example.com` | 通配，`*` 匹配单段 |
| `re:^api\d\.test\.com$` | 正则匹配 host |
| `example.com/api` | 域名 + 路径前缀（末尾可写 `*`） |

> 注意：`example.com` 只匹配主域本身，要连子域一起生效请写 `*.example.com` 或 `||example.com`。

### 动作

| 动作 | 行为 |
| --- | --- |
| `set` | 覆盖该头；不存在则添加（**默认**）。复用原有头名大小写，不产生重复头 |
| `add` | 仅在该头**不存在**时添加，已存在则保留原值 |
| `del` | 删除该头（大小写不敏感），不存在则什么都不做 |

中文别名同样可用：`设置` / `覆盖` → `set`，`追加` / `添加` → `add`，`删除` → `del`。

### 值里的变量

`${host}` `${path}` `${method}` `${scheme}` `${port}`，例如 `set X-Vibe-From: ${host}${path}`。

### 其他语法

- 行首 `!` → **临时禁用**这条规则（不用删，等效于勾选开关）
- 行首 `#` 或 `//` → 注释
- 值可用 `"` 或 `'` 包裹；头名前的分隔符 `:` `=` 或空格都行
- 值可以含空格和冒号（会取整行剩余部分）

### 也可以整段写 JSON

规则框内容以 `[` 开头时按 JSON 数组解析（适合程序生成）：

```json
[
  { "scope": "*.example.com", "op": "set", "name": "X-Debug", "value": "1" },
  { "disabled": true, "scope": "*", "op": "del", "name": "X-Device-Id" }
]
```

字段别名：`scope` / `domains` / `host`，`name` / `header` / `key`，`op` / `action`，`value` / `val`，以及 `disabled` / `enable:false` / `on:false`。

---

## 3. 配置示例

```text
# ① 给某个 API 打标，只在它自己的域名和路径上生效
api.example.com set X-Env: prod
api.example.com/v1 add X-Vibe-By: surge

# ② 给一组域名统一加头（多个域名逗号分隔）
*.foo.com, *.bar.io add X-Requested-With: XMLHttpRequest

# ③ 干掉某些 App 的埋点 / 风控头，让请求"干净"一点
*.tracker.com del X-Device-Id
*.tracker.com del X-Device-Fingerprint

# ④ 临时停用一条规则（排查时对比用）
! * set X-Debug: 1
```

要点：

- **通配符越具体越安全**，`*` 配合 `del` 容易误伤正常业务头，建议先只对某个域名试。
- 通过 **总开关 + 行首 `!` + 排除域名** 三层控制「哪些 k/v 生效」；再配合 BoxJs 的**会话（Session）**功能，可以在「工作 / 家庭 / 测试」等多套规则集之间一键切换。

---

## 4. 现象 → 原因对照

| 现象 | 原因与处理 |
| --- | --- |
| 规则全都不生效 | 没开 MITM 或域名没进 MITM 列表；先打开调试开关，看自检页「最近命中」是否有记录 |
| 自检页打不开 | 改用裸 IP 入口 `http://192.0.2.1/` —— `vibeheader.local` 里的 `.local` 是 mDNS 保留后缀，部分 iOS 上解析不了 |
| 自检页看不到最新命中 | 浏览器缓存：点页面右上角「刷新」（自带时间戳），或换无痕窗口；也可长按运行 `VibeHeaderStatus` 对照 |
| 长按运行 VibeHeaderStatus 没反应 | 该行是否出现在 Surge 的脚本列表里；看不到就用「万能触发」，或把那一行复制到你自己的配置里 |
| 万能触发不弹通知 | 路径必须完全匹配 `/vibeheader-status`；且要用**明文 http** 的网址打开 |
| 只有明文 http 生效 | 目标域名不在 MITM 列表 —— 这就是预期行为 |
| 自检页显示「0 条可用」 | 规则行还带着 `#`，或格式不对；看页面上的语法错误清单 |
| 某个头怎么都不变 | 它是受保护头（`Host` / `Content-Length` / `Content-Encoding` / `Transfer-Encoding` 等），脚本拒绝修改以免破坏报文 |
| Cookie 抓取 / 其他重写脚本失效 | 被本模块的全局 `pattern=^https?://` 抢占了：把 pattern 收窄到你的目标域名 |
| 改了规则没反应 | 新连接才生效，已建立的连接不受影响；个别 App 有请求缓存，重开 App 即可 |
| 改了脚本但行为没变 | 远程脚本默认有 24 小时缓存，开发期在脚本行加 `script-update-interval=60` |

---

## 5. 安全提示

- MITM 意味着 Surge 能看到目标域名的**明文流量**，请只对你信任的域名开启；
- 本模块只改**请求头**，不动请求体、不动响应，不注入 JS；
- 涉及金额、支付、风控的场景请先确认服务端行为，删除校验头可能导致业务失败或被风控拦截；
- 不要在配置里放入长期有效的密钥类头（如 `Authorization`），BoxJs 数据是本地明文存储的。

---

## 6. 仓库文件

| 文件 | 作用 |
| --- | --- |
| `vibe-header.js` | 核心脚本（http-request 类型）：读配置 → 匹配域名 → 改请求头；同时提供自检页与 cron 自检模式 |
| `VibeHeader.sgmodule` | Surge 模块：注册三条脚本行（改请求头 / 每日自检 / 长按看状态）、`force-http-engine-hosts`、MITM 域名列表 |
| `VibeHeader.panel.sgmodule` | Surge 模块（可选）：只注册一个信息面板，装上即在策略选择视图里看到状态 |
| `boxjs.vibeheader.json` | BoxJs 订阅文件：导入后得到可视化配置面板 |
| `README.md` | 本文档 |

### 自检脚本本身

脚本的匹配器、头操作、降级路径都用 Node 桩环境跑过断言（作用域命中 / 误伤、`add` 不覆盖、
大小写不敏感、受保护头被拒、非法正则不抛异常、空配置降级等），逻辑经过验证；但**未在真机 Surge
上跑过完整链路**，建议先用明文 http 的域名或自检页验证一遍，再上 HTTPS 目标。
