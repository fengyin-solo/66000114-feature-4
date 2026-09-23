import React, { useEffect, useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useEEGStore } from '../store/eeg';
import { EEGData, BandPower, BrainState, CorrelationData } from '../types';
import { normalizeCorrelation, errorData } from '../utils/correlation';
import axios from 'axios';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const ALL_CHANNELS = ['Fp1', 'Fp2', 'F3', 'F4', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2'];
const SAMPLE_RATE = 256;

const generateMockEEG = (durationSec: number = 3.0): EEGData => {
  const length = Math.floor(SAMPLE_RATE * durationSec);
  const time: number[] = [];
  const data: Record<string, number[]> = {};
  for (let i = 0; i < length; i++) {
    time.push(i / SAMPLE_RATE);
  }
  for (const ch of ALL_CHANNELS) {
    const sig: number[] = [];
    const alphaFreq = 8 + Math.random() * 4;
    const betaFreq = 15 + Math.random() * 10;
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const value = 0.5 * Math.sin(2 * Math.PI * alphaFreq * t) +
                    0.3 * Math.sin(2 * Math.PI * betaFreq * t) +
                    0.2 * (Math.random() * 2 - 1);
      sig.push(value);
    }
    data[ch] = sig;
  }
  return { channels: ALL_CHANNELS, sample_rate: SAMPLE_RATE, data, time, duration: durationSec };
};

const computeBandPower = (): BandPower => {
  const total = 10 + Math.random() * 5;
  return {
    delta: total * (0.2 + Math.random() * 0.1),
    theta: total * (0.15 + Math.random() * 0.1),
    alpha: total * (0.25 + Math.random() * 0.15),
    beta: total * (0.3 + Math.random() * 0.15),
    gamma: total * (0.1 + Math.random() * 0.05),
  };
};

const computeBrainState = (bands: BandPower): BrainState => {
  const total = bands.delta + bands.theta + bands.alpha + bands.beta + bands.gamma + 1e-10;
  const betaRel = bands.beta / total;
  const alphaRel = bands.alpha / total;
  const thetaRel = bands.theta / total;
  const focus = Math.min(100, Math.max(0, betaRel * 300 + (Math.random() - 0.5) * 10));
  const relaxation = Math.min(100, Math.max(0, alphaRel * 300 + (Math.random() - 0.5) * 10));
  const fatigue = Math.min(100, Math.max(0, thetaRel * 300 + (Math.random() - 0.5) * 10));
  const scores = { focused: focus, relaxed: relaxation, fatigued: fatigue };
  const maxScore = Math.max(...Object.values(scores));
  let status: 'focused' | 'relaxed' | 'fatigued' | 'neutral' = 'neutral';
  let statusLabel = '平稳';
  let statusColor = '#757575';
  if (maxScore >= 50) {
    const maxKey = Object.keys(scores).find(k => scores[k as keyof typeof scores] === maxScore) as keyof typeof scores;
    status = maxKey;
    if (status === 'focused') { statusLabel = '专注'; statusColor = '#1976d2'; }
    else if (status === 'relaxed') { statusLabel = '放松'; statusColor = '#388e3c'; }
    else { statusLabel = '疲劳'; statusColor = '#d32f2f'; }
  }
  return {
    focus: Math.round(focus * 10) / 10,
    relaxation: Math.round(relaxation * 10) / 10,
    fatigue: Math.round(fatigue * 10) / 10,
    status,
    statusLabel,
    statusColor,
    timestamp: Date.now(),
  };
};

export const WaveformChart: React.FC = () => {
  const {
    eegData, selectedChannel, setEEGData, setBandPower, setBrainState, setCorrelationData,
    isRecording, addRecordingFrame, playbackMode, setCorrelationLoading, refreshTick,
  } = useEEGStore();
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const fetchTokenRef = useRef(0);
  const prevChannelRef = useRef<string | null>(null);

  const fetchEEG = async () => {
    const state = useEEGStore.getState();
    if (state.playbackMode) return;
    const token = ++fetchTokenRef.current;
    const channel = state.selectedChannel;
    // 仅在通道切换时清空旧结论；同一通道周期刷新保留上一帧结果直到新结果到达，避免闪烁
    const switched = prevChannelRef.current !== null && prevChannelRef.current !== channel;
    if (switched) state.setCorrelationLoading(true);
    setLoading(true);
    let eeg: EEGData, bands: BandPower, brainState: BrainState, correlation: CorrelationData;
    try {
      const { data } = await axios.get(`/api/eeg/sample/${channel}?duration=3`);
      // 快速连续切换通道时丢弃过期响应，避免旧通道结果覆盖新通道
      if (token !== fetchTokenRef.current || useEEGStore.getState().selectedChannel !== channel) return;
      eeg = data.eeg;
      bands = data.bands;
      brainState = data.brainState;
      if (data?.error || !data?.correlation) {
        correlation = errorData(channel, 'compute_failed', `相关分析计算失败：${data?.error || '接口未返回相关数据'}，本通道暂无可对比结论。`);
      } else {
        correlation = normalizeCorrelation(data.correlation, channel);
      }
    } catch {
      // 后端不可用时波形等仍可离线演示；相关结论无法伪造，显式标记失败而不是沿用上一通道
      if (token !== fetchTokenRef.current || useEEGStore.getState().selectedChannel !== channel) return;
      eeg = generateMockEEG(3);
      bands = computeBandPower();
      brainState = computeBrainState(bands);
      correlation = errorData(channel, 'compute_failed', '相关分析服务不可用（后端请求失败，当前为离线演示数据），无法计算通道间相关性与相干性。');
    }
    state.setEEGData(eeg);
    state.setBandPower(bands);
    state.setBrainState(brainState);
    state.setCorrelationData({ ...correlation, timestamp: Date.now() });
    prevChannelRef.current = channel;
    if (state.isRecording) {
      state.addRecordingFrame(eeg, bands, brainState, correlation);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (playbackMode) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCorrelationLoading(false);
      return;
    }
    fetchEEG();
    intervalRef.current = window.setInterval(fetchEEG, 3000);
    return () => {
      fetchTokenRef.current++;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel, playbackMode, refreshTick]);

  const chartData = eegData?.data[selectedChannel]?.map((v: number, i: number) => ({
    t: eegData.time[i]?.toFixed(3), value: v.toFixed(4)
  })) || [];

  const channelName = CHANNEL_NAMES[selectedChannel] || selectedChannel;

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>📈</span>
        <span>{selectedChannel}</span>
        <span style={{ fontSize: '13px', color: '#666', fontWeight: 400 }}>{channelName} · 波形图</span>
        {isRecording && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#d32f2f', fontWeight: 500 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d32f2f', animation: 'pulse 1s infinite' }} />
            录制中
          </span>
        )}
        {playbackMode && (
          <span style={{ fontSize: '12px', color: '#1565c0', fontWeight: 500 }}>⏮ 回放模式</span>
        )}
        {loading && !playbackMode && <span style={{ fontSize: '12px', color: '#999' }}>刷新中...</span>}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <XAxis dataKey="t" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
          <Line type="monotone" dataKey="value" stroke="#1565c0" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
