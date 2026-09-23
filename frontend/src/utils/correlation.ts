import { CorrelationData, ChannelCorrelation } from '../types';

/** 阈值（百分比）默认值与范围 */
export const MIN_THRESHOLD = 0;
export const MAX_THRESHOLD = 100;
export const DEFAULT_THRESHOLD = 60;
/** 判定为“异常强连接”的相关度（百分比） */
export const ANOMALY_CORRELATION = 95;

export type CorrelationMetric = 'correlation' | 'coherence';
export type SortDirection = 'desc' | 'asc';

export interface CorrelationFilter {
  /** 相关度阈值（0-100，按 |correlation| 百分比比较） */
  threshold: number;
  /** 排序所依据的指标 */
  metric: CorrelationMetric;
  /** 排序方向 */
  sortDirection: SortDirection;
  /** 是否仅展示命中阈值的通道 */
  onlyHits: boolean;
  /** 是否仅展示异常强连接 */
  onlyAnomalies: boolean;
  /** 列表中高亮/定位的对比通道 */
  highlightChannel: string | null;
  /** 摘要进入详细分析时查看的对比通道；null 表示停留在列表 */
  detailChannel: string | null;
}

export const DEFAULT_FILTER: CorrelationFilter = {
  threshold: DEFAULT_THRESHOLD,
  metric: 'correlation',
  sortDirection: 'desc',
  onlyHits: true,
  onlyAnomalies: false,
  highlightChannel: null,
  detailChannel: null,
};

/** 顶层（整次计算）原因码 → 中文说明 */
const REASON_LABELS: Record<string, string> = {
  TARGET_MISSING: '目标通道数据缺失，无法计算相关性',
  INSUFFICIENT_SAMPLES: '目标通道样本不足，无法计算相关性',
  TARGET_CONSTANT: '目标通道信号恒定（方差为零），无法计算相关性',
  NO_VALID_PEERS: '没有可与当前通道对比的有效通道',
  CHANNEL_NOT_FOUND: '通道不存在',
  NETWORK_ERROR: '网络请求失败，无法获取相关分析结果',
  EMPTY_PAYLOAD: '服务端返回为空，未取得相关分析结果',
};

/** 单条目原因码 → 中文说明 */
export const ENTRY_REASON_LABELS: Record<string, string> = {
  PEER_MISSING: '对比通道数据缺失',
  LENGTH_MISMATCH: '两通道信号长度不一致，无法对比',
  PEER_CONSTANT: '对比通道信号恒定，方差为零',
  CORRELATION_FAILED: '相关系数计算失败',
  CORRELATION_INVALID: '相关系数计算结果无效（信号可能恒定）',
  COHERENCE_INSUFFICIENT: '样本不足，无法计算相干性',
  COHERENCE_NO_BAND: 'Alpha 频段无有效频点，相干性缺失',
  COHERENCE_INVALID: '相干性计算结果无效',
  COHERENCE_MISSING: '相干性计算失败',
};

export const reasonLabelFor = (code?: string | null, fallback?: string | null): string => {
  if (code && REASON_LABELS[code]) return REASON_LABELS[code];
  if (code && ENTRY_REASON_LABELS[code]) return ENTRY_REASON_LABELS[code];
  return fallback || '结果不可用';
};

const finiteNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 归一化单个通道条目，兼容旧数据（旧数据 correlation/coherence 恒为数值） */
const normalizeEntry = (raw: Partial<ChannelCorrelation>, target: string): ChannelCorrelation | null => {
  const channel = typeof raw.channel === 'string' ? raw.channel : '';
  if (!channel) return null;
  const correlation = finiteNumber(raw.correlation);
  const coherence = finiteNumber(raw.coherence);
  const reasonCode = typeof raw.reasonCode === 'string' ? raw.reasonCode : undefined;
  const reasonLabel =
    typeof raw.reasonLabel === 'string' && raw.reasonLabel.trim()
      ? raw.reasonLabel.trim()
      : reasonCode
        ? reasonLabelFor(reasonCode)
        : undefined;
  return {
    channel,
    targetChannel: typeof raw.targetChannel === 'string' ? raw.targetChannel : target,
    correlation,
    coherence,
    ...(reasonCode ? { reasonCode } : {}),
    ...(reasonLabel ? { reasonLabel } : {}),
  };
};

/**
 * 归一化相关分析数据：
 * - 兼容旧版录制数据（无 status / reasonCode，coherence 恒存在）
 * - 数值非法（NaN/Infinity）统一转为 null 并标注原因
 * - 推断顶层 status，保证 UI 不会沿用上一通道的“成功结论”
 */
