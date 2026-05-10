# behavior-track 技术评估报告

> 版本：1.0.0
> 评估日期：2026-05-09
> 源码规模：约 2400 行 TypeScript（含类型定义）
> 评估人：技术专家视角

---

## 一、项目总览

### 1.1 定位

**behavior-track** 是一款面向 Web 前端的**环境安全识别与行为风控 SDK**，核心目标：

1. **设备识别**：跨会话稳定识别同一设备（`device_id` + 浏览器指纹）。
2. **环境可信度评估**：检测自动化工具、无头浏览器、DevTools/CDP、iframe 篡改、Worker 不一致等风险信号。
3. **用户行为采样**：采集鼠标、键盘、滚动、触摸等原始交互流。
4. **表单交互异常检测**：针对登录/注册等关键表单做专项反机器人分析。
5. **聚合上报**：将风险信号与行为流批量/实时上报到业务后端。

典型场景：登录/注册风控、下单反刷、羊毛党识别、爬虫识别、UGC 内容防刷。

### 1.2 技术栈

| 维度 | 选型 |
|---|---|
| 语言 | TypeScript 5.7（严格模式 `strict`+`noUnusedLocals`+`noUnusedParameters`） |
| 打包 | Rollup 4 + `@rollup/plugin-typescript`，输出 ESM / CJS / UMD 三种产物，生产模式 Terser 压缩 |
| 目标 | ES2020，lib 包含 DOM / DOM.Iterable |
| 运行时依赖 | `@fingerprintjs/fingerprintjs` ^5.2.0（指纹）、`js-sha256` ^0.11.1（签名）、`fast-json-stable-stringify` ^2.1.0（确定性序列化） |
| 测试 | Vitest 3 + happy-dom；Playwright 用于真实浏览器回归（`scripts/test-risk.mjs`） |
| 副作用 | `"sideEffects": false`，支持 Tree-Shaking |

### 1.3 目录结构

```
src/
├── index.ts                       // 公共入口，导出 BehaviorTrack 对象
├── core/
│   ├── sdk.ts                     // SDK 主类，组合所有子系统
│   ├── config.ts                  // 配置合并与默认值
│   ├── lifecycle.ts               // 生命周期状态机 idle→active→paused→destroyed
│   └── event-bus.ts               // 简易事件总线
├── collectors/
│   ├── fingerprint.ts             // FingerprintJS 封装
│   ├── webrtc.ts                  // WebRTC 内网 IP 采集
│   ├── environment/               // 环境检测聚合（6 个子模块）
│   ├── behavior/                  // 鼠标/键盘/滚动/触摸 4 个 Tracker
│   └── form-detector/             // 表单反机器人检测器
├── storage/device-id.ts           // localStorage + IndexedDB 双写 UUID
├── transport/                     // 批量/重试/beacon/上报
├── utils/                         // browser/id/integrity/safe-exec/throttle
└── types/                         // 类型定义
```

### 1.4 构建产物

| 文件 | 格式 | 用途 |
|---|---|---|
| `dist/behavior-track.esm.js` | ESM | 现代构建工具直接引用，tree-shaking |
| `dist/behavior-track.cjs.js` | CJS | Node / SSR |
| `dist/behavior-track.umd.js` | UMD（全局 `BehaviorTrack`） | 浏览器 `<script>` 直接加载 |
| `dist/types/` | `.d.ts` | TypeScript 类型声明 |

所有产物带 sourcemap，生产模式 Terser 压缩。

---
## 二、公共 API

SDK 对外仅暴露一个单例对象（`src/index.ts`）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `init` | `(config: SDKConfig) => Promise<void>` | 初始化。幂等（非 idle 状态直接返回）；内部并发启动环境采集、行为采集、批处理定时器 |
| `getEnvInfo` | `() => Promise<EnvStaticReport>` | 获取静态环境报告。Promise 缓存：若有正在跑的采集则复用 |
| `onBehaviorReport` | `(cb) => void` | 订阅行为流批次上报（每 `batchInterval` 触发一次，有数据才回调） |
| `detect` | `(cfg: FormDetectConfig) => void` | 注册表单检测器，可多次调用以监控多个表单 |
| `pause` | `() => void` | 停止行为采集（active→paused） |
| `resume` | `() => void` | 恢复行为采集（paused→active） |
| `destroy` | `() => void` | 卸载事件、清空队列、flush 剩余数据 |

### 2.1 配置项 `SDKConfig`

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `appId` | `string` | **必填** | 应用标识 |
| `endpoint` | `string` | `''` | 上报地址（目前仅 beacon 使用，主通道 Reporter 尚未接入 HTTP） |
| `enableFingerprint` | `boolean` | `true` | 是否计算浏览器指纹 |
| `enableEnvironment` | `boolean` | `true` | 是否做环境风险检测 |
| `enableBehavior` | `boolean` | `true` | 是否采集行为流 |
| `behaviorSampleRate` | `number` | `1.0` | 行为采集抽样率 0~1 |
| `batchInterval` | `number` | `5000` | 批量 flush 周期（ms） |
| `batchSize` | `number` | `50` | 单批上限，超过触发立即 flush |
| `maxRetries` | `number` | `3` | 失败重试次数（指数退避+jitter） |
| `debug` | `boolean` | `false` | 预留调试标志 |

### 2.2 报告结构

**`EnvStaticReport`**（静态环境报告）：

