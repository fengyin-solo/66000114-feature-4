import { ChannelCorrelation, CorrelationData, CorrelationErrorReason, CorrelationFilter } from '../types';

export const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

export const channelLabel = (ch: string) => CHANNEL_NAMES[ch] || ch;

/** 相关性取绝对值并换算成百分比 */
export const correlationPct = (c: ChannelCorrelation) => Math.abs(c.correlation) * 100;
/** 相干性换算成百分比；缺失时返回 null */
export const coherencePct = (c: ChannelCorrelation) =>
  c.coherence === null || c.coherence === undefined || !Number.isFinite(c.coherence)
    ? null
    : c.coherence * 100;

/** 按当前筛选指标取值（百分比），指标缺失或无效（相干性 null、相关系数 NaN）时返回 null */
export const metricValuePct = (c: ChannelCorrelation, metric: CorrelationFilter['metric']): number | null => {
  if (metric === 'correlation') {
    return Number.isFinite(c.correlation) ? Math.abs(c.correlation) * 100 : null;
  }
  return c.coherence === null || c.coherence === undefined || !Number.isFinite(c.coherence)
    ? null
    : c.coherence * 100;
};

/** 命中：指标值存在且达到阈值 */
export const isHit = (c: ChannelCorrelation, filter: CorrelationFilter): boolean => {
  const v = metricValuePct(c, filter.metric);
  return v !== null && v >= filter.threshold;
};

/**
 * 把任意来源（接口、旧录制、离线兜底）的相关数据规整成 CorrelationData。
 * 保证：结构合法；coherence 缺失统一为 null；无法得出任何结论时带 error。
 */
export const normalizeCorrelation = (
  raw: unknown,
  targetChannel: string,
): CorrelationData => {
  if (!raw || typeof raw !== 'object') {
    return errorData(targetChannel, 'compute_failed', '相关分析未返回结果（接口响应异常），无法得到通道间相关结论。');
  }
  const obj = raw as Partial<CorrelationData>;
  const realTarget = typeof obj.targetChannel === 'string' ? obj.targetChannel : targetChannel;

  // 上游已显式给出失败原因（例如计算失败、结果为空），直接沿用其说明
  if (obj.error && (obj.error.reason === 'compute_failed' || obj.error.reason === 'empty_result' || obj.error.reason === 'coherence_missing')) {
    return { targetChannel: realTarget, correlations: [], error: { ...obj.error }, timestamp: obj.timestamp };
  }

  if (!Array.isArray(obj.correlations)) {
    return errorData(realTarget, 'compute_failed', '相关分析计算失败：缺少相关性数据，未得到本通道与其他通道的结论。');
  }

  const correlations: ChannelCorrelation[] = obj.correlations
    .filter((c): c is ChannelCorrelation => !!c && typeof c.channel === 'string')
    .map((c) => {
      const corr = typeof c.correlation === 'number' && Number.isFinite(c.correlation)
        ? Math.max(-1, Math.min(1, c.correlation))
        : NaN;
      const coh = typeof c.coherence === 'number' && Number.isFinite(c.coherence)
        ? Math.max(0, Math.min(1, c.coherence))
        : null;
      return {
        channel: c.channel,
        targetChannel: typeof c.targetChannel === 'string' ? c.targetChannel : realTarget,
        correlation: corr,
        coherence: coh,
      };
    });

  const others = correlations.filter((c) => c.channel !== realTarget);
  if (others.length === 0) {
    return errorData(realTarget, 'empty_result', '相关分析结果为空：没有其他通道的相关数据，请稍后重试或检查采集通道。');
  }
  if (others.every((c) => !Number.isFinite(c.correlation))) {
    return errorData(realTarget, 'compute_failed', '相关系数计算失败：所有通道结果均无效，无法给出相关度结论。');
  }

  return { targetChannel: realTarget, correlations, timestamp: obj.timestamp };
};

export const errorData = (
  targetChannel: string,
  reason: CorrelationErrorReason,
  message: string,
): CorrelationData => ({
  targetChannel,
  correlations: [],
  error: { reason, message },
  timestamp: Date.now(),
});

/** 排序后的其他通道结果（目标通道自身不参与对比） */
export const buildComparisonRows = (data: CorrelationData, filter: CorrelationFilter): ChannelCorrelation[] => {
  const rows = data.correlations.filter((c) => c.channel !== data.targetChannel);
  return rows.sort((a, b) => {
    const va = metricValuePct(a, filter.metric);
    const vb = metricValuePct(b, filter.metric);
    // 缺失相干性的结果始终排在最后
    if (va === null && vb === null) return a.channel.localeCompare(b.channel);
    if (va === null) return 1;
    if (vb === null) return -1;
    return filter.sortDirection === 'desc' ? vb - va : va - vb;
  });
};