export const normalizeCorrelationData = (raw: unknown): CorrelationData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<CorrelationData>;
  const target =
    typeof obj.targetChannel === 'string' && obj.targetChannel
      ? obj.targetChannel
      : '';

  const rawList = Array.isArray(obj.correlations) ? obj.correlations : [];
  const entries = rawList
    .map(e => normalizeEntry((e ?? {}) as Partial<ChannelCorrelation>, target))
    .filter((e): e is ChannelCorrelation => e !== null);

  const base: CorrelationData = {
    targetChannel: target,
    correlations: entries,
  };
  if (typeof obj.computedAt === 'number' && Number.isFinite(obj.computedAt)) {
    base.computedAt = obj.computedAt;
  }

  if (obj.status === 'error' || obj.reasonCode === 'CHANNEL_NOT_FOUND') {
    base.status = 'error';
    base.reasonCode = obj.reasonCode;
    base.reasonLabel = obj.reasonLabel || reasonLabelFor(obj.reasonCode, '相关分析计算失败');
    return base;
  }
  if (obj.status === 'empty') {
    base.status = 'empty';
    base.reasonCode = obj.reasonCode || 'NO_VALID_PEERS';
    base.reasonLabel = obj.reasonLabel || reasonLabelFor(base.reasonCode);
    return base;
  }

  // 旧数据或 status === 'ok'：依据条目实际情况推断
  const validPeers = entries.filter(e => e.channel !== target && e.correlation !== null);
  if (entries.length === 0) {
    base.status = 'empty';
    base.reasonCode = 'EMPTY_PAYLOAD';
    base.reasonLabel = reasonLabelFor('EMPTY_PAYLOAD');
  } else if (validPeers.length === 0) {
    base.status = 'empty';
    base.reasonCode = 'NO_VALID_PEERS';
    base.reasonLabel = reasonLabelFor('NO_VALID_PEERS');
  } else {
    base.status = 'ok';
  }
  return base;
};

export interface PeerRow {
  channel: string;
  nameCn: string;
  correlation: number | null;
  coherence: number | null;
  /** |相关系数| 百分比，无法计算时为 null */
  score: number | null;
  /** Alpha 相干性百分比，缺失时为 null */
  coherencePct: number | null;
  isHit: boolean;
  isAnomaly: boolean;
  coherenceMissing: boolean;
  reasonCode?: string;
  reasonLabel?: string;
}

const CN_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕',
};
export const channelNameCn = (ch: string): string => CN_NAMES[ch] || ch;

/** 构造对比通道行（排除目标通道自身），并标注异常/相干性缺失；命中在 applyFilter 中按当前阈值判定 */
export const buildPeerRows = (data: CorrelationData): PeerRow[] => {
  const target = data.targetChannel;
  return data.correlations
    .filter(e => e.channel !== target)
    .map(e => {
      const score = e.correlation === null ? null : Math.abs(e.correlation) * 100;
      const coherencePct = e.coherence === null ? null : e.coherence * 100;
      // 仅相干性类原因属于“相干性缺失”，相关系数仍可用
      const coherenceMissing =
        e.coherence === null &&
        !!e.reasonCode &&
        e.reasonCode.startsWith('COHERENCE_');
      const unusable = e.correlation === null;
      return {
        channel: e.channel,
        nameCn: channelNameCn(e.channel),
        correlation: e.correlation,
        coherence: e.coherence,
        score,
        coherencePct,
        isHit: false,
        isAnomaly: score !== null && score >= ANOMALY_CORRELATION,
        coherenceMissing,
        ...(unusable || coherenceMissing
          ? { reasonCode: e.reasonCode, reasonLabel: e.reasonLabel }
          : {}),
      } as PeerRow;
    });
};

/** 依据筛选条件对对比通道行排序 */
export const sortPeerRows = (rows: PeerRow[], filter: CorrelationFilter): PeerRow[] => {
  const valueOf = (r: PeerRow): number => {
    if (filter.metric === 'coherence') return r.coherencePct ?? -1;
    return r.score ?? -1;
  };
  const sorted = [...rows].sort((a, b) => {
    const diff = valueOf(b) - valueOf(a); // 默认降序
    return filter.sortDirection === 'desc' ? diff : -diff;
  });
  // 不可用条目（无相关系数）始终沉底，避免占住高相关位置
  return sorted.sort((a, b) => {
    const au = a.correlation === null ? 1 : 0;
    const bu = b.correlation === null ? 1 : 0;
    return au - bu;
  });
};

export interface PeerView {
  rows: PeerRow[];
  hits: PeerRow[];
  anomalies: PeerRow[];
}

/** 应用阈值/排序/异常过滤，返回最终视图 */
export const applyFilter = (data: CorrelationData, filter: CorrelationFilter): PeerView => {
  const threshold = clampThreshold(filter.threshold);
  const rows = buildPeerRows(data).map(r => ({
    ...r,
    isHit: r.score !== null && r.score >= threshold,
  }));
  const hits = rows.filter(r => r.isHit);
  const anomalies = rows.filter(r => r.isAnomaly);

  const filtered = rows.filter(r => {
    if (filter.onlyAnomalies && !r.isAnomaly) return false;
    // 无法计算相关系数的通道始终保留，以展示原因；仅隐藏“有数值但未命中”的通道
    if (filter.onlyHits && !r.isHit && r.correlation !== null) return false;
    return true;
  });
  return { rows: sortPeerRows(filtered, filter), hits, anomalies };
};

export const clampThreshold = (v: number): number => {
  if (!Number.isFinite(v)) return DEFAULT_THRESHOLD;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(v * 10) / 10));
};