```ts
{
  report_type: 'ENV_STATIC',
  device_id: string,        // 本地 UUID v4（LS + IDB 双写）
  fingerprint: string,      // FingerprintJS visitorId
  webrtc_ips: string[],     // 通过 RTCPeerConnection 枚举到的 IPv4
  session_id: string,       // s_{timestamp}_{8char}
  timestamp: number,
  page_context: PageContext,
  user_agent: string,
  browser: string,          // chrome | edge | firefox | safari | opera | unknown
  browser_version: string,
  os: string,               // Windows | Mac | Android | iOS | Linux
  device_type: 'PC' | 'Mobile' | 'Tablet',
  risk_indicators: RiskIndicators,
  integrity_check: string,  // sha256(fast-json-stable-stringify(payload))
}
```

**`BehaviorStreamReport`**（行为流批次）：

```ts
{
  report_type: 'BEHAVIOR_STREAM',
  device_id: string,
  session_id: string,
  sequence_no: number,      // 自增序号
  timestamp: number,
  data_stream: {
    mouse_tracks: MouseTrack[],
    keyboard_stream: KeyboardEvent[],   // 按秒聚合
    scroll_events: ScrollEvent[],
    touch_events: TouchEvent[],
  },
  integrity_check: string,
}
```

**`RiskIndicators`**（核心风险矩阵）：

| 字段 | 含义 |
|---|---|
| `is_webdriver` | 检测到任意 webdriver/自动化标志 |
| `is_headless` | 无头浏览器特征累计 ≥2 |
| `is_devtools_open` | DevTools 打开（尺寸差或 getter-trap） |
| `is_cdp` | 命中 `Error.prepareStackTrace` runtime 钩子 |
| `is_selenium` / `is_nightmare` / `is_sequentum` | 对应工具特征 |
| `iframe_overridden` | iframe 原型链被篡改 |
| `iframe_webdriver` | iframe 内 `navigator.webdriver` 为真 |
| `worker_consistent` | Worker 与主线程 navigator 字段一致 |
| `worker_cdp` | Worker 内检测到 CDP |
| `is_tampered` | UA 不一致 / iframe 被改 / Worker 不一致的汇总 |
| `is_proxy` | 预留，当前恒 false |
| `ua_consistent` | UA ↔ platform ↔ touch 一致 |
| `is_suspicious_form` / `is_form_super_human` / `is_form_cdp_mouse` | 表单三大专项信号 |
| `risk_score` | 0-100 综合分值 |
| `signals` | 字符串数组，所有命中的子信号码 |

---

## 三、核心功能详解

### 3.1 设备标识 `device_id`（`src/storage/device-id.ts`）

**目标**：跨会话、跨存储通道稳定识别同一设备。

**算法**：
1. **UUID v4 生成**：优先使用 `crypto.randomUUID()` 原生 API；不存在时回退到 `Math.random()` 模拟 v4（`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` 模板替换）。实现统一在 `utils/id.ts`，`device-id.ts` 中复用。
2. **双通道存储**：
   - **localStorage**（key=`__bt_did`）——读写快。
   - **IndexedDB**（库 `BehaviorTrack`/store `DeviceInfo`）——更持久。
3. **读取优先级**：
   - localStorage 命中 → 直接返回，异步补写 IndexedDB。
   - IndexedDB 命中 → 回写 localStorage，返回。
   - 两者都缺 → 生成新 UUID，双写。
4. 所有写入失败由 `try/catch` 吞掉（隐私模式 / quota 不崩）。

**特点**：单通道被清理时有自修复能力；**不使用 Cookie**，不受 ITP 截断影响。

### 3.2 浏览器指纹（`src/collectors/fingerprint.ts`）

- 复用 `@fingerprintjs/fingerprintjs` 开源版。
- `FingerprintJS.load()` 返回的 `Agent` 做惰性单例。
- 调用 `agent.get()` 得到 32 位 hex `visitorId` 和 `confidence.score`。
- 任何异常退化为空串 + confidence=0。

**注意**：开源版指纹稳定性低于商业版，适合作**辅助**信号而非单一判据。

### 3.3 WebRTC 内网 IP（`src/collectors/webrtc.ts`）

1. 构造 `RTCPeerConnection()`，`createDataChannel('')` 启动 ICE 收集。
2. `createOffer()` + `setLocalDescription(offer)` 触发 `onicecandidate`。
3. 从 `e.candidate.candidate` 用正则 `\b(\d{1,3}\.){3}\d{1,3}\b` 提取 IPv4。
4. 3s 超时或收集完成即解析并关闭 `pc`。
5. 去重返回。

**局限**：只匹配 IPv4；现代 Chrome 默认 mDNS `.local` 混淆，多数情况下拿不到真实内网 IP——这是浏览器机制导致。

---
### 3.4 环境风险检测（`src/collectors/environment/`）

SDK 的**核心价值点**，由 6 个子检测器 + 聚合器组成。

#### 3.4.1 `automation.ts` — 自动化工具指纹

逐项 `safeExec` 探测以下全局变量/属性：

