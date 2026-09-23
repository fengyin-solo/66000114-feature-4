import React, { useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
  LineChart, Line,
} from 'recharts';
import { useEEGStore } from '../store/eeg';
import { CorrelationData } from '../types';
import {
  applyFilter, channelNameCn, clampThreshold, reasonLabelFor,
  ANOMALY_CORRELATION, MAX_THRESHOLD, MIN_THRESHOLD,
  PeerRow,
} from '../utils/correlation';

const getScoreColor = (value: number | null) => {
  if (value === null) return '#9e9e9e';
  if (value >= 80) return '#2e7d32';
  if (value >= 60) return '#689f38';
  if (value >= 40) return '#f9a825';
  if (value >= 20) return '#ef6c00';
  return '#c62828';
};

const cardStyle: React.CSSProperties = {
  padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
};

/** 请求重试：由 WaveformChart 监听并重新拉取整帧数据 */
const requestRefresh = () => {
  window.dispatchEvent(new CustomEvent('eeg:refresh-correlation'));
};

/* ---------------- 顶部标题 ---------------- */

const Header: React.FC<{ targetChannel: string; fromPlayback: boolean; extra?: React.ReactNode }> = ({
  targetChannel, fromPlayback, extra,
}) => (
  <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
    <span style={{ fontSize: '20px' }}>🔗</span>
    <span>{targetChannel}</span>
    <span style={{ fontSize: '13px', color: '#666', fontWeight: 400 }}>
      {channelNameCn(targetChannel)} · 通道相关分析
    </span>
    {fromPlayback && <span style={{ fontSize: '12px', color: '#6a1b9a', fontWeight: 500 }}>⏮ 回放数据</span>}
    {extra}
  </h3>
);

/* ---------------- 筛选条 ---------------- */

const FilterBar: React.FC = () => {
  const { correlationFilter, updateCorrelationFilter, resetCorrelationFilter, correlationStatus } = useEEGStore();
  const f = correlationFilter;
  const disabled = correlationStatus === 'loading';
  const labelStyle: React.CSSProperties = { fontSize: '12px', color: '#555', fontWeight: 500 };
  const selectStyle: React.CSSProperties = {
    fontSize: '12px', padding: '4px 8px', border: '1px solid #cfd8dc',
    borderRadius: '6px', background: '#fff', color: '#333',
  };
  const chip = (active: boolean, activeBg: string): React.CSSProperties => ({
    fontSize: '12px', padding: '4px 10px', borderRadius: '14px', cursor: 'pointer',
    border: `1px solid ${active ? activeBg : '#cfd8dc'}`,
    background: active ? activeBg : '#fff',
    color: active ? '#fff' : '#555',
    fontWeight: active ? 600 : 400,
    transition: 'all .15s',
    opacity: disabled ? 0.6 : 1,
  });

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px',
      padding: '10px 12px', background: '#f5f7fa', borderRadius: '8px', marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={labelStyle}>相关度阈值</span>
        <input
          type="range"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          step={5}
          value={f.threshold}
          disabled={disabled}
          onChange={(e) => updateCorrelationFilter({ threshold: Number(e.target.value) })}
          style={{ width: '130px', accentColor: '#1565c0' }}
        />
        <input
          type="number"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          value={f.threshold}
          disabled={disabled}
          onChange={(e) => updateCorrelationFilter({ threshold: clampThreshold(Number(e.target.value)) })}
          style={{ width: '58px', fontSize: '12px', padding: '4px 6px', border: '1px solid #cfd8dc', borderRadius: '6px' }}
        />
        <span style={{ ...labelStyle, color: '#1565c0', fontWeight: 700 }}>%</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={labelStyle}>排序</span>
        <select
          style={selectStyle}
          value={f.metric}
          disabled={disabled}
          onChange={(e) => updateCorrelationFilter({ metric: e.target.value as 'correlation' | 'coherence' })}
        >
          <option value="correlation">按相关性</option>
          <option value="coherence">按 Alpha 相干性</option>
        </select>
        <button
          title={f.sortDirection === 'desc' ? '降序' : '升序'}
          disabled={disabled}
          onClick={() => updateCorrelationFilter({ sortDirection: f.sortDirection === 'desc' ? 'asc' : 'desc' })}
          style={{ ...selectStyle, cursor: 'pointer' }}
        >
          {f.sortDirection === 'desc' ? '↓ 高到低' : '↑ 低到高'}
        </button>
      </div>

      <button
        disabled={disabled}
        style={chip(f.onlyHits, '#1565c0')}
        onClick={() => updateCorrelationFilter({ onlyHits: !f.onlyHits })}
      >
        ✅ 仅看命中
      </button>
      <button
        disabled={disabled}
        style={chip(f.onlyAnomalies, '#d32f2f')}
        onClick={() => updateCorrelationFilter({ onlyAnomalies: !f.onlyAnomalies })}
      >
        🚨 仅看异常连接
      </button>
      <button
        disabled={disabled}
        style={{ ...chip(false, '#999'), marginLeft: 'auto' }}
        onClick={resetCorrelationFilter}
      >
        ↺ 恢复默认
      </button>
    </div>
  );
};

