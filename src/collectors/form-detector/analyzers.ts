import type {
  IssueCode,
  FieldState,
  ClickRecord,
  KeyRecord,
  TypingCadence,
  EnvRiskSnapshot,
  AnalyzerResult,
  ActionClickState,
} from './types';
import { ScbCodes, ShsCodes, CdpCodes, EnvCodes } from './types';

// EventCollector.snapshot() 返回的只读数据快照，分析函数基于此进行纯计算
export interface CollectedData {
  fieldStates: ReadonlyMap<Element, FieldState>;
  clickRecords: readonly ClickRecord[];
  keyRecords: readonly KeyRecord[];
  // action 按钮已被点击且存在至少一种可疑模式时为 true
  actionClickSuspicious: boolean;
  actionClickState: Readonly<ActionClickState>;
  firstInputTime: number;
  lastInputTime: number;
}

/**
 * 可疑客户端行为(SCB)检测，需命中 >=2 项才判定：
 * 1. 有值但无键盘事件  2. 中心/四角点击比例过高  3. 不同元素点击偏移一致
 * 4. 点击前无鼠标移动  5. 多字段无 Tab/点击切换  6. 并行填充  7. 非受信事件
 */
export function analyzeSuspiciousBehavior(data: CollectedData): AnalyzerResult {
  const codes: IssueCode[] = [];
  const checks: boolean[] = [];

  // 1. 有值但无键盘事件（排除浏览器自动填充和粘贴场景）
  for (const [, state] of data.fieldStates) {
    if (state.hadInput && !state.hadKeydown && !state.inputTrusted && !state.hadPaste && state.totalChars > 0) {
      codes.push(ScbCodes.NO_KEYBOARD_BUT_VALUE);
      checks.push(true);
      break;
    }
  }

  // 2. 中心/四角点击占比 >2/3 且总点击 >=2 次
  if (data.actionClickSuspicious) {
    let centerOrCornerClicks = 0;
    let totalClicks = 0;
    if (data.actionClickState.count > 0) {
      totalClicks += data.actionClickState.count;
      if (data.actionClickState.centered || data.actionClickState.corner) {
        centerOrCornerClicks += data.actionClickState.count;
      }
    }
    for (const [, state] of data.fieldStates) {
      if (state.clickCount > 0) {
        totalClicks += state.clickCount;
        if (state.clickCentered || state.clickCorner) centerOrCornerClicks += state.clickCount;
      }
    }
    // 2/3: 中心/四角点击占比阈值
    if (totalClicks >= 2 && centerOrCornerClicks / totalClicks > 2 / 3) {
      codes.push(ScbCodes.CENTER_CORNER_CLICK);
      checks.push(true);
    }
  }

  // 3. 不同元素的点击偏移一致（>=2 个字段共享同一偏移 key）
  if (data.actionClickSuspicious) {
    const offsetKeys = new Set<string>();
    for (const [, state] of data.fieldStates) {
      if (state.clickOffsetKey) offsetKeys.add(state.clickOffsetKey);
    }
    if (offsetKeys.size === 1 && data.fieldStates.size >= 2) {
      codes.push(ScbCodes.SAME_CLICK_OFFSET);
      checks.push(true);
    }
  }

  // 4. 超过半数点击前无鼠标移动（>=3 次点击样本）
  if (data.actionClickSuspicious) {
    const noPrecedingMove = data.clickRecords.filter(r => !r.hadPrecedingMove && !r.isTrusted).length;
    // 0.5: 无前置鼠标移动的点击占比阈值
    if (data.clickRecords.length >= 3 && noPrecedingMove / data.clickRecords.length > 0.5) {
      codes.push(ScbCodes.NO_MOUSE_BEFORE_CLICK);
      checks.push(true);
    }
  }

  // 5. 多字段无 Tab 且无鼠标点击切换（仅检查非可信 input）
  const fieldsWithInput: FieldState[] = [];
  for (const [, state] of data.fieldStates) {
    if (state.hadInput && state.totalChars > 0) fieldsWithInput.push(state);
  }
  const untrustedFields = fieldsWithInput.filter(s => !s.inputTrusted);
  if (untrustedFields.length >= 2) {
    let hasTabOrClick = false;
    for (const s of untrustedFields) {
      if (s.tabPressed || s.hadClick) hasTabOrClick = true;
    }
    if (!hasTabOrClick) {
      codes.push(ScbCodes.NO_TAB_NO_CLICK_SWITCH);
      checks.push(true);
    }
  }

  // 6. 并行填充：两个非可信字段首次输入间隔 <100ms
  const untrustedInputTimes = fieldsWithInput
    .filter(s => !s.inputTrusted)
    .map(s => s.firstInputTime)
    .filter(t => t > 0)
    .sort((a, b) => a - b);
  if (untrustedInputTimes.length >= 2) {
    const minInterval = untrustedInputTimes[1] - untrustedInputTimes[0];
    // 100ms: 两字段首次输入间隔阈值，<100ms 近乎同时填充
    if (minInterval < 100) {
      codes.push(ScbCodes.PARALLEL_FILL);
      checks.push(true);
    }
  }

  // 7. 所有点击均为非受信事件（>=2 次）
  if (data.actionClickSuspicious) {
    const trustedClicks = data.clickRecords.filter(r => r.isTrusted).length;
    if (trustedClicks === 0 && data.clickRecords.length >= 2) {
      codes.push(ScbCodes.UNTRUSTED_EVENTS);
      checks.push(true);
    }
  }

  return { triggered: checks.length >= 2, codes };
}

