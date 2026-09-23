"""验证相关分析在失败 / 为空 / 相干性缺失场景下能给出明确原因。"""
import os
import sys
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np
from app.services.eeg_processor import compute_correlation, CHANNELS, SAMPLE_RATE


def make_data(target='Fp1', n=256):
    rng = np.random.default_rng(42)
    t = np.arange(n) / SAMPLE_RATE
    data = {}
    for ch in CHANNELS:
        if ch == target:
            data[ch] = (0.5 * np.sin(2 * np.pi * 10 * t) + 0.1 * rng.standard_normal(n)).tolist()
        else:
            data[ch] = (0.4 * np.sin(2 * np.pi * (9 + rng.random() * 3) * t)
                        + 0.2 * rng.standard_normal(n)).tolist()
    return data


def test_ok_normal():
    data = make_data()
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] == 'ok', res
    assert res['targetChannel'] == 'Fp1'
    assert 'computedAt' in res
    peers = [c for c in res['correlations'] if c['channel'] != 'Fp1']
    assert len(peers) == 9
    for c in peers:
        assert c['correlation'] is not None
        assert -1 <= c['correlation'] <= 1
        assert c['coherence'] is not None
        assert 0 <= c['coherence'] <= 1


def test_target_missing():
    data = make_data()
    res = compute_correlation('X9', data, SAMPLE_RATE)
    assert res['status'] == 'error'
    assert res['reasonCode'] == 'TARGET_MISSING'
    assert res['correlations'] == []


def test_target_constant():
    data = make_data()
    data['Fp1'] = [0.3] * 256
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] == 'error'
    assert res['reasonCode'] == 'TARGET_CONSTANT'


def test_target_insufficient():
    data = make_data()
    data['Fp1'] = [0.1]
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] == 'error'
    assert res['reasonCode'] == 'INSUFFICIENT_SAMPLES'


def test_peer_constant_empty():
    data = make_data()
    for ch in CHANNELS:
        if ch != 'Fp1':
            data[ch] = [0.0] * 256
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] == 'empty'
    assert res['reasonCode'] == 'NO_VALID_PEERS'
    # 每个无效条目都要有原因
    bad = [c for c in res['correlations'] if c['channel'] != 'Fp1']
    assert all(c['correlation'] is None for c in bad)
    assert all(c.get('reasonLabel') for c in bad)


def test_peer_length_mismatch_keeps_others():
    data = make_data()
    data['F3'] = data['F3'][:100]
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] == 'ok'  # 其他通道仍有效
    f3 = next(c for c in res['correlations'] if c['channel'] == 'F3')
    assert f3['correlation'] is None
    assert f3['reasonCode'] == 'LENGTH_MISMATCH'


def test_coherence_missing_but_correlation_kept():
    """极短样本：相关系数可算，相干性应标注缺失而不是拖垮整条结果。"""
    data = make_data(n=4)
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    assert res['status'] in ('ok', 'empty')
    peers = [c for c in res['correlations'] if c['channel'] != 'Fp1']
    for c in peers:
        if c['correlation'] is not None:
            # 样本远不足以做相干性
            assert c['coherence'] is None
            assert c['reasonCode'].startswith('COHERENCE_')
            assert c.get('reasonLabel')


def test_peer_missing_key():
    data = make_data()
    del data['O2']
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    o2 = next(c for c in res['correlations'] if c['channel'] == 'O2')
    assert o2['correlation'] is None
    assert o2['reasonCode'] == 'PEER_MISSING'
    # 其余通道正常 → 整体仍 ok
    assert res['status'] == 'ok'


def test_self_entry_is_one():
    data = make_data()
    res = compute_correlation('Fp1', data, SAMPLE_RATE)
    self_entry = next(c for c in res['correlations'] if c['channel'] == 'Fp1')
    assert self_entry['correlation'] == 1.0
    assert self_entry['coherence'] == 1.0


if __name__ == '__main__':
    fns = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for fn in fns:
        fn()
        print(f'PASS {fn.__name__}')
    print(f'\n{len(fns)} tests passed')
