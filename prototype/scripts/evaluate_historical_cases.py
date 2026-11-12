"""检查离线划分和历史案例检索连通性；不是模型准确率评估。"""
import collections
import json
import re
from pathlib import Path

from build_historical_cases import text_keys

ROOT = Path(__file__).resolve().parents[1]


def tokens(s):
    s = re.sub(r'\b(?:ORD|DOC|REC)-\d+\b', ' ', s or '', flags=re.I).lower()
    words = re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]+', s)
    out = set()
    for word in words:
        if re.fullmatch(r'[\u4e00-\u9fff]+', word):
            out.update(word[i:i + 2] for i in range(max(1, len(word) - 1)))
        else:
            out.add(word)
    return out


def find(query, candidates, limit=3):
    source_keys = text_keys(query['changeBefore'], query['changeAfter'])
    q = tokens(query['changeBefore'] + ' ' + query['changeAfter'])
    scored = []
    for case in candidates:
        if case['orderId'] == query['orderId'] or case['sourceFileId'] == query['sourceFileId']:
            continue
        if source_keys & text_keys(case['changeBefore'], case['changeAfter']):
            continue
        t = tokens(case['changeBefore'] + ' ' + case['changeAfter'])
        score = len(q & t) / len(q | t) if q and t else 0
        if score: scored.append((score, case['caseId'], case))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [case for _, _, case in scored[:limit]]


def main():
    train = json.loads((ROOT/'data'/'historical-cases-train.json').read_text(encoding='utf8'))['cases']
    test = json.loads((ROOT/'data'/'historical-cases-test.json').read_text(encoding='utf8'))['cases']
    assert all(x['positiveTeams'] for x in train + test)
    assert all(p['status'] in ('待更改', '已更改') for x in train + test for p in x['positiveTeams'])
    assert all(p['status'] == '无需更改' for x in train + test for p in x['needsReviewTeams'])
    order_overlap = {x['orderId'] for x in train} & {x['orderId'] for x in test}
    source_overlap = {x['sourceFileId'] for x in train} & {x['sourceFileId'] for x in test}
    text_overlap = set().union(*(text_keys(x['changeBefore'], x['changeAfter']) for x in train)) & set().union(*(text_keys(x['changeBefore'], x['changeAfter']) for x in test))
    assert not order_overlap and not source_overlap and not text_overlap
    matched, overlap = 0, 0
    for case in test:
        found = find(case, train)
        matched += bool(found)
        expected = {t['name'] for t in case['positiveTeams']}
        suggested = {t['name'] for x in found for t in x['positiveTeams']}
        overlap += bool(expected & suggested)
        assert all(x['orderId'] != case['orderId'] and x['sourceFileId'] != case['sourceFileId'] for x in found)
    report = {
        'holdoutCases': len(test), 'trainingCases': len(train),
        'sameOrderOverlaps': len(order_overlap), 'sameSourceFileOverlaps': len(source_overlap),
        'sameNormalizedTextOverlaps': len(text_overlap),
        'casesWithAtLeastOneLexicalRetrieval': matched,
        'casesSharingHistoricalTeamWithTop3': overlap,
        'description': '该脚本仅检验划分及字符词面检索，班组重合仅是历史记录重合，不等于正确建议、准确率或模型评估。',
        'limitations': '历史标签不完整，正确对应关系由用户确认但未独立抽检；语义近似泄漏仍可能存在；该离线脚本未调用真实模型或系统Agent。'
    }
    (ROOT/'data'/'historical-retrieval-evaluation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__': main()
