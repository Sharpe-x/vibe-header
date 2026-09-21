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
| ② 一个请求只跑一个 http-request 脚本 | Surge 对同一请求**只运行最先匹配的 http-request 脚本**（官方文档：*the first enabled http-request script in the profile whose pattern matches wins*）。模块脚本行会被插到配置最顶部，所以宽 pattern 会挤掉别人的脚本。**本模块已用否定断言把 `boxjs.com` / `boxjs.net` 让回给 BoxJs** —— 详见下方「抢占」。 |
| ③ 模块脚本行按需精简 | 模块里的 `[Script]` 行会插到配置顶部、优先级最高，且**无法从 UI 单独关闭**，不需要的行请直接删掉 |

> 为什么不用 Surge 原生 `[Header Rewrite]`？它是静态的：值不能带变量、不能从 BoxJs 读配置、不能按需逐条启停。需要「可选择的 k/v」就必须走脚本。

### ⚠️ 关于「抢占」：一个必须知道的坑（已踩过）

Surge 官方文档原话：

> At most one script runs per request: **the first enabled http-request script in the profile whose pattern matches wins.**

而**模块里的 `[Script]` 行会被插到配置最顶部**。所以在 VibeHeader 用全局 `^https?://` 的情况下，它会抢走所有请求 —— 包括 **BoxJs 自己的脚本**，症状是：

> **BoxJs 页面能打开，但「加载数据失败」、保存失败、总开关打不开。**（BoxJs 后端脚本压根没跑）

BoxJs 官方 FAQ 里对应条目：*「能进页面，但无法保存数据，也无法执行脚本」*。

**所以本模块的 pattern 不是 `^https?://`，而是把 BoxJs 让出去的版本：**

```ini
pattern=^https?://(?!([^/]+\.)?boxjs\.(com|net)(?:[/:]|$))
```

**如果你还装了别的 http-request 脚本**（Cookie 抓取、其它重写），它们同样会被挤掉 —— 把它们的域名并进那个否定组即可：

```ini
pattern=^https?://(?!([^/]+\.)?(boxjs\.(com|net)|yourdomain\.com)(?:[/:]|$))
```

> 从 URL 安装的模块**在界面上改不了**，需要改 pattern 时告诉我，或者把模块内容另存成本地模块自己编辑。
>
> 排查手法：**临时关掉 VibeHeader 模块** → 如果 BoxJs 立刻恢复正常，就是这个问题。

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
# 方案 A：只解密你要改请求头的域名（vibeheader.* 是自检页自己的域名，保留别删）
hostname = %APPEND% vibeheader.com, www.vibeheader.com, vibeheader.test, vibeheader.local, example.com, *.foo.com

# 方案 B：让规则对所有域名生效（先注释掉上一行再启用这行）
# hostname = %APPEND% -*.apple.com, -*.icloud.com, -*.mzstatic.com, -*.crashlytics.com, *
```

方案 B 会解密全部 HTTPS 流量，**证书固定（pinning）的 App 可能直接断网**，且日志量、耗电都会上升，请自行权衡。

### 验证：三种看状态的方式

**① 最可靠：在 Surge 里长按运行（推荐）**

Surge → **脚本** → 找到 **VibeHeaderStatus** → **长按 → 运行**。手机会弹一条通知，把总开关、规则条数、语法问题、最近命中一次列全。**不依赖浏览器、不依赖域名解析、不依赖 MITM**，装了模块就能用。

**② 万能触发：用浏览器访问任意明文 http 网址**

打开任意一个**能正常解析的真实域名**的 `http://` 网址，把路径写成 `/vibeheader-status`，例如 `http://neverssl.com/vibeheader-status`。页面会照常打开，同时弹出一条状态通知。（请求本身不做任何修改）

**③ 自检页（推荐用域名打开）**

浏览器打开 **`http://vibeheader.com/`** —— 总开关 / 调试开关 / 排除域名、每条规则的解析结果、**语法错误清单**、最近 20 次命中；`/reset` 清空命中记录。右上角的「刷新」链接自带时间戳，用来绕开浏览器缓存。

这就是 BoxJs 用 `http://boxjs.com` 的同一套机制：一个「假域名」，由模块保证它一定能被解析、且请求被脚本就地应答。具体靠模块里的两行：

