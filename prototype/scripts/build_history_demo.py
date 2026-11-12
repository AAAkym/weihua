"""Rebuild order-scoped demo PDFs exclusively from the anonymized workbook."""
import collections
import argparse
import hashlib
import html
import json
import re
from pathlib import Path

import openpyxl
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether

ROOT = Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--repair-list',help='Only regenerate the PDF file IDs listed in this privacy fix JSON')
args=parser.parse_args()
repair_ids=set(json.loads(Path(args.repair_list).read_text(encoding='utf8'))['fileIds']) if args.repair_list else None
BOOK = ROOT / 'outputs' / '脱敏数据' / '生产计划与变更记录_脱敏初稿.xlsx'
DATA = ROOT / 'prototype' / 'data'
PDFS = DATA / 'history-demo-pdfs'
PDFS.mkdir(parents=True, exist_ok=True)
wb = openpyxl.load_workbook(BOOK, read_only=True, data_only=True)
plan_rows = iter(wb['生产计划'].values)
plan_headers = list(next(plan_rows))
plans = {r[0]: dict(zip(plan_headers, r)) for r in plan_rows if r[0]}
change_rows = iter(wb['变更记录'].values)
headers = list(next(change_rows))
groups = collections.OrderedDict()
row_count = 0
for row in change_rows:
    record = dict(zip(headers, row))
    order, doc = record['订单代号'], record['文件代号']
    if not order or not doc:
        raise ValueError('Unexpected blank order or document ID in anonymized workbook')
    if order not in plans:
        raise ValueError(f'No production plan for {order}')
    groups.setdefault((order, doc), []).append(record)
    row_count += 1

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
styles = getSampleStyleSheet()
title = ParagraphStyle('TitleCN', parent=styles['Title'], fontName='STSong-Light', fontSize=17, leading=24, textColor=colors.HexColor('#163B59'), alignment=TA_CENTER, spaceAfter=8)
sub = ParagraphStyle('SubCN', parent=styles['Normal'], fontName='STSong-Light', fontSize=9, leading=15, textColor=colors.HexColor('#526778'), alignment=TA_CENTER, spaceAfter=14)
head = ParagraphStyle('HeadCN', parent=styles['Normal'], fontName='STSong-Light', fontSize=11, leading=17, textColor=colors.HexColor('#163B59'), spaceBefore=9, spaceAfter=4)
body = ParagraphStyle('BodyCN', parent=styles['Normal'], fontName='STSong-Light', fontSize=10, leading=16, wordWrap='CJK', spaceAfter=5, splitLongWords=1)

def plain(value):
    return '' if value is None else str(value)

def paragraph(value, style=body):
    value = plain(value).replace('<br/>', '\n').replace('<br>', '\n').replace('\r\n', '\n')
    value = html.escape(value).replace('\n', '<br/>')
    return Paragraph(value or '原记录为空', style)

def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('STSong-Light', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))
    canvas.drawString(18*mm, 13*mm, '由脱敏报表重建，仅用于演示；非原始变更单')
    canvas.drawRightString(A4[0]-18*mm, 13*mm, f'{doc.page}')
    canvas.restoreState()

records = []
for (order, doc), items in groups.items():
    plan = plans[order]
    file_id = f'{doc}_{order}'
    filename = f'{file_id}.pdf'
    changes = []
    team_map = collections.OrderedDict()
    for item in items:
        change = {'before':item['变更前内容'], 'after':item['变更后内容'], 'reason':item['变更原因'],
                  'recordId':item['变更记录代号'], 'issuedAt':item['下发时间']}
        changes.append(change)
        for token in re.split(r'[,，\n]+', plain(item['班组名称及状态'])):
            token = token.strip()
            if not token:
                continue
            matched = re.fullmatch(r'(.+?)[(（]([^()（）]+)[)）]', token)
            if not matched:
                raise ValueError(f'Unparsed historical team status {item["变更记录代号"]}: {token}')
            name, status = matched.group(1).strip(), matched.group(2).strip()
            key = (name, status)
            if key not in team_map:
                team_map[key] = {'id':'TEAM-'+hashlib.sha256(name.encode('utf8')).hexdigest()[:10], 'name':name, 'historicalStatus':status, 'sourceRecordIds':[]}
            team_map[key]['sourceRecordIds'].append(item['变更记录代号'])
    record = {'orderId':order, 'fileId':file_id, 'sourceFileId':doc, 'filename':filename,
              'productType':items[0]['规格型号'], 'category':plan.get('产品型号'), 'issuedAt':items[0]['下发时间'],
              'planFields':plan, 'teams':list(team_map.values()), 'changes':changes,
              'differenceFlag':any(i['文字差异待核对']=='是' for i in items),
              'missingChangeContent':all(not plain(c['before']).strip() and not plain(c['after']).strip() for c in changes)}
    records.append(record)
    story = [paragraph('生产变更记录（演示重建）',title), paragraph('依据脱敏报表重建，仅用于系统演示；并非原始 PDF',sub),
             HRFlowable(width='100%',thickness=0.6,color=colors.HexColor('#CAD7E1')), Spacer(1,4*mm),
             paragraph('订单代号：'+order), paragraph('文件代号：'+doc),
             paragraph('规格型号：'+plain(items[0]['规格型号'])),
             paragraph('下发时间：'+plain(items[0]['下发时间'])), Spacer(1,2*mm)]
    for idx, item in enumerate(changes,1):
        story.append(paragraph(f'变更记录 {idx}',head))
        for label,key in [('变更前内容','before'),('变更后内容','after'),('变更原因','reason')]:
            story.append(paragraph(label+'：',head))
            story.append(paragraph(item[key]))
    if repair_ids is None or file_id in repair_ids:
        doc_obj=SimpleDocTemplate(str(PDFS/filename),pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=18*mm,bottomMargin=20*mm,title='脱敏变更记录演示',author='')
        doc_obj.build(story,onFirstPage=page_footer,onLaterPages=page_footer)

out = {'version':1,'source':'脱敏报表重建，非原始 PDF', 'records':records}
(DATA/'history-demo.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
assert len(records)==len(groups) and sum(len(r['changes']) for r in records)==row_count
print(json.dumps({'sourceRows':row_count,'orders':len(plans),'documents':len(records),
                  'noContentDocuments':sum(r['missingChangeContent'] for r in records),
                  'differenceDocuments':sum(r['differenceFlag'] for r in records)},ensure_ascii=False))
