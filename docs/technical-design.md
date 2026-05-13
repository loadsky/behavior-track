# Web环境安全SDK技术方案

## 一、功能
本 SDK 通过前端采集并分析浏览器环境特征、行为模式等信号，识别自动化工具、无头浏览器、环境篡改等异常行为，为业务方提供风险评估和决策依据。核心功能包括：

- 设备标识：输出跨会话稳定的 device_id 和 fingerprint，辅助服务端进行关联分析
- 环境风险检测：多维度交叉验证（automation / headless / devtools / consistency / iframe / worker），输出 0～100 的风险评分
- 表单检测：基于用户填写表单时的行为特征与环境信息，判断是否存在风险
- 行为流采集：提取鼠标、键盘、滚动、触摸的聚合标量，风险命中时可附带原始事件流
- 完整性签名：采用 SHA-256 签名，防止数据篡改

## 二、收集的特征与信号

### 2.1 设备与会话

采集以下环境基础信息，用于唯一标识与关联分析：

- `device_id`：本地 UUID v4，存储于 localStorage + IndexedDB
- `fingerprint`：FingerprintJS 生成的 visitorId（32 位 hex）
- `webrtc_ips`：通过 WebRTC 获取的本地 IP 列表
- `session_id`：格式为 `s_{timestamp}_{8hex}`
- UA 与设备：`user_agent` / `browser` / `browser_version` / `os` / `device_type`，优先使用 UA-CH，降级使用 UAParser
- 页面上下文：`url` / `host` / `title` / `referrer` / `lang` / `timezone` / `cookie_enabled`

### 2.2 环境风险检测

包含多个子检测器，各自输出风险信号，由聚合层进行去重与加权，最终输出统一的 `risk_indicators` 信号。

#### 自动化工具特征

命中以下任一特征即判定 `is_automation = true`：

- webdriver：`navigator.webdriver === true`
- Selenium 相关属性：`selenium_unwrapped` / `webdriver_evaluate` / `driver_evaluate` / `webdriver_script_fn` / `selenium_cdc` / `selenium_cdc_array`
- Playwright 特征：`playwright` / `playwright_manual`
- PhantomJS 特征：`phantomjs` / `_phantom`
- Firefox Driver 特征：`fxdriver`
- CDP 附加特征：`cdp_detected`
- 其他工具浏览器：`nightmare` / `sequentum`
- Permissions API 缺失：`permissions_api_missing`

#### 无头浏览器特征

命中以下特征 ≥2 条即判定 `is_headless = true`：

- `no_plugins`：非移动端且 `navigator.plugins` 为空
- `no_languages`：`navigator.languages` 为空
- `headless_ua`：User Agent 包含 `HeadlessChrome`
- `chrome_obj_missing`：非移动 Chrome UA 下 `window.chrome` 缺失
- `zero_outer_dimensions`：`outerWidth`/`outerHeight` 全为 0
- `notification_denied_default`：非 Firefox 下 `Notification.permission === 'denied'`
- `software_renderer`：WebGL 渲染器为 `SwiftShader`（软件渲染）

#### DevTools 与 CDP 识别
- `size_diff`：通过窗口尺寸差异推断 DevTools 侧边栏是否开启
- `getter_trap`：利用 DevTools 静默访问某些属性时触发 getter，判断面板是否打开
- `cdp_runtime`：通过 `Error.prepareStackTrace` 访问状态识别 CDP

#### 环境篡改
命中以下任一特征即判定 `is_tampered = true`：
- `prop_descriptor_tampered`：`outerWidth` / `outerHeight` / `webdriver` 的 getter 被改写
- `console_tampered`：`console.debug.toString` 不是原生代码（[native code]）
- `tostring_tampered`：`Function.prototype.toString.toString` 不是原生代码
- `ua_platform_mismatch`：User Agent 标识的操作系统与 `navigator.platform` 不符
- `mobile_no_touch`：User Agent 标识为移动设备但设备无触控能力
- `ua_tampered`：`navigator.userAgent` 被 Proxy 包装
- `navigator_proxy`：`Navigator.prototype.userAgent` 的 getter 不是原生实现