```ini
[Host]
vibeheader.com = 192.0.2.1          # 由 Surge 直接给出解析结果，不依赖真实 DNS

[General]
force-http-engine-hosts = %APPEND% vibeheader.com
```

`192.0.2.0/24` 是 RFC 5737 保留的测试网段，公网上不存在真实主机，**请求不会真的发到公网**。因为解析是 Surge 给的，所以真实 DNS 怎么变（换 IP、被污染、被墙）都不影响这个页面。

> 三个备用入口，打不开就换一个：`http://vibeheader.test/`（`.test` 是 RFC 2606 保留后缀，永不会被真实注册）、`http://192.0.2.1/`（裸 IP，不需要任何解析）、`http://vibeheader.local/`（`.local` 是 mDNS 保留后缀，**部分 iOS 上会解析失败**，仅作最后备选）。
>
> 若 `http://vibeheader.com/` 打不开：确认 **VibeHeader 主模块已启用**（`[Host]` 映射在它里面）；也可以在 Surge → 请求记录里搜 `vibeheader.com` 看那条请求的状态。

**④ 信息面板（推荐：装一个模块就有，不用改你自己的配置）**

```
https://raw.githubusercontent.com/Sharpe-x/vibe-header/main/VibeHeader.panel.sgmodule
```

装上后，面板显示在 **策略选择视图**（iOS 从 Surge 首页点进某个策略组即可看到），内容为版本 / 总开关 / 规则条数 / 语法问题 / 最近命中。这个模块是自包含的（脚本行自带），不需要依赖主模块。

> Surge 文档列出的「模块可覆盖段落」清单里**没有 `[Panel]`**，但**实测在模块里写 `[Panel]` 是生效的**。
> 模块里的 `script-update-interval=300` 让脚本改动能自动跟进，不必手动刷新。

**通知策略（v1.4.2 起）—— 面板不会再刷屏：**

| 触发方式 | 面板卡片 | 通知 |
| --- | --- | --- |
| 面板**自动刷新**（`update-interval`，每秒级反复发生） | 更新 | **静默，不发** |
| 你**主动点面板**（`$trigger === 'button'`） | 更新 | 弹一条 |
| 长按运行 `VibeHeaderStatus` | — | 弹一条 |
| `/vibeheader-status` 路径触发 | — | 弹一条 |
| 每日 cron 自检 | — | **仅语法有错时**弹一条 |

依据：Surge 文档里面板脚本的入参带 `$trigger`，值为 `"button"`（用户点了刷新）或 `"auto-interval"`（自动刷新）。早期版本在两种情况都发通知，配上 `update-interval=1` 就变成每秒一条 —— **这是设计缺陷，已修**。

### 更新到新版本（**不用删除重装**）

地址始终不变，更新是就地完成的：

| 更新什么 | 怎么操作 |
| --- | --- |
| **模块本身**（改脚本行 / `[Host]` / MITM 时） | Surge 首页 →「**模块**」→ 在该模块上**向左滑** → 点「**更新**」 |
| **脚本**（绝大多数改动都在这里） | Surge 首页左上角**配置名称** →「**配置列表**」→「**外部资源**」→ 底部「**全部更新**」 |
| 什么都不点 | 模块里已给三条脚本行写了 `script-update-interval=3600`，**最多一小时自动**取到新版脚本 |

**怎么确认更新生效**：长按运行 `VibeHeaderStatus`（或看信息面板），第一行就是 `版本：v1.4.0`；自检页标题里也带版本号。版本号变了就是更新成功。

> `script-update-interval` 官方默认是 86400（24 小时）—— 这是「改了脚本却迟迟没生效」最常见的原因。这里设成 3600，需要更快可在模块里临时改成 60。

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
| **BoxJs 能打开但加载数据失败 / 保存失败 / 开关打不动** | **VibeHeader 的 pattern 抢占了 BoxJs 的请求**（它自己的脚本没跑）。用本仓库当前版本即可（pattern 已排除 boxjs.com / boxjs.net）；临时验证：关掉 VibeHeader 模块看 BoxJs 是否恢复 |
| 自检页打不开 | 依次换入口试：`http://vibeheader.com/` → `http://vibeheader.test/` → `http://192.0.2.1/` → `http://vibeheader.local/`；再确认 VibeHeader 主模块已启用（`[Host]` 映射在里面） |
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

