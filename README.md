# behavior-track

Web 前端环境安全识别与行为风控 SDK。通过多维环境指纹检测、用户交互行为分析和表单专项反机器人识别，为业务后端提供设备标识和风险评分，辅助登录、注册、下单等关键场景的自动化/机器人判定

核心设计思路：

- 环境侧：从浏览器自动化标志、无头特征、DevTools/CDP 探测、iframe 篡改、Web Worker 一致性等维度交叉验证，多信号递减叠加计算风险分
- 行为侧：采集鼠标轨迹、键盘节奏、滚动、触摸等交互流，从节奏模式和坐标分布中识别脚本化操作
- 表单侧：针对登录/注册等关键表单做打字节奏、点击分布、CDP 坐标泄漏的专项分析

> [!IMPORTANT]
> 本项目为实验性项目，Reporter 模块仅有 console.log 占位，不发起实际网络上报。如需生产使用，请基于此项目二次开发，接入真实 HTTP 上报通道。

## 功能

- 设备标识：跨会话稳定的 device_id，localStorage + IndexedDB 双写，不依赖 Cookie
- 浏览器指纹：基于 FingerprintJS 开源版
- 环境风险检测：自动化工具、无头浏览器、DevTools/CDP、iframe 篡改、Worker 不一致等十余项检测
- 行为流采集：鼠标轨迹、键盘节奏、滚动、触摸，键值不记录
- 表单反机器人检测：针对登录/注册表单的专项分析（打字节奏、点击分布、CDP 坐标泄漏）
- 批量上报：定时 + 阈值双触发，指数退避重试，sendBeacon 页面卸载兜底

## 安装

```bash
pnpm install behavior-track
```

## 使用

### UMD 直接引入

```html
<script src="./dist/behavior-track.umd.js"></script>
<script>
  BehaviorTrack.init({
    appId: 'your-app-id',
    endpoint: 'https://your-backend.com/collect',
    behaviorSampleRate: 1.0,
    batchInterval: 5000,
    batchSize: 50,
    maxRetries: 3,
    uploadRawStreamOnRisk: false,
    rawStreamRiskThreshold: 60,
    rawStreamWindowBatches: 3,
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

### ESM

```ts
import { BehaviorTrack } from 'behavior-track';

await BehaviorTrack.init({ appId: 'my-app' });
const env = await BehaviorTrack.getEnvInfo();
```

### 表单检测

```ts
const formDetector = BehaviorTrack.createDetector({
  containerSelector: '#login-form',
  actionSelector: '#login-btn',
});