#### iframe 交叉验证
- `iframe_self_overridden`：iframe 内 `contentWindow.self.get.toString` 不是原生代码
- `iframe_contentWindow_eq_window`：`contentWindow === window`
- `iframe_setTimeout_same`：iframe 内的`setTimeout` 与主窗口引用相同
- `iframe_webdriver`：iframe 内检测到 webdriver 信号
- `cdp_iframe`：iframe 内识别到 CDP 特征
- `iframe_native_*`：iframe 干净 toString 反查主框架属性 getter 非原生（outerWidth/webdriver 等）
- `iframe_console_tampered`：iframe 内 `console.debug` 不是原生代码

#### Web Worker 交叉验证
- `worker_webdriver_mismatch` / `worker_ua_mismatch` / `worker_hw_mismatch` / `worker_platform_mismatch` / `worker_languages_mismatch`：上述字段在 Worker 与主线程中不一致
- `cdp_worker`：Worker 内识别到 CDP 特征

#### 聚合输出 `risk_indicators`
- `is_automation`：识别到任一自动化工具特征
- `is_headless`：无头浏览器特征信号 ≥2
- `is_devtools_open`：通过窗口尺寸或 `getter_trap` 检测到 DevTools 开启
- `is_cdp`：在 runtime / iframe / worker 任一环境命中 CDP 检测
- `is_automation`：识别到任一自动化工具特征（具体工具名见 `signals` 数组）
- `is_tampered`：原生对象信息存在篡改迹象
- `is_proxy`：预留字段
- `risk_score`：加权计算得出的 0～100 风险评分（见 §3.3 评分逻辑）
- `signals`：命中的子信号数组

### 2.3 表单风险检测

包含三个主信号，当命中子信号 ≥2 时标记为风险，并与环境风险信号合并后输出检测报告

#### 可疑的客户端行为 `is_suspicious_client`
- `no_keyboard_but_value`：字段中有值，但全程无按键事件，也不是粘贴或浏览器自动填充
- `center_corner_click`：点击总是精准落在输入框的正中心或四角（真人点击通常有偏差）
- `same_click_offset`：多个不同字段的点击位置相对中心坐标偏移完全一致，存在机械痕迹
- `no_mouse_before_click`：点击字段前没有鼠标移动轨迹（真人操作需要先移动鼠标）
- `no_tab_no_click_switch`：多个字段均被填值，但中间既未按 Tab 键也未有点击切换动作，缺少真人操作的切换行为
- `parallel_fill`：两个字段几乎在同一瞬间开始输入（间隔 <100ms），真人无法并行填写
- `untrusted_events`：连续两次以上点击全部为非受信事件（脚本合成的假点击）

#### 超人类速度 `is_super_speed`
- `batch_assign`：从首次输入到末次输入耗时为 0，典型的一次性批量赋值
- `typing_too_fast`：打字速度超过每秒 20 个字符（人类极限约 12～15 字符/秒）
- `uniform_intervals`：按键间隔异常均匀（变异系数 <0.1），真人输入抖动通常 ≥0.2
- `orphan_keydown`：≥5 次只有 keydown 没有 keyup，可能是脚本直接派发的 keydown 事件

#### 鼠标移动异常 `is_mouse_leak`
- `zero_coord_click`：点击坐标为 (0,0) 且事件非受信，可能是脚本直接派发的点击事件
- `coord_inconsistent`：page 坐标与 client 坐标 + 滚动量的值不匹配
- `offset_anomaly`：`offsetX/Y` 为 0 但 `clientX/Y` 明显不在原点，未正确计算 offset

### 2.4 行为流记录

