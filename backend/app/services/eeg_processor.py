import numpy as np
from scipy import signal

CHANNELS = ['Fp1','Fp2','F3','F4','C3','C4','P3','P4','O1','O2']
SAMPLE_RATE = 256
BANDS = {'delta': (0.5,4), 'theta': (4,8), 'alpha': (8,13), 'beta': (13,30), 'gamma': (30,100)}

def generate_mock_eeg(duration_sec: float = 5.0) -> dict:
    t = np.linspace(0, duration_sec, int(SAMPLE_RATE * duration_sec))
    data = {}
    for ch in CHANNELS:
        sig = 0.5*np.sin(2*np.pi*10*t) + 0.3*np.sin(2*np.pi*20*t) + 0.2*np.random.randn(len(t))
        data[ch] = sig.tolist()
    return {'channels': CHANNELS, 'sample_rate': SAMPLE_RATE, 'data': data, 'time': t.tolist(), 'duration': duration_sec}

def compute_band_power(channel_data: list, sample_rate: int) -> dict:
    freqs, psd = signal.welch(channel_data, fs=sample_rate, nperseg=256)
    result = {}
    for name, (low, high) in BANDS.items():
        mask = (freqs >= low) & (freqs <= high)
        result[name] = float(np.trapz(psd[mask], freqs[mask])) if mask.any() else 0.0
    return result

def compute_spectrogram(channel_data: list, sample_rate: int) -> dict:
    f, t, Sxx = signal.spectrogram(channel_data, fs=sample_rate, nperseg=128, noverlap=64)
    return {'frequencies': f.tolist(), 'time': t.tolist(), 'power': (10*np.log10(Sxx+1e-10)).tolist()}

def compute_brain_state(channel_data: list, sample_rate: int) -> dict:
    import time
    bands = compute_band_power(channel_data, sample_rate)
    total = sum(bands.values()) + 1e-10
    beta_rel = bands['beta'] / total
    alpha_rel = bands['alpha'] / total
    theta_rel = bands['theta'] / total
    focus = min(100.0, max(0.0, (beta_rel * 300) + np.random.uniform(-5, 5)))
    relaxation = min(100.0, max(0.0, (alpha_rel * 300) + np.random.uniform(-5, 5)))
    fatigue = min(100.0, max(0.0, (theta_rel * 300) + np.random.uniform(-5, 5)))
    scores = {'focused': focus, 'relaxed': relaxation, 'fatigued': fatigue}
    max_score = max(scores.values())
    if max_score < 50:
        status = 'neutral'
        status_label = '平稳'
        status_color = '#757575'
    else:
        status = max(scores, key=scores.get)
        if status == 'focused':
            status_label = '专注'
            status_color = '#1976d2'
        elif status == 'relaxed':
            status_label = '放松'
            status_color = '#388e3c'
        else:
            status_label = '疲劳'
            status_color = '#d32f2f'
    return {
        'focus': round(focus, 1),
        'relaxation': round(relaxation, 1),
        'fatigue': round(fatigue, 1),
        'status': status,
        'statusLabel': status_label,
        'statusColor': status_color,
        'timestamp': int(time.time() * 1000)
    }

def compute_correlation(target_channel: str, all_data: dict, sample_rate: int) -> dict:
    if target_channel not in all_data:
        return {
            'targetChannel': target_channel,
            'correlations': [],
            'error': {
                'reason': 'compute_failed',
                'message': f'目标通道 {target_channel} 不存在，无法计算通道相关性。'
            }
        }
    target_data = np.array(all_data[target_channel], dtype=float)
    correlations = []
    for ch in CHANNELS:
        if ch == target_channel:
            correlations.append({
                'channel': ch,
                'targetChannel': target_channel,
                'correlation': 1.0,
                'coherence': 1.0
            })
            continue
        if ch not in all_data:
            # 通道数据缺失：相关性/相干性不可用，前端需明确说明而不是编造数值
            correlations.append({
                'channel': ch,
                'targetChannel': target_channel,
                'correlation': None,
                'coherence': None
            })
            continue
        ch_data = np.array(all_data[ch], dtype=float)

        corr = float(np.corrcoef(target_data, ch_data)[0, 1])
        corr = round(corr, 4) if np.isfinite(corr) else None

        coh_value = None
        try:
            f, coh = signal.coherence(target_data, ch_data, fs=sample_rate, nperseg=128)
            alpha_mask = (f >= 8) & (f <= 13)
            if alpha_mask.any():
                mean_coh = float(np.mean(coh[alpha_mask]))
                coh_value = round(mean_coh, 4) if np.isfinite(mean_coh) else None
        except Exception:
            coh_value = None

        correlations.append({
            'channel': ch,
            'targetChannel': target_channel,
            'correlation': corr,
            'coherence': coh_value
        })

    other = [c for c in correlations if c['channel'] != target_channel]
    valid = [c for c in other if c['correlation'] is not None]
    if not other:
        return {
            'targetChannel': target_channel,
            'correlations': correlations,
            'error': {
                'reason': 'empty_result',
                'message': '相关分析结果为空：没有其他通道可用于对比。'
            }
        }
    if not valid:
        return {
            'targetChannel': target_channel,
            'correlations': correlations,
            'error': {
                'reason': 'compute_failed',
                'message': '所有通道的相关系数均无法计算（信号长度不足或含无效值），请检查采集数据。'
            }
        }
    if all(c['coherence'] is None for c in other):
        return {
            'targetChannel': target_channel,
            'correlations': correlations,
            'error': {
                'reason': 'coherence_missing',
                'message': 'Alpha 相干性计算缺失（信号长度不足），相关性结果仍可使用。'
            }
        }
    return {'targetChannel': target_channel, 'correlations': correlations}
