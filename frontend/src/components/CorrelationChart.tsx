import React, { useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useEEGStore } from '../store/eeg';
import { ChannelCorrelation, CorrelationData, CorrelationErrorReason, CorrelationFilter } from '../types';
import {
  CHANNEL_NAMES, channelLabel, correlationPct, coherencePct, metricValuePct,
  isHit, buildComparisonRows, normalizeCorrelation,
} from '../utils/correlation';

const THRESHOLD_PRESETS = [30, 50, 70, 90];

const getCorrelationColor = (value: number) => {
  if (value >= 80) return '#2e7d32';
  if (value >= 60) return '#689f38';
  if (value >= 40) return '#f9a825';
  if (value >= 20) return '#ef6c00';
  return '#c62828';
};

const metricLabel = (metric: CorrelationFilter['metric']) => metric === 'correlation' ? '相关性' : 'Alpha相干性';

const errorCopy: Record<CorrelationErrorReason, { icon: string; title: string }> = {
  compute_failed: { icon: '⚠️', title: '相关分析计算失败' },
  empty_result: { icon: '📭', title: '相关分析结果为空' },
  coherence_missing: { icon: '🧩', title: '相干性数据缺失' },
};

const cardStyle: React.CSSProperties = {
  padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
};

const btnBase: React.CSSProperties = {
  padding: '4px 10px', borderRadius: '6px', border: '1px solid #d0d7de',
  background: '#fff', color: '#334155', fontSize: '12px', cursor: 'pointer',
};

const MetricPct: React.FC<{ c: ChannelCorrelation; metric: CorrelationFilter['metric'] }> = ({ c, metric }) => {
  const v = metricValuePct(c, metric);
  if (v === null) {
    return <span style={{ color: '#94a3b8', fontSize: '12px' }}>缺失</span>;
  }
  const color = metric === 'correlation' ? getCorrelationColor(v) : '#1565c0';
  return (
    <span style={{ color, fontWeight: 700, fontSize: '14px' }}>
      {v.toFixed(1)}%
      {metric === 'correlation' && c.correlation < 0 && (
        <span style={{ fontSize: '10px', fontWeight: 500, color: '#b71c1c', marginLeft: 3 }}>负相关</span>
      )}
    </span>
  );
};