#### 鼠标点击 `MouseTracker`
- `click_tracks[]`：每条记录包含 `t` / `type` / `x` / `y` / `page_x` / `page_y` / `viewport_w` / `viewport_h` / `dpr` / `target_tag` / `target_path` / `is_trusted`
- `move_features`：包含 `count` / `avg_speed` / `straight_ratio` / `pause_count` / `total_distance`
- `raw_on_risk.mouse_moves`：风险窗口内的原始鼠标移动事件列表（默认关闭）

#### 击键节奏 `KeyboardTracker`
- `keyboard_stream[]`：每秒一条，字段为 `key_count` / `trusted_count` / `interval_avg` / `hold_avg`
- `trusted_count < key_count` 说明存在脚本合成的按键事件；`interval_avg` 极小、`hold_avg` 异常均匀，可能是机器输入

#### 滚动行为 `ScrollTracker`
- `scroll_summary`：包含 `max_depth` / `total_scroll` / `direction_changes` / `duration` / `read_time`
- `read_time` 以相邻事件间隔 ≥300ms 累加，表示阅读停留时长
- `raw_on_risk.scroll_events`：风险窗口内的原始滚动事件列表，默认关闭

#### 触摸事件 `TouchTracker`
- `touch_events[]`：每条包含 `x` / `y` / `t` / `pressure` / `radius` / `is_trusted`
- 合成触摸事件的 `pressure` 与 `radius` 通常为 0，是识别程序化触发的核心字段

## 三、调用方式

### 3.1 公共 API

SDK 通过 `BehaviorTrack` 单例对外暴露：

```ts
BehaviorTrack.init(config: SDKConfig): Promise<void>          // 初始化
BehaviorTrack.getEnvInfo(): Promise<EnvStaticReport>          // 获取环境检测报告（风险评分及信号详情）
BehaviorTrack.onBehaviorReport(cb: (report: BehaviorStreamReport) => void): // 订阅行为流报告回调
BehaviorTrack.detect(cfg: FormDetectConfig): void             // 执行表单风险检测
BehaviorTrack.pause() / resume(): void                        // 暂停/恢复采集与上报
BehaviorTrack.resetSession(): string                          // 重置 session_id
BehaviorTrack.destroy(): void                                 // 卸载事件、刷新缓冲区并销毁实例
```

### 3.2 配置项

#### SDKConfig
初始化配置：

```ts
{
  appId: string,                      // 必填，应用标识
  endpoint?: string = '',             // 上报地址
  enableFingerprint?: boolean = true, // 是否启用指纹采集
  enableEnvironment?: boolean = true, // 是否启用环境检测
  enableBehavior?: boolean = true,    // 是否启用行为流采集
  behaviorSampleRate?: number = 1.0,  // 行为流采集抽样率（0～1）
  batchInterval?: number = 5000,      // 采集周期（毫秒）
  batchSize?: number = 50,            // 单批采集上限
  maxRetries?: number = 3,            // 失败重试次数
  uploadRawStreamOnRisk?: boolean = false,   // 风险命中时是否附带原始事件
  rawStreamRiskThreshold?: number = 60,      // 触发附带原始事件的风险阈值
  rawStreamWindowBatches?: number = 3,       // 触发附带原始事件的批次数
  disableSignals?: Array<keyof RiskIndicators> = [],  // 可选禁用的检测项
  debug?: boolean = false,
}
```

#### FormDetectConfig
表单检测配置：

```ts
{
  containerSelector: string,    // 表单容器选择器
  actionSelector: string,       // 提交按钮选择器
  onResult: (r: FormDetectionResult) => void, // 检测结果回调
  disableSignals?: Array<'is_suspicious_client' | 'is_super_speed' | 'is_mouse_leak'>, // 可选禁用的表单检测项
}
```

### 3.3 返回数据

#### EnvStaticReport
环境检测报告结构：