| 信号码 | 判据 | 对应工具 |
|---|---|---|
| `navigator.webdriver` | `navigator.webdriver === true` | W3C WebDriver 标准 |
| `selenium_unwrapped` | `window.__selenium_unwrapped` | Selenium |
| `webdriver_evaluate` | `window.__webdriver_evaluate` | Selenium |
| `driver_evaluate` | `window.__driver_evaluate` | Selenium |
| `phantomjs` / `_phantom` | `window.callPhantom` / `window._phantom` | PhantomJS |
| `playwright` | `window.__playwright` / `window.__pw_manual` | Playwright |
| `webdriver_script_fn` | `document.__webdriver_script_fn` | Selenium/ChromeDriver |
| `fxdriver` | `document.__fxdriver_unwrapped` | Firefox driver |
| `cdp_detected` | `chrome.runtime === undefined && window._cdp` | CDP 附加 |
| `permissions_api_missing` | `navigator.permissions.query` 未定义 | 部分无头 |
| `selenium_cdc` / `selenium_cdc_array` | `document.$cdc_asdjflasutopfhvcZLmcfl_` / `window.cdc_adoQpoasnfa76pfcZLmcfl_Array` | Selenium ChromeDriver 残留符号 |
| `nightmare` | `window.__nightmare` | Nightmare |
| `sequentum` | `String(window.external).includes('Sequentum')` | Sequentum 爬虫浏览器 |

`is_webdriver = signals.length > 0`（任一命中即为 true）。

#### 3.4.2 `headless.ts` — 无头浏览器

| 信号 | 判据 |
|---|---|
| `no_plugins` | `navigator.plugins.length === 0` |
| `no_languages` | `!navigator.languages \|\| length === 0` |
| `headless_ua` | UA 包含 `HeadlessChrome` |
| `chrome_obj_missing` | Chrome UA 下 `window.chrome` 缺失 |
| `zero_outer_dimensions` | `outerWidth === 0 && outerHeight === 0` |
| `notification_denied_default` | 非 Firefox 下 `Notification.permission === 'denied'` |
| `software_renderer` | WebGL `UNMASKED_RENDERER_WEBGL` 匹配 `SwiftShader\|llvmpipe\|Mesa` |

**阈值**：`is_headless = signals.length >= 2`（降低单信号误杀）。

#### 3.4.3 `devtools.ts` — 开发者工具

三种互补探测：
1. **尺寸差**：`outerWidth - innerWidth > 160` 或 `outerHeight - innerHeight > 160`（停靠面板打开）。
2. **getter-trap**：构造 `Image`，在 `id` 属性上埋 getter，然后 `console.debug('%c', el)`；DevTools 渲染 console 输出时会读 `id`，触发 getter。
3. **CDP runtime 探测**：替换 `Error.prepareStackTrace`，`console.log(new Error(''))`；若 `prepareStackTrace` 被调用，说明有运行时（Chromium DevTools / Puppeteer / CDP）在格式化栈帧。

`is_open = size_diff || getter_trap`；`is_cdp = cdp_runtime`。`is_cdp && !is_open` 被聚合器视为"调试器隐藏打开"高风险场景（50 分）。

#### 3.4.4 `consistency.ts` — UA 一致性

| 信号 | 判据 |
|---|---|
| `ua_platform_mismatch` | UA 含 `Windows` 但 `navigator.platform` 不含 `win`（Mac/Linux 同理） |
| `mobile_no_touch` | UA 含 `Mobile` 但 `maxTouchPoints === 0` |
| `android_desktop_screen` | UA 含 `Android` 但屏幕宽 > 2000 且无触控 |
| `ua_tampered` | `navigator.userAgent.toString()` 不含 `[native code]` 但含 `function`（被 Proxy 包装） |
| `navigator_proxy` | `Navigator.prototype.userAgent` 的 getter `toString` 不是原生代码 |

`ua_consistent = signals.length === 0`。

#### 3.4.5 `iframe.ts` — iframe 原型链篡改

| 信号 | 判据 | 含义 |
|---|---|---|
| `iframe_self_overridden` | `iframe.contentWindow.self.get.toString().length > 5` | 正常浏览器 `self` 访问器很短，被覆写后变长 |
| `iframe_contentWindow_eq_window` | `cw === window` | 工具错误地让 contentWindow 指向主窗口 |
| `iframe_setTimeout_same` | `cw.setTimeout === window.setTimeout` | 正常 iframe 有独立 window，引用应不同 |
| `iframe_webdriver` | `cw.navigator.webdriver` | iframe 内的 webdriver 标志 |

`is_overridden` 聚合前三条，`is_webdriver` 单独暴露，两者在 `risk_score` 中各自加权。

#### 3.4.6 `worker-detect.ts` — Web Worker 一致性

构造 Blob Worker 读取以下字段与主线程比对：

- `navigator.webdriver / userAgent / hardwareConcurrency / platform / languages`
- Worker 内同样做 `Error.prepareStackTrace` 的 CDP 探测

信号：`worker_webdriver_mismatch / worker_ua_mismatch / worker_hw_mismatch / worker_platform_mismatch / worker_languages_mismatch / worker_cdp`。

**设计亮点**：`is_consistent = signals.length === 0 || (length === 1 && signals[0] === 'worker_cdp')`——`worker_cdp` 独立上报但不计入"不一致"（CDP 不等于 navigator 被伪造）。5s 超时兜底，Worker 创建失败保守视为 consistent。

#### 3.4.7 聚合与 `risk_score` 计算（`environment/index.ts`）

自动化强信号先汇总到 `autoSignals[]`（每条 50 分）：`is_webdriver` / `is_headless` / `is_cdp && !is_open` / `is_selenium` / `is_nightmare` / `is_sequentum` / `iframe_webdriver`。

**递减叠加算法**（避免简单累加饱和）：

```
signals.sort(desc by weight)
score = Σ weight[i] * 0.5^i
```

第 1 条 50，第 2 条 25，第 3 条 12.5...；根据命中数量加 bonus：≥2 条 +10，≥3 条 +20。

