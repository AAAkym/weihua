"""从系统的结构化脱敏数据生成可阅读案例库，不进入可公开的 knowledge 目录。"""
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
OUTPUT = DATA / '历史变更案例库.md'
PLAN_FIELDS = ('梁盒班组', '大车班组', '小车班组', '小车接线', '电气班组', '电气进度', '主梁下料班组', '端梁下料班组',
               '车架下料班组', '大车涂装班', '小车涂装班', '电气涂装班',
               '预派梁盒班组', '预派大车班组', '预派小车班组', '预派电气班组')


def quote(value):
    if value is None or str(value).strip() == '':
        return '> （源数据为空）'
    text = re.sub(r'(?i)<br\s*/?>', '\n', str(value)).strip()
    return '\n'.join('> ' + line for line in text.splitlines())


def main():
    records = json.loads((DATA/'history-demo.json').read_text(encoding='utf8'))['records']
    training = json.loads((DATA/'historical-cases-train.json').read_text(encoding='utf8'))['cases']
    testing = json.loads((DATA/'historical-cases-test.json').read_text(encoding='utf8'))['cases']
    case_split = {c['caseId']: '历史检索库' for c in training}
    assert not set(case_split) & {c['caseId'] for c in testing}
    case_split.update({c['caseId']: '留出评估集，不供线上检索' for c in testing})
    lines = [
        '# 历史变更案例库（脱敏演示资料）', '',
        '本案例库根据脱敏工作簿重建，用于阅读与核对，不是原始变更通知书，也不是实时生产数据。',
        'Agent 使用同源结构化历史案例检索索引，不直接读取本 Markdown；导入案例不是模型权重训练。',
        '训练侧索引仅包含有变更文字及历史正例的记录，评估集不得被线上检索。同订单、同源文件及重复文本需按检索策略排除。',
        '本脚本将“待更改”“已更改”映射为历史正例；使用自有数据前须核实该假设。“已更改”不代表现在需要重复下发。',
        '用户指出：“无需更改”是人为错误状态，不作为负例，也不自动作为正例；其他历史状态暂不构成正负判断。历史班组信息不是当前现场状态，最终由人工审核。',
        '原始资料中的部分客户或规格文字存在差异，下面保留待核对标记；自由文本仍需对外分享前人工复核。',
        '本文件位于服务端 data 目录，不应加入 public 或常规知识检索目录。', '',
        f'案例分节：{len(records)}；源记录：{sum(len(r["changes"]) for r in records)}。', ''
    ]
    ids = set()
    for record in records:
        order, source, derived = record['orderId'], record['sourceFileId'], record['fileId']
        assert re.fullmatch(r'ORD-\d+', order) and re.fullmatch(r'DOC-\d+', source)
        lines.extend([f'## {order} / {source}', '', f'- 订单代号：{order}', f'- 源文件代号：{source}',
                      f'- 演示文件代号：{derived}', f'- 原始文字差异待核对：{"是" if record.get("differenceFlag") else "否"}',
                      f'- 源记录数：{len(record["changes"])}', '', '### 生产计划班组字段', ''])
        plan = record.get('planFields') or {}
        for name in PLAN_FIELDS:
            value = plan.get(name)
            lines.append(f'- {name}：{str(value).strip() if value is not None and str(value).strip() else "（源数据为空）"}')
        for item in record['changes']:
            rid = item['recordId']
            assert rid not in ids
            ids.add(rid)
            lines.extend(['', f'### 变更记录 {rid}', '', f'- 历史索引分组：{case_split.get(rid, "未进入历史检索或留出评估（缺变更文字或历史正例）")}',
                          '', '**变更前**', '', quote(item.get('before')), '', '**变更后**', '', quote(item.get('after')),
                          '', '**变更原因**', '', quote(item.get('reason'))])
            teams = [t for t in record.get('teams', []) if rid in t.get('sourceRecordIds', [])]
            for label, statuses in [('用户确认的正确历史对应（待更改、已更改）', {'待更改','已更改'}),
                                    ('人为错误状态：无需更改（不作对应判断）', {'无需更改'}),
                                    ('其他历史状态（不作正负判断）', None)]:
                entries = [t for t in teams if t['historicalStatus'] in statuses] if statuses else [t for t in teams if t['historicalStatus'] not in {'待更改','已更改','无需更改'}]
                lines.extend(['', f'**{label}**', ''])
                if entries:
                    lines.extend(f'- {t["name"]}（{t["historicalStatus"]}）' for t in entries)
                else:
                    lines.append('（该记录无此类已记录班组）')
        lines.append('')
    assert len(records) == 895 and len(ids) == 899
    assert len({(r['orderId'],r['sourceFileId']) for r in records}) == len(records)
    assert set(case_split) <= ids
    text = '\n'.join(lines).rstrip()+'\n'
    checks = {
        '原销售订单号': r'(?<!\d)200\d{7}(?:-\d+)*',
        '原文件编号': r'(?i)(?<![A-Za-z0-9])JS\d{6}(?![A-Za-z0-9])',
        '手机号码': r'(?<!\d)1[3-9]\d{9}(?!\d)',
        '已识别采购号': r'(?<!\d)23\d{8}(?!\d)',
        '已识别PG编号': r'(?i)(?<![A-Za-z0-9])PG\d{4,}(?![A-Za-z0-9])',
        '邮箱': r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',
    }
    for label, pattern in checks.items():
        if re.search(pattern, text): raise ValueError(f'发现{label}模式，停止生成，请复核。')
    OUTPUT.write_text(text, encoding='utf8')
    print(json.dumps({'sections':len(records),'sourceRecords':len(ids),'trainingCases':len(training),'holdoutCases':len(testing),
                      'multiRecordSections':sum(len(r['changes'])>1 for r in records), 'sensitivePatternMatches':0,
                      'bytes':OUTPUT.stat().st_size},ensure_ascii=False))


if __name__ == '__main__': main()
