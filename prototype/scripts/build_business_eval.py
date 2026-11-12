"""Build a blind business-evaluation set and separate user-confirmed labels.

Read-only source, local JSON output. No model calls or fabricated reviews.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
OUTPUT = DATA / 'business-evaluation'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def normalize(value):
    value = re.sub(r'\b(?:ORD|DOC|REC)-\d+\b', '[代号]', str(value or ''), flags=re.I)
    return re.sub(r'\s+', '', value)


def text_keys(before, after):
    before, after = normalize(before), normalize(after)
    keys = set()
    if len(before + after) >= 12:
        keys.add('pair:' + before + '\n' + after)
    if len(before) >= 24:
        keys.add('single:' + before)
    if len(after) >= 24:
        keys.add('single:' + after)
    return keys


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def index_unique(items, key):
    result = {}
    for item in items:
        value = item.get(key)
        if not value or value in result:
            raise ValueError(f'{key} 缺失或重复: {value!r}')
        result[value] = item
    return result


def verify_split(train, holdout):
    index_unique(train, 'caseId')
    index_unique(holdout, 'caseId')
    for field in ('caseId', 'orderId', 'sourceFileId'):
        overlap = {x[field] for x in train} & {x[field] for x in holdout}
        if overlap:
            raise ValueError(f'训练/留出集合存在 {field} 重叠: {sorted(overlap)[:3]}')
    def all_keys(rows):
        return set().union(*(text_keys(x.get('changeBefore'), x.get('changeAfter')) for x in rows))
    if all_keys(train) & all_keys(holdout):
        raise ValueError('训练/留出集合存在重复变更文本')


def build():
    history = load(DATA / 'history-demo.json')['records']
    confirmed = index_unique(load(DATA / 'confirmed-correspondence.json')['records'], 'recordId')
    train = load(DATA / 'historical-cases-train.json')['cases']
    holdout = load(DATA / 'historical-cases-test.json')['cases']
    verify_split(train, holdout)
    by_source = {}
    for record in history:
        for change in record['changes']:
            cid = change['recordId']
            if cid in by_source:
                raise ValueError('历史源记录代号重复: ' + cid)
            by_source[cid] = (record, change)

    blind, gold = [], []
    for case in sorted(holdout, key=lambda x: x['caseId']):
        cid = case['caseId']
        if cid not in by_source or cid not in confirmed:
            raise ValueError('留出样本缺少源记录或已确认对应: ' + cid)
        record, change = by_source[cid]
        fact = confirmed[cid]
        if not (case['orderId'] == record['orderId'] == fact['orderId'] and
                case['sourceFileId'] == record['sourceFileId'] == fact['sourceFileId'] and
                record['fileId'] == fact['fileId'] and
                str(case.get('changeBefore') or '').strip() == str(change.get('before') or '').strip() and
                str(case.get('changeAfter') or '').strip() == str(change.get('after') or '').strip()):
            raise ValueError('留出样本与源记录不一致: ' + cid)
        candidates = [x['name'] for x in record['teams'] if cid in x.get('sourceRecordIds', [])]
        if not candidates or len(set(candidates)) != len(candidates):
            raise ValueError('候选班组为空或重复: ' + cid)
        labels = {x['name'] for x in fact['confirmedTeams']}
        if not labels or not labels.issubset(set(candidates)):
            raise ValueError('用户确认对应未包含于候选班组: ' + cid)
        if labels != {x['name'] for x in case['positiveTeams']}:
            raise ValueError('留出集正例与用户确认的源记录不一致: ' + cid)
        blind.append({
            'caseId': cid, 'orderId': record['orderId'], 'sourceFileId': record['sourceFileId'],
            'fileId': record['fileId'], 'changeBefore': change.get('before'),
            'changeAfter': change.get('after'), 'changeReason': change.get('reason'),
            'candidateTeams': candidates, 'productionPlan': record['planFields'],
            'dataReviewRequired': bool(record.get('differenceFlag')),
        })
        gold.append({
            'caseId': cid,
            'review': {'state': 'pending', 'reviewer': None, 'reviewedAt': None, 'notes': None},
            'labels': [{'team': name, 'label': 'required' if name in labels else 'unknown',
                        'source': '用户确认的历史对应' if name in labels else None} for name in candidates],
        })

    version = digest({'blindCases': blind, 'trainingCases': train})
    common = {'schemaVersion': 1, 'datasetVersion': version}
    blind_doc = {**common, 'mode': 'independent_analysis', 'cases': blind}
    gold_doc = {**common, 'description': '用户确认的历史正确班组为 required；其他候选一律为 unknown。未知不是不相关。', 'cases': gold}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    label_path = OUTPUT/'labels.private.json'
    if label_path.exists() and load(label_path).get('datasetVersion') != version:
        raise ValueError('评估集版本已变化：原有标签文件需要人工迁移，未覆盖。')
    (OUTPUT/'blind-input.json').write_text(json.dumps(blind_doc, ensure_ascii=False, indent=2), encoding='utf-8')
    if not label_path.exists():
        label_path.write_text(json.dumps(gold_doc, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'caseCount': len(blind), 'trainingCaseCount': len(train), 'datasetVersion': version,
                      'fullyReviewedCases': 0, 'negativeLabels': 0, 'output': str(OUTPUT)}, ensure_ascii=False))


if __name__ == '__main__':
    build()