再叠加弱信号：`devtools.is_open +10` / `!ua_consistent +15` / `iframe.is_overridden +15` / `!worker.is_consistent +15` / `worker.is_cdp +10`。

最终 `risk_score = min(round(score), 100)`。

表单信号在 `sdk.ts::computeUpdatedRiskScore` 中以 0.6 衰减基数合并（权重 35/30/25）。

**设计评价**：递减几何衰减 + 分层叠加是风控评分的好实践，避免"两条强信号就直接爆表"，同时多信号会显著提分。

---

### 3.5 行为流采集（`src/collectors/behavior/`）

`BehaviorManager` 组合四个 Tracker，启动时按 `behaviorSampleRate` 做一次伯努利抽样（决策后缓存复用，避免 pause/resume 周期内反悔），决定是否挂钩子。监听器都走 `document`/`window`、`{ passive: true }`，不阻塞默认事件。`drain()` 时重置抽样缓存。

#### 3.5.1 `MouseTracker`（`mouse.ts`）

- 监听 `mousemove`（`throttle(50ms)`）/ `click` / `mousedown` / `mouseup`。
- **分层存储**：`click`/`down`/`up` 进 `clicks[]`，`mousemove` 进 `moves[]`；双缓冲区各自做"时间窗（60s）+ 容量（clicks 500 / moves 2000）"双门控。
- `click_tracks[]` 全量上报，每条含：`{ t, type, x, y, page_x, page_y, viewport_w, viewport_h, dpr, target_tag, target_path, is_trusted }`。`page_x/y` + 视口信息供服务端按分桶重建点击热区，`target_path` 为祖先 `tag:nth-child(n)` 路径（深度 ≤5）抗 DOM 重渲染漂移。
- `move_features` 由 `drain()` 时遍历 moves 聚合生成（标量）：`count / avg_speed(px/s) / straight_ratio / pause_count / total_distance`。`straight_ratio` 用相邻两段方向余弦 > 0.98 判定，近似贝塞尔拟合残差的弱信号。
- **触发式原始流**：`drain({ includeRaw: true })` 时把 moves 额外回传为 `RawOnRisk.mouse_moves`；由 SDK 层根据 `currentRiskScore ≥ rawStreamRiskThreshold` 决定是否命中，默认关闭。
- `is_trusted` 是 W3C `Event.isTrusted`，**JS 构造的合成事件恒为 false**，辨别机器人的核心字段。

#### 3.5.2 `KeyboardTracker`（`keyboard.ts`）

**不记录键值**（隐私/合规），**仅记录可打印键**（`e.key.length === 1`，过滤修饰键/导航键/功能键），只做节奏分析：

- `keydown`：非可打印键直接 return；记录时间戳，累加 `keyCount`、`trusted_count`，计算与上次间隔到 `intervalSum`；`holdStart` 置为当前时间。
- `keyup`：非可打印键直接 return；`holdSum += now - holdStart`。
- **每 1s 聚合一次**（`setInterval`）：

```ts
{
  t: now,
  key_count,
  trusted_count,
  interval_avg: keyCount > 1 ? Math.round(intervalSum / (keyCount - 1)) : 0,
  hold_avg:    Math.round(holdSum / max(keyCount, 1)),
}
```

`drain()` 时强制再做一次 `aggregate` 不丢尾巴。

**分析价值**：`interval_avg` 过短/过均、`trusted_count < key_count` 都是机器打字强信号。

#### 3.5.3 `ScrollTracker`（`scroll.ts`）

- 监听 `window.scroll`，**100ms 去抖**，内部保留 `{ t, top, speed, direction, is_trusted }` 原始队列（时间窗 60s + 容量 500 双门控）。
- `drain()` 时聚合为 `scroll_summary`：`max_depth / total_scroll / direction_changes / duration / read_time`。`read_time` 以相邻事件间隔 ≥300ms 累加，近似阅读停留。
- 原始 `scroll_events` 仅在 `drain({ includeRaw: true })` 命中触发时通过 `RawOnRisk.scroll_events` 追加。

#### 3.5.4 `TouchTracker`（`touch.ts`）

- 监听 `touchstart / touchmove / touchend`，取 `touches[0]`。
- 每条：`{ x, y, t, pressure: touch.force ?? 0, radius: touch.radiusX ?? 0, is_trusted }`。
- `pressure`/`radius` 可识别真实触摸 vs 程序化触发（合成触摸这两值通常为 0）。

---
### 3.6 表单反机器人检测（`src/collectors/form-detector/`）

按**表单粒度**独立运行的深度检测器，由 `SDK.detect()` 注册，可同一页面注册多个。

#### 3.6.1 配置与生命周期

```ts
interface FormDetectConfig {
  containerSelector: string;   // 表单容器
  actionSelector: string;      // 提交按钮
  onResult: (r: FormDetectionResult) => void;
}
```

- 构造函数调用 `resolveAndBind()`：立即查询 container/actionEl；在 `document.documentElement` 上挂 `MutationObserver`——如果 container 后挂载（SPA 场景），自动补绑。
- 绑定事件：`focusin/click/input/keydown/keyup/mousemove`（容器内），外加 `document` 的 `keydown/keyup/mousemove`，以及 `actionEl.click` 和容器级 Enter 提交。
- 容器内部再挂一层 `MutationObserver`（`childList + subtree`）处理动态字段渲染，会重新 `scanFields()`。

#### 3.6.2 每字段状态 `FieldState`

```
{ hadFocus, hadClick, hadInput, hadKeydown, hadKeyup, inputTrusted,
  firstInputTime, lastInputTime, clickCount, clickCentered, clickCorner,
  clickOffsetKey, tabPressed, modifierUsed, totalChars }
```