/**
 * 超人类速度(SHS)检测，需命中 >=2 项才判定：
 * 1. 批量赋值（填充耗时为 0）  2. 打字速度 >20 cps
 * 3. 按键间隔 CV <0.1（机器般均匀）  4. 孤立 keydown >=5 次
 */
export function analyzeSuperHumanSpeed(data: CollectedData): AnalyzerResult {
  const codes: IssueCode[] = [];
  const checks: boolean[] = [];

  const fieldsWithInput: FieldState[] = [];
  let totalChars = 0;
  for (const [, state] of data.fieldStates) {
    if (state.hadInput && state.totalChars > 0) {
      fieldsWithInput.push(state);
      // 粘贴字段的字符不计入打字速度统计
      if (!state.hadPaste) {
        totalChars += state.totalChars;
      }
    }
  }

  if (fieldsWithInput.length === 0) return { triggered: false, codes };

  const fillDuration = data.lastInputTime - data.firstInputTime;

  // 1. 极速填写：填充耗时为 0 但有非可信 input 产生了字符
  const untrustedInputCount = fieldsWithInput.filter(s => !s.inputTrusted && !s.hadPaste).length;
  if (fillDuration === 0 && totalChars > 0 && untrustedInputCount > 0) {
    codes.push(ShsCodes.BATCH_ASSIGN);
    checks.push(true);
  }

  // 2. 打字速度超人类
  if (fillDuration > 0) {
    const cps = totalChars / (fillDuration / 1000);
    // 20 cps: 人类极限约 12-15 cps，>20 cps 几乎不可能
    if (cps > 20) {
      codes.push(ShsCodes.TYPING_TOO_FAST);
      checks.push(true);
    }
  }

  // 3. 按键间隔均匀度（CV = 标准差/均值）
  const cadence = buildTypingCadence(data.keyRecords);
  // CV <0.1 表示间隔极度均匀，人类打字 CV 通常 >0.2
  if (cadence.totalKeys > 10 && cadence.intervalCV < 0.1) {
    codes.push(ShsCodes.UNIFORM_INTERVALS);
    checks.push(true);
  }

  // 4. 孤立 keydown（只有 keydown 无对应 keyup，自动化工具常见行为）
  // >=5: 少量孤立 keydown 可能由 IME/修饰键产生，>=5 才有统计意义
  if (cadence.orphanKeydowns >= 5) {
    codes.push(ShsCodes.ORPHAN_KEYDOWN);
    checks.push(true);
  }

  return { triggered: checks.length >= 2, codes };
}

/**
 * CDP 鼠标指纹检测：识别 Chrome DevTools Protocol 注入的合成鼠标事件。
 * 零坐标点击直接判定；其余需命中 >=2 项。
 */