/* ---------------- 命中/异常概览条 ---------------- */

const SummaryStrip: React.FC<{
  hits: PeerRow[];
  anomalies: PeerRow[];
  threshold: number;
  onOpen: (channel: string) => void;
}> = ({ hits, anomalies, threshold, onOpen }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
    <div style={{
      fontSize: '12px', padding: '6px 12px', borderRadius: '16px',
      background: '#e3f2fd', color: '#1565c0', fontWeight: 600,
    }}>
      阈值 ≥ {threshold}% · 命中 {hits.length} 个通道
    </div>
    {anomalies.length > 0 && (
      <div style={{
        fontSize: '12px', padding: '6px 12px', borderRadius: '16px',
        background: '#ffebee', color: '#c62828', fontWeight: 600,
      }}>
        🚨 异常强连接（≥{ANOMALY_CORRELATION}%）{anomalies.length} 处
      </div>
    )}
    {hits.slice(0, 5).map(h => (
      <button
        key={h.channel}
        onClick={() => onOpen(h.channel)}
        title={`定位并查看 ${h.channel}（${h.nameCn}）`}
        style={{
          fontSize: '12px', padding: '4px 12px', borderRadius: '14px', cursor: 'pointer',
          border: '1px solid #90caf9', background: '#fff', color: getScoreColor(h.score),
          fontWeight: 600,
        }}
      >
        {h.channel} {h.score?.toFixed(0)}%
      </button>
    ))}
  </div>
);

/* ---------------- 列表视图 ---------------- */