- `clickCentered`：点击点与字段中心距离 `dx<=3 && dy<=3`。
- `clickCorner`：距四角 ≤3px。
- `clickOffsetKey`：`"round(dx),round(dy)"`，跨字段去重检测机械偏移。

#### 3.6.3 触发时机

两个入口：用户点击 `actionEl`（提交按钮）；用户在 input/textarea 内按下 `Enter`（无修饰键）。两者均调 `analyze()`。

#### 3.6.4 三大信号算法

##### (A) `suspiciousClientSideBehavior`（可疑客户端行为）

6 个子检查，命中 **≥2** 项置真。`is_trusted` 为 false 的事件是核心判据：

| 代码 | 判据 |
|---|---|
| `NO_KEYBOARD_BUT_VALUE` | 存在字段：`hadInput && !hadKeydown && !inputTrusted && totalChars>0`（排除浏览器自动填充） |
| `CENTER_CORNER_CLICK` | 总点击 ≥2 且 中心/四角点击比 > 2/3 |
| `SAME_CLICK_OFFSET` | ≥2 字段、≥2 次点击，`offsetKey` 去重后只剩 1 个 |
| `NO_MOUSE_BEFORE_CLICK` | 点击 ≥3，无前置鼠标移动比例 > 50% |
| `NO_TAB_NO_CLICK_SWITCH` | ≥2 个非可信输入字段，全部没按 Tab 且没点击切换 |
| `PARALLEL_FILL` | ≥2 个非可信字段的首次输入间隔 < 100ms |
| `UNTRUSTED_EVENTS`（附加） | ≥2 次点击全部 `isTrusted=false` |

##### (B) `superHumanSpeed`（超人类速度）

命中 **≥2** 项置真：

| 代码 | 判据 |
|---|---|
| `FILL_TOO_FAST` | 填写时长 > 0 且 < 500ms，且 totalChars > 10 |
| `BATCH_ASSIGN` | fillDuration === 0（瞬时赋值）且存在非可信 input |
| `TYPING_TOO_FAST` | 字符/秒 (cps) > 20 |
| `UNIFORM_INTERVALS` | 总按键 > 10，按键间隔变异系数 CV < 0.1 |
| `ORPHAN_KEYDOWN` | orphanKeydowns >= 5（有 keydown 无 keyup，典型 CDP `Input.dispatchKeyEvent` 单发） |

**打字节奏算法** `buildTypingCadence`：
- 取所有 keydown 间隔 `gap ∈ (0, 2000)`（过滤暂停/粘贴等）；
- `avg = mean(intervals)`，`std = sqrt(mean((x-avg)²))`，`CV = std/avg`；
- `orphanKeydowns` = 无对应 keyup 的 keydown 数。

**CV < 0.1 的含义**：人类打字节奏抖动自然，CV 通常 > 0.3。低于 0.1 意味着几乎等间距，典型脚本 `sleep(50) sendKey(...)` 循环。

##### (C) `hasCDPMouseLeak`（CDP 鼠标指纹泄漏）

针对 Puppeteer/Playwright `Input.dispatchMouseEvent` 已知特征：

| 代码 | 判据 |
|---|---|
| `ZERO_COORD_CLICK` | 任意点击 `x===0 && y===0`（CDP 默认坐标）→ **直接置真 return** |
| `INTEGER_COORDS` | 总点击 ≥5，整数坐标比例 > 95%，且不同坐标 ≥3（排除 Retina + 重复同位置） |
| `COORD_INCONSISTENT` | `abs(pageX - clientX - scrollX) > 1`（CDP 合成事件 page/client 算术关系被破坏） |
| `OFFSET_ANOMALY` | `offsetX===0 && offsetY===0` 但 clientX/Y 正常（超过 30%） |
| 附加 | 未信任点击比例 > 30% |

除首条外，其余需命中 **≥2** 项置真。

##### (D) 风险分合并

```
riskScore = 0
if scb:  +40  /  if shs: +35  /  if cdpm: +25
is_pass = riskScore < 40
```

`FormDetector.getSignals()` 被 SDK `collectEnv()` 调用，将三大信号和 issue code（以 `form:` 前缀）合并回 `EnvStaticReport.risk_indicators`。

---

### 3.7 传输层（`src/transport/`）

四级设计：`TransportManager → BatchQueue → RetryQueue → Reporter`，挂载 `BeaconManager` 处理页面卸载。

#### 3.7.1 `BatchQueue`（`batch.ts`）

- `add(report)`：入队；若 `queue.length >= maxSize` 立即 `flush()`。
- `flush()`：非空时 `splice(0)` 一次性取出出队；重置定时器。
- 定时器：`setTimeout(tick, interval)` 轮询，**非 setInterval**，避免跨轮漂移。
- `drain()`：不触发 onFlush，只返回待发数据——Beacon 在页面卸载时通过它拿到 payload。

#### 3.7.2 `RetryQueue`（`retry.ts`）

退避算法：

```
exponential = baseDelay * 2^attempt   // 1s → 2s → 4s...
capped      = min(exponential, maxDelay=30000)
jitter      = capped * (0.8 + random()*0.4)  // ±20%
```

防止 retry 风暴同步打爆服务器。

#### 3.7.3 `Reporter`（`reporter.ts`）

**当前是占位实现**：只 `console.log` 并返回 `true`。注释中保留了 fetch POST 的 TODO 模板。这意味着主通道实际**不发起网络请求**，只有 beacon 通道在页面卸载时会真正 POST。

