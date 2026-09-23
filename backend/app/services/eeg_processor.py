import math
import time
import numpy as np
from scipy import signal

CHANNELS = ['Fp1','Fp2','F3','F4','C3','C4','P3','P4','O1','O2']
SAMPLE_RATE = 256
BANDS = {'delta': (0.5,4), 'theta': (4,8), 'alpha': (8,13), 'beta': (13,30), 'gamma': (30,100)}

# 相干性计算所需的最少样本数（需覆盖若干 Alpha 频段周期）
MIN_COHERENCE_SAMPLES = 8

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


def _is_finite(value) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _invalid_entry(ch: str, target_channel: str, reason_code: str, reason_label: str,
                   correlation=None, coherence=None) -> dict:
    return {
        'channel': ch,
        'targetChannel': target_channel,
        'correlation': correlation,
        'coherence': coherence,
        'reasonCode': reason_code,
        'reasonLabel': reason_label,
    }


def _peer_entry(ch: str, target_channel: str, target_data: np.ndarray,
                all_data: dict, sample_rate: int) -> dict:
    if ch == target_channel:
        return {
            'channel': ch,
            'targetChannel': target_channel,
            'correlation': 1.0,
            'coherence': 1.0,
        }

    raw = all_data.get(ch)
    if raw is None:
        return _invalid_entry(ch, target_channel, 'PEER_MISSING', '对比通道数据缺失')

    ch_data = np.asarray(raw, dtype=float)
    if ch_data.shape != target_data.shape:
        return _invalid_entry(ch, target_channel, 'LENGTH_MISMATCH', '两通道信号长度不一致，无法对比')
    if ch_data.size < 2 or np.allclose(ch_data, ch_data[0]):
        return _invalid_entry(ch, target_channel, 'PEER_CONSTANT', '对比通道信号恒定，方差为零')

    try:
        corr = float(np.corrcoef(target_data, ch_data)[0, 1])
    except Exception:
        return _invalid_entry(ch, target_channel, 'CORRELATION_FAILED', '相关系数计算失败')
    if not _is_finite(corr):
        return _invalid_entry(ch, target_channel, 'CORRELATION_INVALID', '相关系数计算结果无效（信号可能恒定）')

    # 相干性独立计算，失败/缺失不应影响已得到的相关系数
    coherence = None
    coh_reason_code = None
    coh_reason_label = None
    try:
        if ch_data.size < MIN_COHERENCE_SAMPLES:
            coh_reason_code = 'COHERENCE_INSUFFICIENT'
            coh_reason_label = '样本不足，无法计算相干性'
        else:
            nperseg = min(128, ch_data.size)
            f, coh = signal.coherence(target_data, ch_data, fs=sample_rate, nperseg=nperseg)
            alpha_mask = (f >= 8) & (f <= 13)
            if not alpha_mask.any():
                coh_reason_code = 'COHERENCE_NO_BAND'
                coh_reason_label = 'Alpha 频段无有效频点，相干性缺失'
            else:
                mean_coh = float(np.mean(coh[alpha_mask]))
                if _is_finite(mean_coh):
                    coherence = round(mean_coh, 4)
                else:
                    coh_reason_code = 'COHERENCE_INVALID'
                    coh_reason_label = '相干性计算结果无效'
    except Exception:
        coh_reason_code = 'COHERENCE_MISSING'
        coh_reason_label = '相干性计算失败'

    entry = {
        'channel': ch,
        'targetChannel': target_channel,
        'correlation': round(corr, 4),
        'coherence': coherence,
    }
    if coh_reason_code:
        entry['reasonCode'] = coh_reason_code
        entry['reasonLabel'] = coh_reason_label
    return entry


def compute_correlation(target_channel: str, all_data: dict, sample_rate: int) -> dict:
    """计算目标通道与其余通道的相关性 / Alpha 相干性。

    返回结构始终带 status:
      - ok:    至少存在一个有效对比通道（个别通道相干性缺失时在条目内标注原因）
      - empty: 结果集为空（所有对比通道均无效）
      - error: 目标通道本身无法计算（数据缺失、样本不足、信号恒定等）
    """
    result_base = {'targetChannel': target_channel, 'computedAt': int(time.time() * 1000)}

    if not isinstance(all_data, dict) or target_channel not in all_data or all_data[target_channel] is None:
        return {**result_base, 'status': 'error',
                'reasonCode': 'TARGET_MISSING', 'reasonLabel': '目标通道数据缺失，无法计算相关性',
                'correlations': []}

    target_data = np.asarray(all_data[target_channel], dtype=float)
    if target_data.ndim != 1 or target_data.size < 2:
        return {**result_base, 'status': 'error',
                'reasonCode': 'INSUFFICIENT_SAMPLES', 'reasonLabel': '目标通道样本不足，无法计算相关性',
                'correlations': []}
    if np.allclose(target_data, target_data[0]):
        return {**result_base, 'status': 'error',
                'reasonCode': 'TARGET_CONSTANT', 'reasonLabel': '目标通道信号恒定（方差为零），无法计算相关性',
                'correlations': []}

    correlations = [
        _peer_entry(ch, target_channel, target_data, all_data, sample_rate)
        for ch in CHANNELS
    ]

    valid_peers = [
        c for c in correlations
        if c['channel'] != target_channel and c.get('correlation') is not None
    ]
    if not valid_peers:
        return {**result_base, 'status': 'empty',
                'reasonCode': 'NO_VALID_PEERS', 'reasonLabel': '没有可与当前通道对比的有效通道',
                'correlations': correlations}

    return {**result_base, 'status': 'ok', 'correlations': correlations}
