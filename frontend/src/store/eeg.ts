import { create } from 'zustand';
import { EEGData, BandPower, BrainState, CorrelationData, Recording, RecordingFrame, PlaybackState } from '../types';
import {
  CorrelationFilter,
  DEFAULT_FILTER,
  clampThreshold,
  normalizeCorrelationData,
} from '../utils/correlation';

const STORAGE_KEY = 'eeg_recordings';
const FILTER_STORAGE_KEY = 'eeg_correlation_filter_v1';

const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveRecordings = (recordings: Recording[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
  } catch {}
};

/** 读取上次筛选条件；非法字段回退默认值，保证新旧版本数据均可读取 */
const loadFilter = (): CorrelationFilter => {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_FILTER };
    const parsed = JSON.parse(stored);
    return {
      threshold: clampThreshold(Number(parsed.threshold)),
      metric: parsed.metric === 'coherence' ? 'coherence' : 'correlation',
      sortDirection: parsed.sortDirection === 'asc' ? 'asc' : 'desc',
      onlyHits: typeof parsed.onlyHits === 'boolean' ? parsed.onlyHits : DEFAULT_FILTER.onlyHits,
      onlyAnomalies:
        typeof parsed.onlyAnomalies === 'boolean' ? parsed.onlyAnomalies : DEFAULT_FILTER.onlyAnomalies,
      highlightChannel:
        typeof parsed.highlightChannel === 'string' ? parsed.highlightChannel : null,
      detailChannel: typeof parsed.detailChannel === 'string' ? parsed.detailChannel : null,
    };
  } catch {
    return { ...DEFAULT_FILTER };
  }
};

const saveFilter = (filter: CorrelationFilter) => {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {}
};

export type CorrelationLoadState = 'idle' | 'loading' | 'success' | 'error';