> ⚠️ 生产化前必须接入实际 HTTP。建议补充：压缩（gzip）、状态码分类（4xx 不重试、5xx/网络错重试）。

#### 3.7.4 `BeaconManager`（`beacon.ts`）

- 构造时注册 `document.visibilitychange`（仅当 hidden）和 `window.pagehide`。
- 触发时调用 `pendingPayload()`（由 TransportManager 注入 `()` => `JSON.stringify(batch.drain())`）。
- 优先 `navigator.sendBeacon(endpoint, blob)`；不可用时同步 XHR 兜底。
- `sent` 标志防双触发。

**设计评价**：Beacon + 批量是业界标准；beacon 发送失败无感知（浏览器 API 无回调），生产可考虑 fetch with `keepalive: true` 作为改良替代。

---

### 3.8 完整性签名（`src/utils/integrity.ts`）

```ts
function signReport(report) {
  const { integrity_check: _, ...payload } = report;
  return sha256(stringify(payload));  // fast-json-stable-stringify 保证确定性序列化
}
```

- 排除 `integrity_check` 自身避免循环。
- 使用 `fast-json-stable-stringify` 递归稳定排序所有 key（含嵌套对象）。
- sha256 使用纯 JS 实现（`js-sha256`），无需 `SubtleCrypto`（兼容非 HTTPS）。

### 3.9 生命周期与事件总线

#### `Lifecycle`（`core/lifecycle.ts`）
四态状态机：`idle → active → paused → active → destroyed`。非法迁移被忽略。

#### `EventBus`（`core/event-bus.ts`）
`Map<event, Set<Handler>>`，`emit` 内 `try/catch` 包裹每个回调，单监听器抛错不影响其他。

---

## 四、使用方法

### 4.1 UMD 直接引用

```html
<script src="./dist/behavior-track.umd.js"></script>
<script>
  BehaviorTrack.init({
    appId: 'your-app-id',
    endpoint: 'https://your-backend.com/collect',
    enableFingerprint: true,
    enableEnvironment: true,
    enableBehavior: true,
    behaviorSampleRate: 1.0,
    batchInterval: 5000,
    batchSize: 50,
    maxRetries: 3,
  }).then(async () => {
    const env = await BehaviorTrack.getEnvInfo();
    console.log('风险分:', env.risk_indicators.risk_score);
    console.log('命中信号:', env.risk_indicators.signals);
  });

  BehaviorTrack.onBehaviorReport((report) => {
    console.log('行为批次:', report.sequence_no, report.data_stream);
  });
</script>
```

### 4.2 ESM / 模块化

```ts
import { BehaviorTrack } from 'behavior-track';
await BehaviorTrack.init({ appId: 'my-app' });
const env = await BehaviorTrack.getEnvInfo();
```

### 4.3 表单检测示例

```ts
BehaviorTrack.detect({
  containerSelector: '#login-form',
  actionSelector: '#login-btn',
  onResult: (r) => {
    if (!r.is_pass) {
      console.warn('登录风险:', r.risk_score, r.issues);
      // 弹出验证码 / 拒绝提交 / 上报审核
    }
  },
});
```

### 4.4 构建与调试

```bash
pnpm install          # 安装依赖
pnpm build            # 生产构建
pnpm dev              # 监听构建
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest（当前 tests 目录为空）
node scripts/test-risk.mjs   # Playwright 驱动三种浏览器环境回归
```

`scripts/test-risk.mjs` 自动：启本地 HTTP server、依次启动 Headless/Headful/CDP 三种 Chromium、页面内调用 BehaviorTrack 采集风险、终端打印 `is_webdriver / is_cdp / risk_score / signals`。

`examples/index.html` 是基于 Vue3 + Tailwind 的可视化控制台，提供 SDK 初始化/暂停/恢复/销毁、环境面板刷新、模拟登录表单、行为统计展示。

---

## 五、采集项清单（合规/隐私审计）

| 分类 | 字段 | 来源 | 是否含 PII |
|---|---|---|---|
| **设备** | `device_id` | 本地 UUID v4，双写 LS/IDB | 否（伪 ID） |
| | `fingerprint` | FingerprintJS visitorId | 否（聚合信号哈希） |
| | `webrtc_ips` | WebRTC ICE 候选 IPv4 | **潜在 PII**（内网 IP 可能用于去匿名化） |
| **会话** | `session_id` | `s_{timestamp}_{8hex}` | 否 |
| **页面上下文** | `url/host/title/referrer/lang/timezone/cookie_enabled` | `location/document/navigator/Date` | url 可能含 query 中的 PII |
| **UA/设备** | `user_agent/browser/browser_version/os/device_type` | UA-CH + UA 回退 | UA 本身可辨识 |
| **风险指标** | `risk_indicators.*` | 十余项环境探测 | 否 |
| **鼠标轨迹** | `{x,y,t,type,is_trusted}` | 全局 `mousemove/click/down/up`（throttle 50ms） | 轨迹可能间接反映行为习惯 |
| **键盘统计** | `{t,key_count,trusted_count,interval_avg,hold_avg}` | 全局 `keydown/keyup`，**不记录键值** | 否 |
| **滚动** | `{t,top,speed,direction,is_trusted}` | `window.scroll`（100ms 去抖） | 否 |
| **触摸** | `{x,y,t,pressure,radius,is_trusted}` | `touchstart/move/end`，取 `touches[0]` | 否 |
| **表单状态** | 每字段交互元数据、`totalChars`；**不记录 value** | 容器内事件 | 否 |

