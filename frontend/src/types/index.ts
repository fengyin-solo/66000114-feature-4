export interface EEGData { channels: string[]; sample_rate: number; data: Record<string, number[]>; time: number[]; duration: number; }
export interface BandPower { delta: number; theta: number; alpha: number; beta: number; gamma: number; }
export interface BrainState {
  focus: number;
  relaxation: number;
  fatigue: number;
  status: 'focused' | 'relaxed' | 'fatigued' | 'neutral';
  statusLabel: string;
  statusColor: string;
  timestamp: number;
}

/** 相关分析失败/为空时给出的原因 */
export type CorrelationErrorReason = 'compute_failed' | 'empty_result' | 'coherence_missing';

export interface ChannelCorrelation {
  channel: string;
  targetChannel: string;
  /** 相关系数 [-1, 1]；计算失败时整条结果会带 error，不再给出单值 */
  correlation: number;
  /** Alpha 频段相干性 [0, 1]；无法计算（如相干性缺失）时为 null，兼容旧数据 */
  coherence: number | null;
}

export interface CorrelationData {
  targetChannel: string;
  correlations: ChannelCorrelation[];
  /** 非空表示本次相关分析未得到可用结果，UI 必须说明原因且不能沿用上一通道结论 */
  error?: {
    reason: CorrelationErrorReason;
    message: string;
  };
  /** 数据时间戳，用于区分是哪一次计算的结果 */
  timestamp?: number;
}

export interface RecordingFrame {
  relativeTime: number;
  eeg: EEGData;
  bands: BandPower;
  brainState: BrainState;
  correlation: CorrelationData;
}

export interface Recording {
  id: string;
  name: string;
  channel: string;
  startTime: number;
  endTime: number;
  duration: number;
  frames: RecordingFrame[];
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  currentFrame: RecordingFrame | null;
}

/** 相关通道筛选/对比条件，跨通道切换与摘要-详情往返时保持 */
export interface CorrelationFilter {
  /** 用于阈值筛选与排序的指标 */
  metric: 'correlation' | 'coherence';
  /** 阈值（百分比 0~100），|相关性| 或相干性达到该值视为命中 */
  threshold: number;
  /** 排序方向 */
  sortDirection: 'desc' | 'asc';
  /** 摘要列表/图表中的高亮通道（从摘要进入详情前的定位对象） */
  highlightedChannel: string | null;
  /** 当前查看详情对比的通道；非空即详情视图 */
  detailChannel: string | null;
}
