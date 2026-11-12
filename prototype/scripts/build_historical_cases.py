"""从脱敏工作簿构建历史案例，隔离评估集；不会训练或修改模型权重。"""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / 'outputs' / '脱敏数据' / '生产计划与变更记录_脱敏初稿.xlsx'
STATUS_PATTERN = re.compile(r'([^,，\n()（）]+)[（(]([^()（）]+)[)）]')


def normalize_text(value):
    value = str(value or '').strip()
    value = re.sub(r'\b(?:ORD|DOC|REC)-\d+\b', '[代号]', value, flags=re.I)
    return re.sub(r'\s+', '', value)


def text_key(before, after):
    combined = normalize_text(before) + '\n' + normalize_text(after)
    # 空白和极短文本没有足够区分度，不使用它们将整库合并成一组。
    return combined if len(combined.replace('\n', '')) >= 12 else ''


def text_keys(before, after):
    keys = set()
    pair = text_key(before, after)
    if pair: keys.add('pair:' + pair)
    # 较长的单侧变更文本重复也视为同组，短的通用词不做合并。
    for value in (before, after):
        item = normalize_text(value)
        if len(item) >= 24: keys.add('single:' + item)
    return keys


class DisjointSet:
    def __init__(self): self.parents = {}
    def find(self, x):
        self.parents.setdefault(x, x)
        if self.parents[x] != x: self.parents[x] = self.find(self.parents[x])
        return self.parents[x]
    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b: self.parents[b] = a


def build(source, train_path, test_path, report_path):
    sheet = openpyxl.load_workbook(source, read_only=True, data_only=True)['变更记录']
    iterator = sheet.iter_rows(values_only=True)
    header = next(iterator)
    rows = [dict(zip(header, row)) for row in iterator if row[0]]
    cases = []
    status_counts = collections.Counter()
    for row in rows:
        found = []
        for match in STATUS_PATTERN.finditer(str(row['班组名称及状态'] or '')):
            team, status = (v.strip() for v in match.groups())
            status_counts[status] += 1
            if team: found.append({'name': team, 'status': status})
        positives = [v for v in found if v['status'] in ('待更改', '已更改')]
        ambiguous = [v for v in found if v['status'] == '无需更改']
        before, after = str(row['变更前内容'] or '').strip(), str(row['变更后内容'] or '').strip()
        if not positives or not (before or after): continue
        cases.append({
            'caseId': row['变更记录代号'], 'orderId': row['订单代号'],
            'fileId': row['文件代号'], 'sourceFileId': row['文件代号'],
            'changeBefore': before, 'changeAfter': after,
            'positiveTeams': positives, 'needsReviewTeams': ambiguous,
            'dataReviewRequired': row['文字差异待核对'] == '是',
        })

    # All rows participate in partitioning, including rows not eligible for retrieval.
    # Otherwise an ineligible bridge between two documents could cause leakage.
    ds = DisjointSet()
    for row in rows:
        order, doc = 'order:' + str(row['订单代号']), 'file:' + str(row['文件代号'])
        ds.union(order, doc)
        for key in text_keys(row['变更前内容'], row['变更后内容']):
            ds.union(order, 'text:' + hashlib.sha256(key.encode()).hexdigest())
    groups = collections.defaultdict(list)
    for row in rows: groups[ds.find('order:' + str(row['订单代号']))].append(row)
    group_id_by_root = {}
    for group, members in groups.items():
        keys = sorted({str(r['订单代号']) for r in members} | {str(r['文件代号']) for r in members})
        group_id_by_root[group] = hashlib.sha256('\n'.join(keys).encode('utf8')).hexdigest()
    def split(order):
        group = ds.find('order:' + str(order))
        return 'test' if int(group_id_by_root[group][:8], 16) % 5 == 0 else 'train'
    train = [case for case in cases if split(case['orderId']) == 'train']
    test = [case for case in cases if split(case['orderId']) == 'test']
    for field in ('orderId', 'fileId'):
        assert not ({c[field] for c in train} & {c[field] for c in test}), field
    assert not (set().union(*(text_keys(c['changeBefore'], c['changeAfter']) for c in train)) & set().union(*(text_keys(c['changeBefore'], c['changeAfter']) for c in test))), 'content'
    common = {'version': 1, 'provenance': '历史变更记录；标签含义必须由数据使用者逐项核验',
              'labelPolicy': '本脚本将待更改、已更改映射为正例，需核实是否适用于输入数据；无需更改不自动视为正例或负例。历史状态不代表当前班组状态。'}
    for target, entries, kind in ((train_path, train, 'train'), (test_path, test, 'test')):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({**common, 'split': kind, 'cases': entries}, ensure_ascii=False, indent=2), encoding='utf8')
    report = {'inputRows': len(rows), 'eligibleCases': len(cases), 'statusMentions': dict(status_counts),
              'groups': len(groups), 'trainCases': len(train), 'testCases': len(test),
              'trainOrders': len({c['orderId'] for c in train}), 'testOrders': len({c['orderId'] for c in test}),
              'trainFiles': len({c['fileId'] for c in train}), 'testFiles': len({c['fileId'] for c in test}),
              'partitionMethod': '按订单、文件、完整变更文本和长度至少24字的单侧变更文本连通分组；按组 SHA-256 确定性分配约 20% 为评估集。',
              'limitations': '正确对应关系由用户确认，未进行独立业务抽检；精确文本隔离无法完全排除改写或语义相近造成的泄漏。'}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    result = build(args.source, ROOT/'data'/'historical-cases-train.json', ROOT/'data'/'historical-cases-test.json', ROOT/'data'/'historical-cases-report.json')
    print(json.dumps(result, ensure_ascii=False, indent=2))