**隐私亮点**：键盘不采集 `key` 值，仅统计节奏；表单字段不采集 `value`，只记字符长度和交互元数据。

**隐私风险点**：WebRTC IP 属于严格身份识别辅助数据，GDPR/CCPA 下可能需要 opt-in；鼠标轨迹在极端情况下可作为行为生物特征；完整 `url`（含 query）进入 `page_context`，业务若在 URL 中传递敏感信息需注意。

---
---

## 六、具体算法一览

### 6.1 `risk_score` 环境分

```
autoSignals = []  // weight=50 each
  if navigator.webdriver 或 webdriver 标志 → push
  if 无头特征 ≥2 → push
  if CDP runtime 命中 且 DevTools 未打开 → push
  if Selenium/Nightmare/Sequentum 残留 → push
  if iframe 内 navigator.webdriver → push

autoSignals.sort(desc by weight)
score = Σ weight[i] * 0.5^i          // 递减叠加
score += (len>=3 ? 20 : len>=2 ? 10 : 0)

// 弱信号线性叠加
score += devtools_open ? 10 : 0
score += !ua_consistent ? 15 : 0
score += iframe_overridden ? 15 : 0
score += !worker_consistent ? 15 : 0
score += worker_cdp ? 10 : 0

risk_score = min(round(score), 100)
```

### 6.2 表单分合入主分

```
formSignals: scb(35) / shs(30) / cdpm(25)
sort desc by weight
finalScore = baseScore + Σ weight[i] * 0.6^i
finalScore = min(round, 100)
```

### 6.3 表单填写时长 / cps

```
fillDuration = lastInputTime - firstInputTime  // performance.now()
totalChars = Σ field.value.length
cps = totalChars / (fillDuration / 1000)

FILL_TOO_FAST: 0 < fillDuration < 500 && totalChars > 10
BATCH_ASSIGN:  fillDuration === 0 && 存在非可信 input
TYPING_TOO_FAST: cps > 20
```

### 6.4 按键节奏变异系数

```
intervals = [ t_i - t_{i-1} | 0 < Δ < 2000 ]
avg = mean(intervals)
std = sqrt(mean((x-avg)²))
CV  = std / avg

UNIFORM_INTERVALS: totalKeys > 10 && CV < 0.1
```

### 6.5 点击质心/四角判定

```
rect = target.getBoundingClientRect()
cx, cy = left + width/2, top + height/2
dx, dy = |clientX - cx|, |clientY - cy|
centered = dx <= 3 && dy <= 3

nearTL = clientX <= left+3 && clientY <= top+3
corner = nearTL || nearTR || nearBL || nearBR

CENTER_CORNER_CLICK: totalClicks>=2 && (中心+四角)/total > 2/3
```

### 6.6 CDP 坐标检测

```
ZERO_COORD_CLICK: x==0 && y==0
INTEGER_COORDS:   total>=5 && intRatio>0.95 && uniquePairs>=3
COORD_INCONSISTENT: |pageX - clientX - scrollX| > 1 || Y 同理
OFFSET_ANOMALY: (offsetX==0 && offsetY==0 && client>10) 比例 > 30%
```

### 6.7 指数退避（网络重试）

```
attempt ∈ [0, maxRetries]
  expBase = baseDelay(1000) * 2^attempt
  capped  = min(expBase, maxDelay=30000)
  jitter  = capped * (0.8 + rand()*0.4)
delay = round(jitter)
```

### 6.8 完整性签名

```
payload = { ...report, without: 'integrity_check' }
integrity_check = sha256(fastJsonStableStringify(payload))
```

---

## 七、工程质量评估

### 7.1 亮点

1. **模块化清晰**：每个检测器单文件单职责，`environment/index.ts` 做聚合，便于新增检测项。
2. **TS 严格模式**：`strict + noUnusedLocals + noUnusedParameters`，类型覆盖完整。
3. **`safeExec` 防御性编程**：所有检测器都用 `try/catch` 包裹，任意一项失败不影响其他信号（风控 SDK 基本要求）。
4. **评分算法合理**：递减几何衰减避免饱和，同时多信号叠加仍能抬升分值。
5. **浏览器自动填充误报处理**：表单检测专门做了 `isTrusted` 过滤（commit `8cbc63f`）。
6. **键值不采集**：合规方向的明确设计取舍。
7. **UMD / ESM / CJS 三产物 + 类型声明**：适配广。
8. **有真实浏览器回归脚本**：`test-risk.mjs` 跑 Headless / Headful / CDP 三场景。

### 7.2 不足与改进建议