export const CorrelationChart: React.FC = () => {
  const {
    correlationData: rawCorrelation, selectedChannel, playbackMode, correlationLoading,
    correlationFilter: filter, setCorrelationFilter, resetCorrelationFilter, requestCorrelationRefresh,
  } = useEEGStore();

  // 统一规整：旧录制、缺失 coherence、空结果都能兼容
  const correlationData: CorrelationData | null = useMemo(
    () => (rawCorrelation ? normalizeCorrelation(rawCorrelation, selectedChannel) : null),
    [rawCorrelation, selectedChannel],
  );

  // 回放/实时数据的真实分析对象（旧录制可能针对别的通道），避免错配后沿用上一通道结论
  const subject = correlationData?.targetChannel || selectedChannel;
  const mismatched = !!correlationData && correlationData.targetChannel !== selectedChannel;
  // 实时模式下目标通道错配说明结果还停留在上一通道；回放模式以帧内 targetChannel 为准
  const loading = correlationLoading || (!playbackMode && mismatched);
  // 高亮/详情对象恰为当前通道自身时不参与对比（自身不在结果行内）
  const highlightedChannel = filter.highlightedChannel && filter.highlightedChannel !== subject
    ? filter.highlightedChannel
    : null;
  const detailChannel = filter.detailChannel && filter.detailChannel !== subject ? filter.detailChannel : null;

  // 从摘要进入详情再返回列表时，恢复排序结果并把高亮对象滚动回可视区
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!detailChannel && highlightedChannel && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [detailChannel, highlightedChannel, subject]);

  const rows = useMemo(
    () => (correlationData && !correlationData.error ? buildComparisonRows(correlationData, filter) : []),
    [correlationData, filter],
  );
  const hitRows = rows.filter((c) => isHit(c, filter));

  // 相干性整体缺失：指标切到相干性且没有任何可用值时，说明原因，不沿用上一通道的相干结论
  const coherenceAllMissing = correlationData && !correlationData.error
    ? correlationData.correlations
        .filter((c) => c.channel !== correlationData.targetChannel)
        .every((c) => c.coherence === null || c.coherence === undefined)
    : false;
  const effectiveError: CorrelationData['error'] | null = correlationData?.error
    ?? (filter.metric === 'coherence' && coherenceAllMissing
      ? { reason: 'coherence_missing' as const, message: '当前帧未计算 Alpha 相干性（可能为旧版数据或计算被跳过），无法按相干性筛选或排序；相关性结果仍可正常使用。' }
      : null);

  const openDetail = (ch: string) => setCorrelationFilter({ detailChannel: ch, highlightedChannel: ch });
  const closeDetail = () => setCorrelationFilter({ detailChannel: null }); // 高亮保留，恢复列表定位
  const detailRow = detailChannel
    ? correlationData?.correlations.find((c) => c.channel === detailChannel)
    : undefined;

  const header = (
    <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '20px' }}>🔗</span>
      <span>{subject}</span>
      <span style={{ fontSize: '13px', color: '#666', fontWeight: 400 }}>{channelLabel(subject)} · 通道相关分析</span>
      {playbackMode && <span style={{ fontSize: '12px', color: '#6a1b9a', fontWeight: 500 }}>⏮ 回放中</span>}
      {!playbackMode && loading && <span style={{ fontSize: '12px', color: '#999' }}>计算中...</span>}
    </h3>
  );

  // ---- 计算中：切换通道后本通道结果到达前，不展示上一通道的结论 ----
  if (loading) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ color: '#999', padding: '40px 0', textAlign: 'center' }}>
          正在计算 {subject} 与其他通道的相关性 / 相干性...
        </div>
      </div>
    );
  }

  if (!correlationData) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ color: '#999', padding: '40px 0', textAlign: 'center' }}>等待数据中...</div>
      </div>
    );
  }

  // ---- 失败 / 为空 / 相干性缺失：说明原因，可重试或切换指标 ----
  if (effectiveError) {
    const copy = errorCopy[effectiveError.reason];
    return (
      <div style={cardStyle}>
        {header}
        <div style={{
          padding: '24px', borderRadius: '10px', textAlign: 'center',
          background: effectiveError.reason === 'coherence_missing' ? '#fff8e1' : '#ffebee',
          border: `1px solid ${effectiveError.reason === 'coherence_missing' ? '#ffe082' : '#ef9a9a'}`,
        }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>{copy.icon}</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#333', marginBottom: '6px' }}>{copy.title}</div>
          <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6, marginBottom: '14px' }}>
            {effectiveError.message}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {effectiveError.reason === 'coherence_missing' ? (
              <button style={{ ...btnBase, background: '#1565c0', color: '#fff', borderColor: '#1565c0' }}
                onClick={() => setCorrelationFilter({ metric: 'correlation' })}>
                改用相关性查看
              </button>
            ) : (
              <button style={{ ...btnBase, background: '#1565c0', color: '#fff', borderColor: '#1565c0' }}
                onClick={requestCorrelationRefresh} disabled={playbackMode}>
                {playbackMode ? '回放数据无法重算' : '🔄 重新计算'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- 过滤控制条：阈值、指标、排序，条件跨通道与摘要-详情往返保持 ----
  const filterBar = (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px',
      padding: '10px 12px', marginBottom: '14px', borderRadius: '8px',
      background: '#f8fafc', border: '1px solid #e2e8f0',
    }}>
      <div style={{ display: 'flex', gap: 4, background: '#e2e8f0', borderRadius: '6px', padding: 2 }}>
        {(['correlation', 'coherence'] as const).map((m) => (
          <button key={m}
            onClick={() => setCorrelationFilter({ metric: m })}
            style={{
              ...btnBase, border: 'none', borderRadius: '4px',
              background: filter.metric === m ? '#1565c0' : 'transparent',
              color: filter.metric === m ? '#fff' : '#475569', fontWeight: filter.metric === m ? 600 : 400,
            }}>
            {m === 'correlation' ? '｜相关性｜' : 'Alpha相干性'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '12px', color: '#64748b' }}>阈值</span>
        {THRESHOLD_PRESETS.map((t) => (
          <button key={t}
            onClick={() => setCorrelationFilter({ threshold: t })}
            style={{
              ...btnBase,
              background: filter.threshold === t ? '#e3f2fd' : '#fff',
              borderColor: filter.threshold === t ? '#1565c0' : '#d0d7de',
              color: filter.threshold === t ? '#1565c0' : '#334155',
              fontWeight: filter.threshold === t ? 600 : 400,
            }}>
            ≥{t}%
          </button>
        ))}
        <input
          type="range" min={0} max={100} step={5} value={filter.threshold}
          onChange={(e) => setCorrelationFilter({ threshold: Number(e.target.value) })}
          style={{ width: 110 }}
          aria-label="相关度阈值"
        />
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', minWidth: 36 }}>{filter.threshold}%</span>
      </div>

      <button style={btnBase} onClick={() => setCorrelationFilter({ sortDirection: filter.sortDirection === 'desc' ? 'asc' : 'desc' })}>
        {filter.sortDirection === 'desc' ? '↓ 从高到低' : '↑ 从低到高'}
      </button>
      <button style={btnBase} onClick={resetCorrelationFilter}>重置</button>

      <span style={{ fontSize: '12px', color: '#475569', marginLeft: 'auto' }}>
        命中 <b style={{ color: hitRows.length ? '#2e7d32' : '#94a3b8' }}>{hitRows.length}</b> / {rows.length} 通道
      </span>
    </div>
  );

  // ---- 摘要：相关性最高的三个通道（点击进入详情）----
  const topCards = rows
    .filter((c) => Number.isFinite(c.correlation))
    .sort((a, b) => correlationPct(b) - correlationPct(a))
    .slice(0, 3);

  const chartData = rows.map((c) => {
    const cp = Number.isFinite(c.correlation) ? correlationPct(c) : 0;
    const coh = coherencePct(c);
    return {
      name: c.channel,
      nameCn: channelLabel(c.channel),
      correlation: cp,
      coherence: coh ?? 0,
      coherenceMissing: coh === null,
      corrInvalid: !Number.isFinite(c.correlation),
      hit: isHit(c, filter),
      highlighted: c.channel === highlightedChannel,
    };
  });

  // ---- 详情视图：与单个通道的对比 ----
  const detailView = detailRow && (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <button style={btnBase} onClick={closeDetail}>← 返回列表</button>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1565c0' }}>
          {subject}（{channelLabel(subject)}） ⟷ {detailRow.channel}（{channelLabel(detailRow.channel)}）
        </div>
        <div style={{ width: 72 }} />
      </div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <DetailStat
          label="Pearson 相关性"
          value={Number.isFinite(detailRow.correlation) ? `${(detailRow.correlation * 100).toFixed(1)}%` : '无效'}
          sub={Number.isFinite(detailRow.correlation)
            ? `绝对值 ${correlationPct(detailRow).toFixed(1)}% · ${detailRow.correlation < 0 ? '相位倾向相反（负相关）' : '同向变化（正相关）'}`
            : '该通道信号无效或缺失，无法计算相关系数'}
          color={getCorrelationColor(correlationPct(detailRow))}
          flagged={!Number.isFinite(detailRow.correlation) || detailRow.correlation <= -0.6}
        />
        <DetailStat
          label="Alpha 相干性 (8–13Hz)"
          value={detailRow.coherence === null || detailRow.coherence === undefined ? '缺失' : `${(detailRow.coherence * 100).toFixed(1)}%`}
          sub={detailRow.coherence === null || detailRow.coherence === undefined ? '本帧未计算相干性' : detailRow.coherence >= 0.7 ? '频段同步较强' : detailRow.coherence >= 0.4 ? '频段同步中等' : '频段同步较弱'}
          color="#1565c0"
          flagged={detailRow.coherence === null || detailRow.coherence === undefined}
        />
        <DetailStat
          label={`当前阈值（${metricLabel(filter.metric)} ≥ ${filter.threshold}%）`}
          value={isHit(detailRow, filter) ? '命中' : '未命中'}
          sub={isHit(detailRow, filter) ? '该连接满足当前筛选条件' : '未达到阈值，调高阈值可进一步收窄'}
          color={isHit(detailRow, filter) ? '#2e7d32' : '#94a3b8'}
        />
      </div>

      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
        在当前条件下的命中通道中的位置：
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {hitRows.map((c, i) => (
          <button key={c.channel}
            onClick={() => setCorrelationFilter({ detailChannel: c.channel, highlightedChannel: c.channel })}
            style={{
              ...btnBase,
              padding: '6px 12px',
              background: c.channel === detailRow.channel ? '#1565c0' : '#fff',
              color: c.channel === detailRow.channel ? '#fff' : '#334155',
              borderColor: c.channel === detailRow.channel ? '#1565c0' : '#cbd5e1',
              fontWeight: c.channel === detailRow.channel ? 700 : 400,
            }}>
            {i + 1}. {c.channel} · <MetricPct c={c} metric={filter.metric} />
          </button>
        ))}
        {hitRows.length === 0 && (
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>当前阈值下无命中通道，可降低阈值后查看。</span>
        )}
      </div>
    </div>
  );

  // ---- 列表视图 ----
  const listView = (
    <div>
      {filterBar}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        {topCards.map((item) => {
          const v = correlationPct(item);
          const color = getCorrelationColor(v);
          return (
            <div key={item.channel}
              onClick={() => openDetail(item.channel)}
              style={{
                flex: 1, minWidth: '120px', padding: '12px', borderRadius: '8px', cursor: 'pointer',
                background: `linear-gradient(135deg, ${color}15, ${color}08)`,
                border: `1px solid ${color}30`,
                outline: item.channel === highlightedChannel ? `2px solid ${color}` : 'none',
              }}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>与 {item.channel} 相关度</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color }}>{v.toFixed(1)}%</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{channelLabel(item.channel)} · 详情 →</div>
            </div>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} barGap={4}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${Number(value).toFixed(1)}%`,
              name === 'correlation' ? '相关性(绝对值)' : '相干性',
            ]}
            labelFormatter={(label: string) => `${label} (${CHANNEL_NAMES[label] || label})`}
          />
          <Bar dataKey="correlation" name="相关性" radius={[4, 4, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i}
                fill={getCorrelationColor(d.correlation)}
                opacity={filter.metric === 'correlation' && !d.hit ? 0.3 : 1}
                stroke={d.highlighted ? '#0d47a1' : 'none'}
                strokeWidth={d.highlighted ? 2 : 0}
              />
            ))}
          </Bar>
          <Bar dataKey="coherence" name="Alpha相干性" fill="#1565c0" radius={[4, 4, 0, 0]}
            opacity={filter.metric === 'coherence' ? 0.9 : 0.35}>
            {chartData.map((d, i) => (
              <Cell key={i} fillOpacity={filter.metric === 'coherence' && !d.hit ? 0.25 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{ marginTop: '14px' }}>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            按{metricLabel(filter.metric)}{filter.sortDirection === 'desc' ? '从高到低' : '从低到高'} · 阈值 ≥ {filter.threshold}%
            {filter.metric === 'correlation' ? '（取绝对值）' : ''}
          </span>
          {hitRows.length > 0 && <span style={{ color: '#2e7d32' }}>已定位 {hitRows.length} 个命中连接</span>}
        </div>

        {hitRows.length === 0 && (
          <div style={{
            padding: '14px', marginBottom: '8px', borderRadius: '8px', textAlign: 'center',
            background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: '13px',
          }}>
            没有通道达到 {filter.threshold}% 阈值，可降低阈值或切换指标。
            <button style={{ ...btnBase, marginLeft: 8 }}
              onClick={() => setCorrelationFilter({ threshold: Math.max(0, filter.threshold - 20) })}>
              降低阈值
            </button>
          </div>
        )}

        {rows.map((c) => {
          const hit = isHit(c, filter);
          const highlighted = c.channel === highlightedChannel;
          const corrValid = Number.isFinite(c.correlation);
          const negative = corrValid && filter.metric === 'correlation' && c.correlation <= -0.6;
          const cohMissing = c.coherence === null || c.coherence === undefined;
          const pct = metricValuePct(c, filter.metric) ?? 0;
          return (
            <div key={c.channel}
              ref={highlighted ? highlightRef : null}
              onClick={() => openDetail(c.channel)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', marginBottom: '6px', borderRadius: '8px', cursor: 'pointer',
                background: highlighted ? '#e3f2fd' : hit ? '#f1f8e9' : '#fafbfc',
                border: highlighted ? '2px solid #1565c0' : hit ? '1px solid #aed581' : '1px solid #eef2f7',
                opacity: hit ? 1 : 0.55,
              }}>
              <span style={{ fontSize: '13px', fontWeight: 700, minWidth: 42, color: '#334155' }}>{c.channel}</span>
              <span style={{ fontSize: '11px', color: '#94a3b8', minWidth: 52 }}>{channelLabel(c.channel)}</span>
              <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: filter.metric === 'correlation' ? getCorrelationColor(pct) : '#1565c0',
                  borderRadius: '3px',
                }} />
              </div>
              <MetricPct c={c} metric={filter.metric} />
              {hit && <span style={{ fontSize: '10px', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: '10px', padding: '1px 8px' }}>命中</span>}
              {negative && <span title="强负相关，可能存在相位反转或参考异常" style={{ fontSize: '10px', color: '#b71c1c', border: '1px solid #ef9a9a', borderRadius: '10px', padding: '1px 8px' }}>异常·负相关</span>}
              {cohMissing && <span title="本帧相干性未计算" style={{ fontSize: '10px', color: '#b26a00', border: '1px solid #ffe082', borderRadius: '10px', padding: '1px 8px' }}>相干缺失</span>}
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>详情 →</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={cardStyle}>
      {header}
      {detailView ?? listView}
    </div>
  );
};

const DetailStat: React.FC<{ label: string; value: string; sub: string; color: string; flagged?: boolean }> =
  ({ label, value, sub, color, flagged }) => (
    <div style={{
      flex: '1 1 180px', minWidth: 160, padding: '14px', borderRadius: '10px',
      background: flagged ? 'linear-gradient(135deg, #ffebee, #fff8e1)' : `linear-gradient(135deg, ${color}12, ${color}06)`,
      border: `1px solid ${color}35`,
    }}>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: flagged ? '#b71c1c' : color }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>{sub}</div>
    </div>
  );
