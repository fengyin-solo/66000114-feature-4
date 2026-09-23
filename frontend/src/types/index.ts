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
export type CorrelationStatus = 'ok' | 'empty' | 'error';

export interface ChannelCorrelation {
  channel: string;
  targetChannel: string;
  /** 相关系数 [-1, 1]；无法计算时为 null */
  correlation: number | null;
  /** Alpha 频段相干性 [0, 1]；缺失时为 null */
  coherence: number | null;
  /** 该条目无法计算或部分指标缺失时的原因码 */
  reasonCode?: string;
  /** 原因的中文说明 */
  reasonLabel?: string;
}
export interface CorrelationData {
  targetChannel: string;
  status?: CorrelationStatus;
  reasonCode?: string;
  reasonLabel?: string;
  /** 服务端计算完成的时间戳（毫秒） */
  computedAt?: number;
  correlations: ChannelCorrelation[];
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