interface EEGState {
  eegData: EEGData | null;
  selectedChannel: string;
  bandPower: BandPower | null;
  isStreaming: boolean;
  brainState: BrainState | null;
  correlationData: CorrelationData | null;
  /** 相关分析的加载状态：切换通道立即进入 loading，避免沿用上一通道结论 */
  correlationStatus: CorrelationLoadState;
  /** 加载失败（网络等传输层错误）时的原因说明 */
  correlationErrorLabel: string | null;
  /** 本次结果是否来自历史录制回放 */
  correlationFromPlayback: boolean;
  /** 相关分析筛选条件（跨通道保持、localStorage 持久化） */
  correlationFilter: CorrelationFilter;
  isRecording: boolean;
  recordingStartTime: number;
  currentRecordingFrames: RecordingFrame[];
  recordings: Recording[];
  playbackMode: boolean;
  activeRecording: Recording | null;
  playbackState: PlaybackState;
  setEEGData: (d: EEGData | null) => void;
  setChannel: (c: string) => void;
  setBandPower: (b: BandPower | null) => void;
  setStreaming: (v: boolean) => void;
  setBrainState: (s: BrainState | null) => void;
  /** 标记相关分析开始加载（切换通道 / 手动重试） */
  beginCorrelationLoad: (channel: string) => void;
  /** 写入归一化后的相关分析结果，状态由结果自身 status 决定 */
  setCorrelationResult: (raw: unknown, fromPlayback?: boolean) => void;
  /** 传输层失败（网络错误等） */
  setCorrelationLoadError: (label: string) => void;
  /** 更新筛选条件的一部分并持久化 */
  updateCorrelationFilter: (patch: Partial<CorrelationFilter>) => void;
  resetCorrelationFilter: () => void;
  startRecording: () => void;
  stopRecording: (name: string) => void;
  addRecordingFrame: (eeg: EEGData, bands: BandPower, brainState: BrainState, correlation: CorrelationData) => void;
  deleteRecording: (id: string) => void;
  enterPlaybackMode: (recording: Recording) => void;
  exitPlaybackMode: () => void;
  setPlaybackTime: (time: number) => void;
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

export const useEEGStore = create<EEGState>((set, get) => ({
  eegData: null,
  selectedChannel: 'Fp1',
  bandPower: null,
  isStreaming: false,
  brainState: null,
  correlationData: null,
  correlationStatus: 'idle',
  correlationErrorLabel: null,
  correlationFromPlayback: false,
  correlationFilter: loadFilter(),
  isRecording: false,
  recordingStartTime: 0,
  currentRecordingFrames: [],
  recordings: loadRecordings(),
  playbackMode: false,
  activeRecording: null,
  playbackState: {
    isPlaying: false,
    currentTime: 0,
    currentFrame: null,
  },
  setEEGData: (d) => set({ eegData: d }),
  setChannel: (c) => {
    if (get().playbackMode) {
      // 回放模式下只跟随左侧通道选择，不触发实时加载状态
      set({ selectedChannel: c });
      return;
    }
    set({
      selectedChannel: c,
      // 立即清空上一通道结论并进入 loading，杜绝“沿用旧结果”
      correlationData: null,
      correlationStatus: 'loading',
      correlationErrorLabel: null,
      correlationFromPlayback: false,
    });
  },
  setBandPower: (b) => set({ bandPower: b }),
  setStreaming: (v) => set({ isStreaming: v }),
  setBrainState: (s) => set({ brainState: s }),
  beginCorrelationLoad: (channel) => {
    const { correlationData, selectedChannel } = get();
    // 同通道周期刷新时保留旧数据（标 loading），切通道/首帧时旧数据已清空
    const keepStale = correlationData?.targetChannel === channel && selectedChannel === channel;
    set({
      correlationStatus: 'loading',
      correlationErrorLabel: null,
      correlationFromPlayback: false,
      ...(keepStale ? {} : { correlationData: null }),
    });
  },
  setCorrelationResult: (raw, fromPlayback = false) => {
    const normalized = normalizeCorrelationData(raw);
    if (!normalized) {
      set({
        correlationData: null,
        correlationStatus: 'error',
        correlationErrorLabel: '服务端返回为空，未取得相关分析结果',
        correlationFromPlayback: fromPlayback,
      });
      return;
    }
    set({
      correlationData: normalized,
      correlationStatus: normalized.status === 'error' ? 'error' : 'success',
      correlationErrorLabel:
        normalized.status === 'error'
          ? normalized.reasonLabel || '相关分析计算失败'
          : null,
      correlationFromPlayback: fromPlayback,
    });
  },
  setCorrelationLoadError: (label) =>
    set({
      correlationStatus: 'error',
      correlationErrorLabel: label,
      correlationFromPlayback: false,
    }),
  updateCorrelationFilter: (patch) => {
    const next: CorrelationFilter = { ...get().correlationFilter, ...patch };
    if (patch.threshold !== undefined) next.threshold = clampThreshold(patch.threshold);
    saveFilter(next);
    set({ correlationFilter: next });
  },
  resetCorrelationFilter: () => {
    const next = { ...DEFAULT_FILTER };
    saveFilter(next);
    set({ correlationFilter: next });
  },
  startRecording: () => {
    set({
      isRecording: true,
      recordingStartTime: Date.now(),
      currentRecordingFrames: [],
      playbackMode: false,
      activeRecording: null,
    });
  },
  stopRecording: (name: string) => {
    const { currentRecordingFrames, recordingStartTime, selectedChannel } = get();
    if (currentRecordingFrames.length === 0) {
      set({ isRecording: false, currentRecordingFrames: [] });
      return;
    }
    const endTime = Date.now();
    const duration = (endTime - recordingStartTime) / 1000;
    const newRecording: Recording = {
      id: `rec_${endTime}`,
      name: name || `录制 ${new Date(recordingStartTime).toLocaleString()}`,
      channel: selectedChannel,
      startTime: recordingStartTime,
      endTime,
      duration,
      frames: currentRecordingFrames,
    };
    const recordings = [...get().recordings, newRecording];
    saveRecordings(recordings);
    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
      recordings,
    });
  },
  addRecordingFrame: (eeg, bands, brainState, correlation) => {
    const { isRecording, recordingStartTime, currentRecordingFrames } = get();
    if (!isRecording) return;
    const relativeTime = (Date.now() - recordingStartTime) / 1000;
    const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
    set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
  },
  deleteRecording: (id) => {
    const recordings = get().recordings.filter(r => r.id !== id);
    saveRecordings(recordings);
    const { activeRecording } = get();
    if (activeRecording?.id === id) {
      set({ recordings, playbackMode: false, activeRecording: null });
    } else {
      set({ recordings });
    }
  },
  enterPlaybackMode: (recording) => {
    if (recording.frames.length === 0) return;
    const frame = recording.frames[0];
    const normalized = normalizeCorrelationData(frame.correlation);
    set({
      playbackMode: true,
      activeRecording: recording,
      // 回放聚焦录制时的目标通道，避免标题与数据目标不一致
      selectedChannel: recording.channel,
      playbackState: {
        isPlaying: false,
        currentTime: 0,
        currentFrame: frame,
      },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: normalized,
      correlationStatus: normalized ? (normalized.status === 'error' ? 'error' : 'success') : 'error',
      correlationErrorLabel:
        !normalized ? '录制数据中缺少相关分析结果' : null,
      correlationFromPlayback: true,
    });
  },
  exitPlaybackMode: () => {
    set({
      playbackMode: false,
      activeRecording: null,
      correlationFromPlayback: false,
      playbackState: {
        isPlaying: false,
        currentTime: 0,
        currentFrame: null,
      },
    });
  },
  setPlaybackTime: (time) => {
    const { activeRecording } = get();
    if (!activeRecording || activeRecording.frames.length === 0) return;
    const frames = activeRecording.frames;
    let frameIndex = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].relativeTime <= time) {
        frameIndex = i;
      } else {
        break;
      }
    }
    const frame = frames[frameIndex];
    const normalized = normalizeCorrelationData(frame.correlation);
    set({
      playbackState: {
        ...get().playbackState,
        currentTime: time,
        currentFrame: frame,
      },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: normalized,
      correlationStatus: normalized ? (normalized.status === 'error' ? 'error' : 'success') : 'error',
      correlationErrorLabel: !normalized ? '录制数据中缺少相关分析结果' : null,
      correlationFromPlayback: true,
    });
  },
  togglePlayback: () => {
    const { playbackState } = get();
    set({
      playbackState: {
        ...playbackState,
        isPlaying: !playbackState.isPlaying,
      },
    });
  },
  setPlaybackPlaying: (playing) => {
    set({
      playbackState: {
        ...get().playbackState,
        isPlaying: playing,
      },
    });
  },
}));