export function analyzeCDPMouseLeak(data: CollectedData): AnalyzerResult {
  const codes: IssueCode[] = [];
  if (data.clickRecords.length === 0) return { triggered: false, codes };
  if (!data.actionClickSuspicious) return { triggered: false, codes };

  const checks: boolean[] = [];

  // 1. 零坐标点击：(0,0) + untrusted 直接判定为 CDP 合成
  const zeroClicks = data.clickRecords.filter(r => r.x === 0 && r.y === 0 && !r.isTrusted);
  if (zeroClicks.length > 0) {
    codes.push(CdpCodes.ZERO_COORD_CLICK);
    return { triggered: true, codes };
  }

  // 2. 整数坐标比例：Retina 屏真实鼠标会产生小数坐标
  const intCoords = data.clickRecords.filter(r => r.x === Math.floor(r.x) && r.y === Math.floor(r.y));
  const uniqueIntCoords = new Set(intCoords.map(r => `${r.x},${r.y}`));
  // 95%整数坐标 + >=3个不同坐标点 + >=5次点击样本
  if (data.clickRecords.length >= 5 && intCoords.length / data.clickRecords.length > 0.95 && uniqueIntCoords.size >= 3) {
    codes.push(CdpCodes.INTEGER_COORDS);
    checks.push(true);
  }

  // 3. clientX/Y + scrollX/Y 应等于 pageX/Y，差值 >1px 说明坐标可能是合成的
  const inconsistent = data.clickRecords.filter(r => {
    const dx = Math.abs(r.pageX - r.x - r.scrollX);
    const dy = Math.abs(r.pageY - r.y - r.scrollY);
    return dx > 1 || dy > 1;
  });
  if (inconsistent.length > 0) {
    codes.push(CdpCodes.COORD_INCONSISTENT);
    checks.push(true);
  }

  // 4. offsetX/Y 为 0 但 clientX/Y >10px（CDP dispatchMouseEvent 不计算 offset 的特征）
  let offsetMismatch = 0;
  for (const r of data.clickRecords) {
    if (r.offsetX === 0 && r.offsetY === 0 && r.x > 10 && r.y > 10) {
      offsetMismatch++;
    }
  }
  // 30%: offset 异常占比阈值
  if (offsetMismatch > 0 && offsetMismatch / data.clickRecords.length > 0.3) {
    codes.push(CdpCodes.OFFSET_ANOMALY);
    checks.push(true);
  }

  // 5. 非受信点击占比 >30%
  const untrustedClicks = data.clickRecords.filter(r => !r.isTrusted);
  if (untrustedClicks.length > 0 && untrustedClicks.length / data.clickRecords.length > 0.3) {
    checks.push(true);
  }

  return { triggered: checks.length >= 2, codes };
}

// 构建打字节奏统计：计算按键间隔均值、变异系数(CV)、孤立 keydown 数
export function buildTypingCadence(keyRecords: readonly KeyRecord[]): TypingCadence {
  if (keyRecords.length < 2) {
    return { intervals: [], intervalAvg: 0, intervalCV: 0, totalKeys: keyRecords.length, untrustedKeys: 0, orphanKeydowns: 0 };
  }

  const intervals: number[] = [];
  for (let i = 1; i < keyRecords.length; i++) {
    const gap = keyRecords[i].t - keyRecords[i - 1].t;
    // 2000ms: 超过 2 秒的间隔视为停顿，不纳入节奏计算
    if (gap > 0 && gap < 2000) intervals.push(gap);
  }

  let avg = 0;
  let cv = 0;
  if (intervals.length > 0) {
    avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    if (avg > 0) {
      const std = Math.sqrt(intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length);
      // CV(变异系数) = 标准差/均值
      cv = std / avg;
    }
  }

  const untrustedKeys = keyRecords.filter(r => !r.isTrusted).length;
  const orphanKeydowns = keyRecords.filter(r => !r.hadKeyup).length;

  return { intervals, intervalAvg: avg, intervalCV: cv, totalKeys: keyRecords.length, untrustedKeys, orphanKeydowns };
}

// 将环境风险快照中的各布尔标志转换为对应的 issue code 列表
export function collectEnvIssues(envRisk: EnvRiskSnapshot | null): IssueCode[] {
  if (!envRisk) return [];
  const issues: IssueCode[] = [];
  if (envRisk.is_cdp) issues.push(EnvCodes.ENV_CDP_DETECTED);
  if (envRisk.is_devtools_open) issues.push(EnvCodes.ENV_DEVTOOLS_OPEN);
  if (envRisk.is_webdriver) issues.push(EnvCodes.ENV_WEBDRIVER);
  if (envRisk.is_headless) issues.push(EnvCodes.ENV_HEADLESS);
  if (envRisk.worker_cdp) issues.push(EnvCodes.ENV_WORKER_CDP);
  if (envRisk.is_tampered) issues.push(EnvCodes.ENV_TAMPERED);
  if (!envRisk.ua_consistent) issues.push(EnvCodes.ENV_UA_INCONSISTENT);
  return issues;
}