const CorrelationListView: React.FC<{ data: CorrelationData }> = ({ data }) => {
  const {
    correlationFilter, updateCorrelationFilter, correlationStatus,
  } = useEEGStore();
  const filter = correlationFilter;
  const view = useMemo(() => applyFilter(data, filter), [data, filter]);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const allPeers = useMemo(
    () => applyFilter(data, { ...filter, onlyHits: false, onlyAnomalies: false }),
    [data, filter],
  );

  const openDetail = (channel: string) => {
    updateCorrelationFilter({ detailChannel: channel, highlightChannel: channel });
  };

  // 高亮对象改变时滚动定位
  useEffect(() => {
    if (filter.highlightChannel && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [filter.highlightChannel, view.rows.length]);

  const chartData = view.rows
    .filter(r => r.correlation !== null)
    .map(r => ({
      name: r.channel,
      correlation: r.score ?? 0,
      coherence: r.coherencePct ?? 0,
      hasCoherence: r.coherence !== null,
      highlighted: r.channel === filter.highlightChannel,
    }));

  const isRefreshing = correlationStatus === 'loading';

  return (
    <>
      <FilterBar />
      <SummaryStrip
        hits={allPeers.hits}
        anomalies={allPeers.anomalies}
        threshold={filter.threshold}
        onOpen={openDetail}
      />

      {/* 摘要卡片：仅展示命中通道，点击进入详细分析 */}
      {allPeers.hits.slice(0, 3).map(item => (
        <div
          key={`card-${item.channel}`}
          onClick={() => openDetail(item.channel)}
          style={{
            display: 'inline-block', minWidth: '150px', width: 'calc(33.33% - 8px)',
            marginRight: '8px', marginBottom: '12px', padding: '12px', borderRadius: '8px',
            background: `linear-gradient(135deg, ${getScoreColor(item.score)}15, ${getScoreColor(item.score)}08)`,
            border: `1px solid ${getScoreColor(item.score)}30`,
            cursor: 'pointer', boxSizing: 'border-box',
            outline: filter.highlightChannel === item.channel ? `2px solid ${getScoreColor(item.score)}` : 'none',
          }}
        >
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            与 {item.channel} 相关度 · 点击对比
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: getScoreColor(item.score) }}>
            {item.score?.toFixed(1)}%
          </div>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
            {item.nameCn}
            {item.isAnomaly && <span style={{ color: '#c62828', fontWeight: 700 }}> · 🚨 异常连接</span>}
          </div>
        </div>
      ))}

      {chartData.length === 0 ? (
        <div style={{
          padding: '32px 16px', textAlign: 'center', color: '#777',
          border: '1px dashed #cfd8dc', borderRadius: '8px', marginBottom: '12px',
        }}>
          {filter.onlyAnomalies
            ? `当前条件下没有异常强连接（相关度 ≥ ${ANOMALY_CORRELATION}%）的通道`
            : `当前阈值 ${filter.threshold}% 下没有命中通道，可降低阈值或取消“仅看命中”`}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} barGap={4}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
            <Tooltip
              formatter={(value: number, name: string, item: { payload?: { hasCoherence?: boolean } }) => [
                `${Number(value).toFixed(1)}%`,
                name === 'correlation' ? '相关性' : (item.payload?.hasCoherence === false ? '相干性（缺失）' : 'Alpha 相干性'),
              ]}
              labelFormatter={(label: string) => `${label} (${channelNameCn(label)})`}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Bar
              dataKey="correlation"
              name="相关性"
              radius={[4, 4, 0, 0]}
              onClick={(d: { name?: string }) => d.name && openDetail(String(d.name))}
              cursor="pointer"
            >
              {chartData.map((d) => (
                <Cell
                  key={d.name}
                  fill={getScoreColor(d.correlation)}
                  stroke={d.highlighted ? '#000' : 'transparent'}
                  strokeWidth={d.highlighted ? 2 : 0}
                />
              ))}
            </Bar>
            <Bar dataKey="coherence" name="Alpha相干性" fill="#1565c0" radius={[4, 4, 0, 0]} opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* 命中通道明细列表（含异常定位、相干性缺失原因） */}
      <div style={{ marginTop: '14px' }}>
        <div style={{ fontSize: '12px', color: '#555', fontWeight: 600, marginBottom: '6px' }}>
          命中通道（{view.rows.filter(r => r.isHit).length}）
          {isRefreshing && <span style={{ color: '#999', fontWeight: 400 }}> · 正在按相同条件重新定位…</span>}
        </div>
        {view.rows.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#999', padding: '8px 0' }}>
            没有符合筛选条件的通道
          </div>
        ) : (
          view.rows.map(r => {
            const highlighted = r.channel === filter.highlightChannel;
            return (
              <div
                key={r.channel}
                ref={highlighted ? highlightRef : undefined}
                onClick={() => r.correlation !== null && openDetail(r.channel)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 10px', marginBottom: '6px', borderRadius: '8px',
                  border: highlighted ? '2px solid #1565c0' : '1px solid #eceff1',
                  background: highlighted ? '#e3f2fd'
                    : r.correlation === null ? '#fafafa'
                    : r.isHit ? '#fff' : '#fafafa',
                  opacity: r.isHit ? 1 : 0.6,
                  cursor: r.correlation !== null ? 'pointer' : 'default',
                }}
              >
                <div style={{ minWidth: '52px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#333' }}>{r.channel}</div>
                  <div style={{ fontSize: '10px', color: '#999' }}>{r.nameCn}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ height: '8px', background: '#eceff1', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${r.score ?? 0}%`, height: '100%',
                      background: getScoreColor(r.score), borderRadius: '4px',
                    }} />
                  </div>
                </div>
                <div style={{ minWidth: '60px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: getScoreColor(r.score) }}>
                  {r.score === null ? '—' : `${r.score.toFixed(1)}%`}
                </div>
                <div style={{ minWidth: '92px', textAlign: 'right', fontSize: '11px', color: r.coherenceMissing ? '#c62828' : '#1565c0' }}>
                  {r.coherencePct === null
                    ? '相干性缺失'
                    : `α相干 ${r.coherencePct.toFixed(1)}%`}
                </div>
                <div style={{ minWidth: '70px', textAlign: 'right' }}>
                  {r.isAnomaly && (
                    <span style={{
                      fontSize: '10px', fontWeight: 700, color: '#fff', background: '#c62828',
                      padding: '2px 8px', borderRadius: '10px',
                    }}>🚨 异常</span>
                  )}
                  {r.isHit && !r.isAnomaly && (
                    <span style={{
                      fontSize: '10px', fontWeight: 600, color: '#2e7d32', background: '#e8f5e9',
                      padding: '2px 8px', borderRadius: '10px',
                    }}>命中</span>
                  )}
                </div>
              </div>
            );
          })
        )}
        {/* 相干性缺失 / 无法计算原因说明 */}
        {allPeers.rows.some(r => r.correlation === null || r.coherenceMissing) && (
          <div style={{
            marginTop: '8px', padding: '8px 10px', background: '#fff8e1',
            border: '1px solid #ffe082', borderRadius: '8px', fontSize: '11px', color: '#8d6e00',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>部分通道指标缺失：</div>
            {allPeers.rows
              .filter(r => r.correlation === null || r.coherenceMissing)
              .map(r => (
                <div key={`reason-${r.channel}`}>
                  · {r.channel}（{r.nameCn}）：
                  {r.correlation === null
                    ? (r.reasonLabel || reasonLabelFor(r.reasonCode, '该通道无法计算相关性'))
                    : `相关度 ${r.score?.toFixed(1)}%，${r.reasonLabel || '相干性缺失'}`}
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  );
};

/* ---------------- 详细对比视图 ---------------- */

const DetailView: React.FC<{ data: CorrelationData; peerChannel: string }> = ({ data, peerChannel }) => {
  const { eegData, correlationFilter, updateCorrelationFilter } = useEEGStore();
  const target = data.targetChannel;

  const allPeers = useMemo(
    () => applyFilter(data, { ...correlationFilter, onlyHits: false, onlyAnomalies: false }),
    [data, correlationFilter],
  );
  const row = allPeers.rows.find(r => r.channel === peerChannel) || null;

  const navigable = allPeers.rows.filter(r => r.correlation !== null).map(r => r.channel);
  const idx = navigable.indexOf(peerChannel);
  const prevCh = idx > 0 ? navigable[idx - 1] : null;
  const nextCh = idx >= 0 && idx < navigable.length - 1 ? navigable[idx + 1] : null;

  const backToList = () => updateCorrelationFilter({ detailChannel: null });
  const goPeer = (ch: string) =>
    updateCorrelationFilter({ detailChannel: ch, highlightChannel: ch });

  // 双信号波形（抽样，避免点数过多）
  const waveData = useMemo(() => {
    const a = eegData?.data[target];
    const b = eegData?.data[peerChannel];
    if (!a || !b || a.length === 0 || b.length === 0) return [];
    const maxPoints = 200;
    const stride = Math.max(1, Math.floor(a.length / maxPoints));
    const out: { t: number; target: number; peer: number }[] = [];
    for (let i = 0; i < a.length; i += stride) {
      out.push({
        t: i / (eegData?.sample_rate || 256),
        target: Number(a[i].toFixed(4)),
        peer: Number(b[i]?.toFixed(4) ?? 0),
      });
    }
    return out;
  }, [eegData, target, peerChannel]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={backToList}
          style={{
            padding: '6px 14px', fontSize: '12px', borderRadius: '6px',
            border: '1px solid #90caf9', background: '#fff', color: '#1565c0', cursor: 'pointer', fontWeight: 600,
          }}
        >
          ← 返回列表
        </button>
        <span style={{ fontSize: '13px', color: '#555' }}>
          详细对比：<b>{target}</b>（{channelNameCn(target)}） ↔ <b>{peerChannel}</b>（{channelNameCn(peerChannel)}）
        </span>
        <span style={{
          fontSize: '11px', color: '#1565c0', background: '#e3f2fd',
          padding: '3px 10px', borderRadius: '10px',
        }}>
          沿用阈值 ≥ {correlationFilter.threshold}% ·
          {correlationFilter.metric === 'correlation' ? '按相关性' : '按相干性'}
          {correlationFilter.sortDirection === 'desc' ? '降序' : '升序'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button
            disabled={!prevCh}
            onClick={() => prevCh && goPeer(prevCh)}
            style={{
              fontSize: '12px', padding: '4px 10px', borderRadius: '6px', cursor: prevCh ? 'pointer' : 'default',
              border: '1px solid #cfd8dc', background: '#fff', color: prevCh ? '#333' : '#bbb',
            }}
          >
            ← 上一通道 {prevCh ? `(${prevCh})` : ''}
          </button>
          <button
            disabled={!nextCh}
            onClick={() => nextCh && goPeer(nextCh)}
            style={{
              fontSize: '12px', padding: '4px 10px', borderRadius: '6px', cursor: nextCh ? 'pointer' : 'default',
              border: '1px solid #cfd8dc', background: '#fff', color: nextCh ? '#333' : '#bbb',
            }}
          >
            下一通道 ({nextCh}) →
          </button>
        </div>
      </div>

      {!row || row.correlation === null ? (
        <div style={{
          padding: '28px 16px', textAlign: 'center', color: '#c62828',
          border: '1px solid #ffcdd2', background: '#ffebee', borderRadius: '8px',
        }}>
          {target} 与 {peerChannel} 的相关分析不可用：
          {row?.reasonLabel || reasonLabelFor(row?.reasonCode, '缺少有效计算结果')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <div style={{
              flex: 1, minWidth: '150px', padding: '14px', borderRadius: '10px',
              background: `linear-gradient(135deg, ${getScoreColor(row.score)}18, ${getScoreColor(row.score)}08)`,
              border: `1px solid ${getScoreColor(row.score)}40`,
            }}>
              <div style={{ fontSize: '11px', color: '#666' }}>|相关系数|</div>
              <div style={{ fontSize: '26px', fontWeight: 800, color: getScoreColor(row.score) }}>
                {row.score?.toFixed(2)}%
              </div>
              <div style={{ fontSize: '11px', color: '#999' }}>
                原始 r = {row.correlation >= 0 ? '+' : ''}{row.correlation.toFixed(4)}
                {row.isHit && <span style={{ color: '#2e7d32', fontWeight: 700 }}> · 命中阈值</span>}
                {row.isAnomaly && <span style={{ color: '#c62828', fontWeight: 700 }}> · 🚨 异常强连接</span>}
              </div>
            </div>
            <div style={{
              flex: 1, minWidth: '150px', padding: '14px', borderRadius: '10px',
              background: row.coherencePct === null ? '#ffebee' : 'linear-gradient(135deg, #1565c018, #1565c008)',
              border: `1px solid ${row.coherencePct === null ? '#ef9a9a' : '#90caf9'}`,
            }}>
              <div style={{ fontSize: '11px', color: '#666' }}>Alpha 频段相干性 (8–13Hz)</div>
              {row.coherencePct === null ? (
                <>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#c62828' }}>相干性缺失</div>
                  <div style={{ fontSize: '11px', color: '#c62828' }}>
                    原因：{row.reasonLabel || reasonLabelFor(row.reasonCode, '无法计算相干性')}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: '#1565c0' }}>
                    {row.coherencePct.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#999' }}>
                    原始 Coh = {row.coherence?.toFixed(4)}
                    {row.coherencePct >= correlationFilter.threshold &&
                      <span style={{ color: '#2e7d32', fontWeight: 700 }}> · 命中阈值</span>}
                  </div>
                </>
              )}
            </div>
          </div>

          {waveData.length === 0 ? (
            <div style={{
              padding: '24px', textAlign: 'center', color: '#999',
              border: '1px dashed #cfd8dc', borderRadius: '8px',
            }}>
              回放/当前帧缺少原始波形，无法叠加对比
            </div>
          ) : (
            <>
              <div style={{ fontSize: '12px', color: '#555', fontWeight: 600, marginBottom: '4px' }}>
                双信号波形叠加（抽样 {waveData.length} 点）
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={waveData}>
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} unit="s" />
                  <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      Number(value).toFixed(4),
                      name === 'target' ? `${target} 信号` : `${peerChannel} 信号`,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line type="monotone" dataKey="target" name={`${target}（当前通道）`}
                    stroke="#1565c0" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="peer" name={`${peerChannel}（对比通道）`}
                    stroke="#ef6c00" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </>
      )}
    </>
  );
};

/* ---------------- 主组件 ---------------- */

export const CorrelationChart: React.FC = () => {
  const {
    correlationData, correlationStatus, correlationErrorLabel,
    correlationFromPlayback, selectedChannel, correlationFilter, updateCorrelationFilter,
  } = useEEGStore();

  const targetChannel = correlationData?.targetChannel || selectedChannel;
  const detailChannel = correlationFilter.detailChannel;
  const detailAvailable = !!correlationData?.correlations.some(
    c => c.channel === detailChannel && c.channel !== correlationData.targetChannel,
  );

  // 切到新通道后，若详情通道在本通道结果中不存在，自动退回列表；排序/高亮条件不变
  useEffect(() => {
    if (detailChannel && !detailAvailable && correlationStatus !== 'loading') {
      updateCorrelationFilter({ detailChannel: null });
    }
  }, [detailChannel, detailAvailable, correlationStatus, targetChannel]);

  const header = (
    <Header
      targetChannel={targetChannel}
      fromPlayback={correlationFromPlayback}
      extra={correlationStatus === 'loading'
        ? <span style={{ fontSize: '12px', color: '#999' }}>计算中…</span>
        : undefined}
    />
  );

  // 加载中：不展示任何旧通道结论
  if (correlationStatus === 'loading' || correlationStatus === 'idle') {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ color: '#888', padding: '40px 0', textAlign: 'center' }}>
          {targetChannel} 通道相关分析计算中，请稍候…
        </div>
      </div>
    );
  }

  // 计算失败（网络或顶层 error）：给出原因与重试
  if (correlationStatus === 'error' || !correlationData || correlationData.status === 'error') {
    const reason = correlationErrorLabel
      || correlationData?.reasonLabel
      || reasonLabelFor(correlationData?.reasonCode, '相关分析计算失败');
    return (
      <div style={cardStyle}>
        {header}
        <div style={{
          padding: '28px 16px', textAlign: 'center',
          border: '1px solid #ffcdd2', background: '#ffebee', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#c62828', marginBottom: '6px' }}>
            {targetChannel} 通道相关分析不可用
          </div>
          <div style={{ fontSize: '12px', color: '#b71c1c', marginBottom: '14px' }}>
            原因：{reason}。当前通道没有可展示的相关性结论。
          </div>
          {!correlationFromPlayback && (
            <button
              onClick={requestRefresh}
              style={{
                padding: '8px 20px', fontSize: '13px', borderRadius: '8px',
                border: 'none', background: '#c62828', color: '#fff', cursor: 'pointer', fontWeight: 600,
              }}
            >
              ↻ 重新计算
            </button>
          )}
        </div>
      </div>
    );
  }

  // 结果为空
  if (correlationData.status === 'empty') {
    return (
      <div style={cardStyle}>
        {header}
        <FilterBar />
        <div style={{
          padding: '28px 16px', textAlign: 'center',
          border: '1px solid #ffe082', background: '#fff8e1', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#8d6e00', marginBottom: '6px' }}>
            相关分析结果为空
          </div>
          <div style={{ fontSize: '12px', color: '#8d6e00' }}>
            原因：{correlationData.reasonLabel || reasonLabelFor(correlationData.reasonCode, '没有可对比的通道')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {header}
      {detailChannel && detailAvailable ? (
        <DetailView data={correlationData} peerChannel={detailChannel} />
      ) : (
        <CorrelationListView data={correlationData} />
      )}
    </div>
  );
};
