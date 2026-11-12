"""Render an order-scoped change preview from anonymized report data."""
import html
import io
import json
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer

data = json.load(sys.stdin)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
title = ParagraphStyle('TitleCN', fontName='STSong-Light', fontSize=17, leading=24, alignment=TA_CENTER, textColor=colors.HexColor('#163B59'), spaceAfter=7)
subtitle = ParagraphStyle('SubtitleCN', fontName='STSong-Light', fontSize=9, leading=15, alignment=TA_CENTER, textColor=colors.HexColor('#526778'), spaceAfter=12)
heading = ParagraphStyle('HeadingCN', fontName='STSong-Light', fontSize=11, leading=17, textColor=colors.HexColor('#163B59'), spaceBefore=9, spaceAfter=4)
body = ParagraphStyle('BodyCN', fontName='STSong-Light', fontSize=10, leading=16, wordWrap='CJK', spaceAfter=5, splitLongWords=1)

def paragraph(value, style=body):
    text = '' if value is None else str(value)
    text = re.sub(r'(?i)<br\s*/?>', '\n', text).replace('\r\n', '\n')
    return Paragraph(html.escape(text or '原报表为空').replace('\n', '<br/>'), style)

story = [paragraph('生产变更内容预览', title),
         paragraph('依据脱敏历史报表重建，仅用于演示；非原始变更文件', subtitle),
         HRFlowable(width='100%', thickness=.6, color=colors.HexColor('#CAD7E1')),
         Spacer(1, 4 * mm), paragraph('订单代号：' + data['orderId']),
         paragraph('文件代号：' + data['fileId']),
         paragraph('规格型号：' + str(data.get('productType') or '原报表为空')),
         paragraph('下发时间：' + str(data.get('issuedAt') or '原报表为空'))]
for index, change in enumerate(data['changes'], 1):
    story.append(paragraph('变更记录 ' + str(index), heading))
    for label, key in [('变更前内容', 'before'), ('变更后内容', 'after'), ('变更原因', 'reason')]:
        story.append(paragraph(label + '：', heading))
        story.append(paragraph(change.get(key)))

def footer(canvas, doc):
    canvas.setFont('STSong-Light', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))
    canvas.drawString(18 * mm, 13 * mm, '脱敏历史报表重建，仅供演示，不是原始文件')
    canvas.drawRightString(A4[0] - 18 * mm, 13 * mm, str(doc.page))

output = io.BytesIO()
SimpleDocTemplate(output, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                  topMargin=18*mm, bottomMargin=20*mm,
                  title='生产变更内容预览').build(story, onFirstPage=footer, onLaterPages=footer)
sys.stdout.buffer.write(output.getvalue())