```ts
{
  report_type: 'ENV_STATIC',
  device_id, fingerprint, webrtc_ips,
  session_id, timestamp,
  page_context: { url, host, title, referrer, lang, timezone, cookie_enabled },
  user_agent, browser, browser_version, os, device_type,
  risk_indicators: {
    is_automation, is_headless, is_devtools_open, is_cdp,
    is_tampered, is_proxy,
    is_suspicious_client, is_super_speed, is_mouse_leak,
    risk_score,                  // 0-100
    signals: string[]            // 所有命中的子信号
  },
  error_counts?: Record<scope, number>,
  integrity_check                // SHA-256 签名
}
```

`risk_score` 计算思路：
- 强信号（webdriver、环境篡改、自动化特征等）：每项基础分 50 分，重复出现时按权重递减，避免分数过高
- 同时命中多项强信号时额外加分：命中 2 项加 10 分，命中 3 项及以上加 20 分
- 弱信号（devtools、UA 不一致等）：按固定值 10 或 15 累加
- 总分上限为 100

#### FormDetectionResult
表单检测结果结构：

```ts
{
  is_pass: boolean,                // risk_score < 40
  risk_score: number,              // 0～100
  signals: {                       // 具体触发的信号，供业务决策参考
    is_suspicious_client: boolean, // 可疑的客户端行为
    is_super_speed: boolean,       // 超人类速度
    is_mouse_leak: boolean         // 鼠标移动异常
  },
  issues: IssueCode[],             // 检测出的问题列表
  timestamp: number                // 检测时间戳
}
```

#### BehaviorStreamReport
行为流报告结构：

```ts
{
  report_type: 'BEHAVIOR_STREAM',
  device_id, session_id, sequence_no, timestamp,
  data_stream: {
    click_tracks, move_features, scroll_summary,
    keyboard_stream, touch_events,
    raw_on_risk?: { mouse_moves, scroll_events, trigger_score }
  },
  integrity_check                // SHA-256 签名
}
```

### 3.4 使用示例

UMD 方式引入

```html
<script src="./dist/behavior-track.umd.js"></script>
<script>
  BehaviorTrack.init({
    appId: 'your-app-id',
    endpoint: 'https://your-backend.com/collect',
  }).then(async () => {
    const env = await BehaviorTrack.getEnvInfo();
    console.log(env.risk_indicators.risk_score, env.risk_indicators.signals);
  });

  BehaviorTrack.onBehaviorReport((report) => {
    console.log(report.sequence_no, report.data_stream);
  });

  BehaviorTrack.detect({
    containerSelector: '#login-form',
    actionSelector: '#login-btn',
    onResult: (r) => { if (!r.is_pass) console.warn(r.risk_score, r.issues); },
  });
</script>
```

ESM 方式引入

```ts
import { BehaviorTrack } from 'behavior-track';
await BehaviorTrack.init({ appId: 'my-app' });
const env = await BehaviorTrack.getEnvInfo();
```

## 四、局限性

1. **前端检测透明**：所有检测逻辑均暴露在浏览器中，攻击者可通过反编译、调试、回归测试等方式绕过。前端检测只能提高绕过成本，无法彻底阻止
2. **信号可被伪造**：`navigator.webdriver` 等属性可被隐藏或抹除；行为检测可通过添加随机扰动绕过；`is_trusted` 标志无法阻止模拟真实点击。SDK 通过多信号叠加提升对抗门槛，但无法根除漏报与误报
3. **指纹不稳定**：Canvas、WebGL 等特征会随浏览器或驱动升级而漂移；`device_id` 依赖浏览器缓存，不适合作为长期唯一标识
4. **单会话视角局限**：SDK 仅分析当前页面的瞬时信号，跨账号、跨设备、长期行为异常需服务端进行关联分析。`risk_score` 为启发式加权评估，最终决策应结合服务端数据

## 五、迭代方向

1. **提升采集特征覆盖**：评估并扩展采集维度，增加特征点交叉比对，减少误报与漏报
2. **风控逻辑服务端化**：前端仅负责信号采集，评分逻辑放到服务端，降低风控策略被逆向的风险
3. **工程治理**：优化包体大小与性能开销，完善测试覆盖率，提升 SDK 的易用性与稳定性