const handleLogin = async () => {
  const r = await formDetector.detect();
  if (!r.is_pass) {
    console.warn('登录风险:', r.risk_score, r.issues);
  }
};
```

## API

| 方法 | 说明 |
|---|---|
| `init(config)` | 初始化 SDK，幂等 |
| `getEnvInfo()` | 获取静态环境报告（设备 ID、指纹、风险分、命中信号） |
| `onBehaviorReport(cb)` | 订阅行为流批次上报回调 |
| `createDetector(config)` | 创建表单检测器实例，返回 `{ detect(): Promise<FormDetectionResult>, destroy() }` |
| `pause()` | 暂停行为采集 |
| `resume()` | 恢复行为采集 |
| `resetSession()` | 重置 session_id、序号与诊断错误计数 |
| `getDiagnostics()` | 获取当前 session、序号及各 scope 错误计数 |
| `destroy()` | 销毁 SDK，卸载事件、flush 剩余数据 |

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `appId` | `string` | 必填 | 应用标识 |
| `endpoint` | `string` | `''` | 上报地址 |
| `enableFingerprint` | `boolean` | `true` | 是否计算浏览器指纹 |
| `enableEnvironment` | `boolean` | `true` | 是否做环境风险检测 |
| `enableBehavior` | `boolean` | `true` | 是否采集行为流 |
| `behaviorSampleRate` | `number` | `1.0` | 行为采集抽样率 (0~1) |
| `batchInterval` | `number` | `5000` | 批量上报周期 (ms) |
| `batchSize` | `number` | `50` | 单批数量上限 |
| `maxRetries` | `number` | `3` | 失败重试次数 |
| `uploadRawStreamOnRisk` | `boolean` | `false` | 风险分超阈值时随行为批次追带原始鼠标/滚动流 |
| `rawStreamRiskThreshold` | `number` | `60` | 触发原始流追带的 `risk_score` 阈值 |
| `rawStreamWindowBatches` | `number` | `3` | 命中阈值后追带原始流的批次数 |
| `disableSignals` | `Array<keyof RiskIndicators>` | `[]` | 强制将指定 RiskIndicators 布尔字段置 false，退出评分 |
| `debug` | `boolean` | `false` | 调试模式 |

## 环境检测信号

SDK 通过 6 个子检测器生成风险评分 (0-100)：

- automation: navigator.webdriver、Selenium/Playwright/Nightmare/Sequentum 残留符号
- headless: 无插件、零语言、无头 UA、WebGL 软件渲染等（命中 ≥2 条才判定）
- devtools: 尺寸比值检测、getter-trap、CDP runtime 探测、属性描述符/console/Function.toString 原生性校验
- consistency: UA 与 platform/touch 一致性、Navigator.prototype 原型篡改
- iframe: 原型链覆写、contentWindow 引用一致性，并利用未污染帧交叉验证 CDP / 属性描述符
- worker-detect: Web Worker 内 navigator 字段、CDP 与主线程比对

`is_automation` / `is_cdp` 在主框架、iframe、Worker 三层检测时只计一次；自动化强信号递减叠加（权重 50，0.5^i 衰减），再叠加若干弱信号（devtools open / is_tampered / worker 不一致等）。

## 表单检测信号

- `is_suspicious_client`：有值无键盘、点击质心/四角聚集、相同点击偏移、无前置鼠标移动、多字段无切换、并行填充、全非受信点击
- `is_super_speed`：瞬时批量赋值、字符速率 > 20 cps、按键间隔 CV < 0.1、孤立 keydown ≥5
- `is_mouse_leak`：零坐标点击、整数坐标聚集、page/client 坐标不一致、offset 异常、非受信点击占比 > 30%

三项各自独立分析，再与环境 `risk_score` 按 0.6 衰减合并（权重 40/35/25）。同时将环境风险快照 (`env_cdp_detected` 等) 归入 issues 输出。

## 构建

```bash
pnpm install
pnpm build          # 生产构建 (ESM + CJS + UMD)
pnpm dev            # 监听模式
pnpm typecheck      # TypeScript 类型检查
pnpm test           # Vitest
node scripts/test-risk.mjs   # Playwright 自动化测试
```

### 自动化测试

`scripts/test-risk.mjs` 使用 Playwright 在三种浏览器场景下验证 SDK 检测能力：

- Test 1 — 无头浏览器 (Headless)：验证 headless + webdriver + CDP 全链路检测
- Test 2 — 有头 + 去自动化标志 (Stealth-like)：去除 `navigator.webdriver` 和 `AutomationControlled` 后的残留信号检测
- Test 3 — CDP 远程连接 (Remote Debugging)：验证隐藏式调试器探测 (`is_cdp && !is_devtools_open`)

每组测试执行：页面加载 -> 模拟登录表单填写提交 -> 采集环境风险评分和表单检测结果 -> 全页面截图保存到 `report/` 目录。

## 技术报告

详细的技术评估报告见 [docs/technical-report.md](docs/technical-report.md)。

## 隐私

- 键盘采集不记录键值，仅统计节奏
- 表单采集不记录 value，仅记字符长度和交互元数据
- device_id 为本地生成的伪标识
- WebRTC 内网 IP 采集为潜在 PII，生产环境需取得用户同意

## License

MIT