| # | 问题 | 建议 |
|---|---|---|
| 1 | **`Reporter.dispatch` 未实际发请求**，仅 `console.log` | 接入 fetch POST，区分 4xx/5xx；支持 `keepalive: true` 取代 beacon | 待解决 |
| 2 | `is_proxy` 恒 `false`，无实现 | 删除或实现（WebRTC / timezone vs geoip 交叉验证） | 待解决 |
| 3 | ~~`Scheduler` 模块定义未使用~~ | 已删除（死代码清理） | ✅ |
| 4 | ~~**完整性签名只排序顶层 key**，嵌套对象未保证顺序~~ | 已替换为 `fast-json-stable-stringify` 递归稳定排序 | ✅ |
| 5 | `appId` 未参与签名/传输 | 至少作为 HMAC 密钥种子 | 待解决 |
| 6 | `tests` 目录为空 | 至少补齐 `consistency`、`iframe`、`form-detector` 的单测 | 待解决 |
| 7 | ~~`BehaviorManager.shouldSample` 每次 `start()` 重新抽样~~ | 已改为 sticky 缓存决策，`drain()` 时重置 | ✅ |
| 8 | ~~`KeyboardTracker` 对任何键（含 Shift/Tab/方向）计入 `key_count`~~ | 已增加 `e.key.length === 1` 过滤，仅记录可打印键 | ✅ |
| 9 | `collectWebRTC` 只匹配 IPv4 | 扩展 IPv6；mDNS 混淆时显式记录信号 | 待解决 |
| 10 | ~~`RetryQueue.pending/addToPending/drainPending` 定义未用~~ | 已删除 | ✅ |
| 11 | ~~`trustedClicks` 变量定义未读~~ | 实际被 `analyzeSuspiciousBehavior` 使用（行 458），非死代码 | ✅ 误报 |
| 12 | ~~`devtools.ts` 尺寸差 160 阈值在高 DPI/小窗口误判~~ | 已改为 `inner/outer < 0.88` 比值判定，并在 `outer < 50` 时跳过（防 iframe/minimized 误触） | ✅ |
| 13 | ~~表单 `keydown` 监听未 `passive`，Enter 触发 `analyze()` 同步执行~~ | 全部监听改 `{ passive: true }`；Enter/action 走 `scheduleAnalyze()`，`requestIdleCallback` 异步合并执行 | ✅ |
| 14 | ~~行为流 `mouse_tracks` 无上限~~ | `MouseTracker` 拆 `moves/clicks` 双缓冲，各自按"时间窗 60s + 容量"双门控，且 mousemove 默认聚合为 `move_features` 不再全量上报 | ✅ |
| 15 | `examples/index.html` 依赖 CDN Tailwind + Vue | 网络受限环境无法本地跑；考虑预打包 vendor | 待解决 |
| 16 | 默认 `endpoint = ''` 导致 beacon 发到空路径 | 空 endpoint 时 warn | 待解决 |
| 17 | ~~mousemove/scroll 全量上报信噪比低~~ | 常态上报 `move_features` / `scroll_summary` 聚合标量；`uploadRawStreamOnRisk` 开启后 `risk_score ≥ rawStreamRiskThreshold` 触发窗口内 `raw_on_risk` 追带原始流 | ✅ |

### 7.3 安全视角

- **反篡改**：当前签名是形式意义，客户端攻击者可重算。真正的方案需要服务端 `appId → appSecret` HMAC，或 WASM 黑盒混淆（开源版无解）。
- **反绕过**：`navigator.webdriver` 可被 `puppeteer-extra-plugin-stealth` 消除，因此 SDK 堆叠了 iframe / Worker / Consistency 三套交叉验证。`Error.prepareStackTrace` 是当前识别 Puppeteer stealth 模式的最可靠方法之一。建议定期同步 evasion 规避库变化。

---

## 八、性能预算

| 环节 | 预估成本 |
|---|---|
| `init` → `getDeviceId` | localStorage 同步读 ~0.1ms；新设备 IDB 首次 open ~10-50ms |
| `getFingerprint` | FingerprintJS 首次 `load+get` 约 100-300ms |
| `collectWebRTC` | 最多 3s 超时，通常 200-500ms |
| `collectEnvironment` | 6 检测器串行，Worker 最慢，整体 30-200ms |
| `MouseTracker` | `throttle 50ms`，每次 push 几 μs |
| `KeyboardTracker` | 每秒聚合一次，轻量 |
| `FormDetector` 事件 | 每次键盘/点击 O(1)；`analyze` 在提交时一次，O(fields * records) |
| `signReport` | sha256 + JSON.stringify，数百 μs（报告 <5KB） |

包体积（生产 + terser，未实测）预计 **60-100KB**（FingerprintJS 即 ~50KB minified）。

---

## 九、总结

### 9.1 一句话定位

一个**设计规整、算法扎实、聚焦 Web 端反爬/反机器人场景**的安全识别 SDK；在"环境指纹 + 交互行为 + 表单专项"三条线上做了合理的信号分层与递减叠加评分；未完成的主要是**上报通道的实际网络实现**和**测试覆盖**。

### 9.2 成熟度评级

| 维度 | 评级 | 备注 |
|---|---|---|
| 架构设计 | ★★★★☆ | 分层清晰，可扩展；Reporter 占位待接入 |
| 代码质量 | ★★★★☆ | TS 严格；少量未使用变量 |
| 算法深度 | ★★★★☆ | 递减叠加评分 + 多源交叉 + 表单节奏分析 |
| 工程化 | ★★★☆☆ | 构建/类型/Demo 齐全；缺单测 |
| 生产就绪度 | ★★★☆☆ | Reporter 未接实际 HTTP；签名对抗强度有限 |
| 合规友好度 | ★★★★☆ | 键值/值不采集；WebRTC IP 需前置同意 |

### 9.3 推荐 Next Steps（按优先级）

1. **实现 `Reporter.dispatch` 的真实 fetch**（含 `keepalive` 作为 beacon 替代或互补）。
2. **补齐单元测试**：至少覆盖 `consistency / iframe / form-detector / integrity` 四个关键模块。
3. **服务端签名**：引入 `appSecret` + HMAC，SDK 内做密钥不落地的分发。
4. **WebRTC mDNS 显式标记**：拿不到真实 IP 时记录 `mdns_obfuscated` 信号。
5. **行为流硬上限**：避免高频交互场景单批爆量。
