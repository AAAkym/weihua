"""生成用户确认的历史班组对应数据；不改源数据，也不调用或修改 Agent。"""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
records = json.loads((DATA / 'history-demo.json').read_text(encoding='utf8'))['records']
rows = []
counts = collections.Counter()
case_ids = set()
for record in records:
    for change in record['changes']:
        case_id = change['recordId']
        if case_id in case_ids:
            raise ValueError('重复记录代号: ' + case_id)
        case_ids.add(case_id)
        confirmed, errors, other = [], [], []
        for team in record['teams']:
            if case_id not in team.get('sourceRecordIds', []):
                continue
            entry = {'name': team['name'], 'originalStatus': team['historicalStatus']}
            counts[entry['originalStatus']] += 1
            if entry['originalStatus'] in ('待更改', '已更改'):
                confirmed.append(entry)
            elif entry['originalStatus'] == '无需更改':
                errors.append(entry)
            else:
                other.append(entry)
        if len({x['name'] for x in confirmed + errors + other}) != len(confirmed + errors + other):
            raise ValueError('同一记录中的班组状态重复: ' + case_id)
        rows.append({
            'recordId': case_id, 'orderId': record['orderId'],
            'sourceFileId': record['sourceFileId'], 'fileId': record['fileId'],
            'confirmedTeams': confirmed, 'incorrectStatusTeams': errors, 'otherStatusTeams': other,
            'hasOriginalTeamData': bool(confirmed or errors or other),
        })

assert len(records) == 895 and len(rows) == len(case_ids) == 899
payload = {
    'version': 1,
    'description': '脱敏历史变更记录中的用户确认班组对应；每条源记录独立保留，非当前现场状态。',
    'policy': {
        '待更改': '用户确认的正确历史对应班组，保留原状态',
        '已更改': '用户确认的正确历史对应班组，保留原状态；不代表现在需要重复下发',
        '无需更改': '用户指出的人为错误状态，不作为负例，也不自动作为正例',
        '其他状态': '保留原始状态，不自行推断是否属于正确对应班组',
    },
    'records': rows,
}
(DATA / 'confirmed-correspondence.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf8')
report = {'recordCount': len(rows), 'distinctOrderFilePairs': len(records), 'statusCounts': dict(counts),
          'recordsWithConfirmedTeams': sum(bool(row['confirmedTeams']) for row in rows),
          'recordsWithoutTeamData': sum(not row['hasOriginalTeamData'] for row in rows)}
(DATA / 'confirmed-correspondence-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False))
