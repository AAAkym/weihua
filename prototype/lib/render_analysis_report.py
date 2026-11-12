"""Render one on-demand analysis report from a server-supplied JSON payload."""
import io, json, sys, html
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether

payload = json.load(sys.stdin)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
style = getSampleStyleSheet()
style.add(ParagraphStyle(name='TitleCN', fontName='STSong-Light', fontSize=17, leading=24, alignment=TA_CENTER, spaceAfter=14))
style.add(ParagraphStyle(name='BodyCN', fontName='STSong-Light', fontSize=10, leading=16, wordWrap='CJK', spaceAfter=5))
style.add(ParagraphStyle(name='SmallCN', fontName='STSong-Light', fontSize=8.5, leading=13, wordWrap='CJK', spaceAfter=4, textColor=colors.HexColor('#4a5c6e')))
style.add(ParagraphStyle(name='HeadingCN', fontName='STSong-Light', fontSize=12, leading=18, textColor=colors.HexColor('#1e4e71'), spaceBefore=10, spaceAfter=6))

def esc(value):
    return html.escape(str(value if value not in (None, '') else '原报表为空')).replace('\n', '<br/>')

def paragraph(value):
    return Paragraph(esc(value), style['BodyCN'])

def small(value):
    return Paragraph(esc(value), style['SmallCN'])

replay = payload.get('mode') == 'historical_replay'
audit = payload.get('audit') or {}
story = [Paragraph('变更智达：生产变更分析报告', style['TitleCN']),
         paragraph('本报告依据本单已确认的对应关系整理下发建议，待人工审核。' if replay else '本报告为 AI 分析建议，待人工审核。'),
         paragraph('订单代号：' + payload['orderId']), paragraph('文件代号：' + payload['fileId']),
         paragraph('分析来源：' + payload['source']),
         small('数据版本：' + str(payload.get('datasetVersion') or '未提供') + '；规则版本：' + str(audit.get('rulesVersion') or '未提供') + '；提示词版本：' + str(audit.get('promptVersion') or '未提供')),
         paragraph('说明：本报告未包含人工在页面上后续调整的名单。')]
story.append(Paragraph('一、变更资料', style['HeadingCN']))
story.append(paragraph(payload['extractedText']))
story.append(Paragraph('二、生产作业计划依据', style['HeadingCN']))
plan_fields = payload.get('planFields') or {}
keys = ['规格型号（来自合同详情）', '计划交期', '生产状态', '梁盒班组', '大车班组', '小车班组', '小车接线', '电气班组', '主梁下料班组', '端梁下料班组', '车架下料班组', '大车涂装班', '小车涂装班', '电气涂装班']
for key in keys:
    value = str(plan_fields.get(key) or '未提供').replace('<br/>', '；').replace('<br>', '；')
    story.append(paragraph(key + '：' + value))

def evidence_lines(entry):
    detail = entry.get('evidenceDetail') or {}
    lines = [small('　　依据类型：' + str(detail.get('statusLabel') or '未提供') + '（' + str(detail.get('category') or '未分类') + '）')]
    change = detail.get('change') or {}
    lines.append(small('　　变更原文：' + (change.get('quote') or '无可回看的片段')))
    plan = detail.get('plan') or {}
    if plan:
        lines.append(small('　　计划字段：' + str(plan.get('field') or '') + ' = ' + str(plan.get('value') or '')))
    else:
        lines.append(small('　　计划字段：未找到指向该班组的字段'))
    if detail.get('historical'):
        lines.append(small('　　已确认对应：' + '、'.join(detail['historical'].get('recordIds') or [])))
    if detail.get('conflict'):
        lines.append(small('　　差异提示：' + detail['conflict']))
    if entry.get('modelReason') and entry.get('modelReason') != entry.get('reason'):
        lines.append(small('　　AI 原始理由（已被规则改为待确认）：' + entry['modelReason']))
    return lines

story.append(Paragraph('三、AI 建议与待确认', style['HeadingCN']))
for label, key in [('建议下发', 'dispatch'), ('待确认', 'review'), ('建议不下发', 'hold')]:
    entries = payload['plan'].get(key) or []
    story.append(paragraph(label + '：' + (str(len(entries)) + ' 个班组' if entries else '无')))
    for entry in entries:
        story.append(KeepTogether([paragraph('  ' + entry.get('name', '') + '；理由：' + entry.get('reason', '') + '；依据：' + entry.get('evidence', ''))] + evidence_lines(entry)))
story.append(Paragraph('四、核验说明', style['HeadingCN']))
story.append(paragraph('模型分析可能有误；请核对变更资料、班组职责与生产计划。证据只表示文字可在指定来源中找到，不代表业务含义已经确认；信息不足或计划字段缺失的事项需要人工确认。'))
if payload.get('evidenceDowngraded'):
    story.append(paragraph('本次有 ' + str(payload['evidenceDowngraded']) + ' 个班组因缺少可回看依据，已列为待确认。'))
if payload.get('differenceFlag'):
    story.append(paragraph('该订单存在客户或规格文字差异，仍待业务核对。'))

def footer(canvas, doc):
    canvas.setFont('STSong-Light', 8)
    canvas.setFillColor(colors.HexColor('#687b8a'))
    canvas.drawString(18 * mm, 12 * mm, 'AI 建议待审核')
    canvas.drawRightString(192 * mm, 12 * mm, str(doc.page))

buf = io.BytesIO()
SimpleDocTemplate(buf, pagesize=(210*mm, 297*mm), rightMargin=18*mm, leftMargin=18*mm, topMargin=17*mm, bottomMargin=19*mm, title='变更智达：生产变更分析报告').build(story, onFirstPage=footer, onLaterPages=footer)
sys.stdout.buffer.write(buf.getvalue())