## 6. 不想用了 / 暂时关闭

有两个层次的开关，**要「完全等于没装」就关模块的开关**。

### ① 一键彻底停用（推荐）：关掉模块本身的开关

**Surge 首页 →「模块」→ 找到 `VibeHeader（请求头管理器）` → 关掉它那一行的开关。**

Surge 的模块是「补丁」，停用后**它注入的整份内容都会被撤销**，效果等同于没装这个模块：

| 停用后 | 效果 |
| --- | --- |
| 修改请求头的 http-request 脚本 | **不再注册** → **不再占用「每个请求只跑一个 http-request 脚本」的名额**，不会影响你其它重写/Cookie 脚本 |
| `[Host]`（`vibeheader.* → 192.0.2.1`） | 撤销 |
| `[MITM] hostname` 里的三条 `vibeheader.*` | 撤销（不再解密这些域名） |
| `force-http-engine-hosts` | 撤销 |
| 每日自检 cron | 撤销 |

**想再用时，把开关打开即可**，不用重装、不用改地址、配置值也都还在。

官方依据：Surge 手册写明模块存在「启用状态」（*The enabled state of modules is not synced to other devices*），
HTTP API 里也有对应的 `GET/POST /v1/modules`（`{"模块名": false}` 即停用）。

**怎么确认真的停干净了**：首页 →「脚本」列表里 VibeHeader 的那几条应当消失；`http://vibeheader.com/` 也不再能打开。

> 如果你同时装了 **VibeHeader 信息面板** 模块：它注册的是 `type=generic` 脚本行 —— **generic 只在你手动运行或面板求值时执行，不参与「每个请求一个 http-request 脚本」的竞争**，所以留着它**不会影响你其它配置**，只是策略选择视图里多一张面板卡片。想一并清掉就同样关掉它的开关。

### ② 只是暂时不想改请求头：关 BoxJs 里的总开关

不想动模块时用这个。它只停「改请求头」，模块的其它部分仍在（脚本照跑、仍占名额、`[Host]`/`[MITM]` 仍生效）。
v1.4.4 起，关闭总开关后**连每日自检也静默**，不会再来打扰你。

### ③ 完全卸载

| 步骤 | 在哪儿 |
| --- | --- |
| 1. 删除两个模块 | Surge →「模块」→ 左滑 →「删除」 |
| 2. 删掉 BoxJs 里那条订阅（可选，留着无影响） | BoxJs → 订阅 → 左滑删除 |
| 3. ⚠️ **如果之前把「手工版」的 `[Script]` / `[Panel]` 两行贴进过自己的配置**，记得删掉 | 你自己的配置文件 —— **这两行不受模块开关控制** |
| 4. 若为此改过自己的 `[MITM]` hostname，按需清理 | 你自己的配置 / MITM 列表 |

删模块后，你在 BoxJs 里填的值仍留在 Surge 的持久化存储中（不会自动清除）。

---

## 7. 仓库文件

| 文件 | 作用 |
| --- | --- |
| `vibe-header.js` | 核心脚本（http-request 类型）：读配置 → 匹配域名 → 改请求头；同时提供自检页与 cron 自检模式 |
| `VibeHeader.sgmodule` | Surge 模块：注册三条脚本行（改请求头 / 每日自检 / 长按看状态）、`[Host]` 自检页域名映射、`force-http-engine-hosts`、MITM 域名列表 |
| `VibeHeader.panel.sgmodule` | Surge 模块（可选）：只注册一个信息面板，装上即在策略选择视图里看到状态 |
| `boxjs.vibeheader.json` | BoxJs 订阅文件：导入后得到可视化配置面板 |
| `README.md` | 本文档 |

### 自检脚本本身

脚本的匹配器、头操作、降级路径都用 Node 桩环境跑过断言（作用域命中 / 误伤、`add` 不覆盖、
大小写不敏感、受保护头被拒、非法正则不抛异常、空配置降级等），逻辑经过验证；但**未在真机 Surge
上跑过完整链路**，建议先用明文 http 的域名或自检页验证一遍，再上 HTTPS 目标。
