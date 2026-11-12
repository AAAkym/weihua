"""Create fictional, text-based demonstration notices without business data."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'documents'
OUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))

DOCS = [
    ('DEMO-2026-001', 'DEMO-ORDER-001', '虚构桥式设备 A', [
        '端梁连接支架的孔位布置调整，以批准的演示图纸为准。',
        '小车限位器安装位置和演示接线图同步调整。',
    ]),
    ('DEMO-2026-002', 'DEMO-ORDER-002', '虚构门式设备 B', [
        '卷筒支座的演示焊接工艺调整，实际工艺应另行确认。',
        '卷筒安装孔位示意变更，具体参数以批准图纸为准。',
    ]),
    ('DEMO-2026-003', 'DEMO-ORDER-003', '虚构升降设备 C', [
        '控制柜演示接线号调整，并检查限位开关接口。',
        '立柱安装板的示意孔位及涂装交验顺序调整。',
    ]),
]

for file_id, order_id, product, changes in DOCS:
    output = OUT / f'{file_id}.pdf'
    doc = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    doc.setTitle('虚构演示通知单')
    doc.setAuthor('')
    doc.setFont('STSong-Light', 18)
    doc.drawString(55, 790, '生产变更通知单（虚构演示）')
    doc.setFillColor(colors.HexColor('#a02a32'))
    doc.setFont('STSong-Light', 10)
    doc.drawString(55, 765, '所有订单、客户、班组和变更内容均为虚构，不代表实际生产数据。')
    doc.setFillColor(colors.black)
    doc.setFont('STSong-Light', 11)
    lines = [f'文件编号：{file_id}', f'演示订单：{order_id}', f'产品：{product}', '客户：虚构演示客户', '', '变更内容：']
    lines += [f'{index}. {item}' for index, item in enumerate(changes, 1)]
    lines += ['', '注意：本文件仅用于软件功能演示，具体职责和下发对象均需人工核对。']
    text = doc.beginText(55, 730)
    text.setFont('STSong-Light', 11)
    text.setLeading(25)
    for line in lines:
        text.textLine(line)
    doc.drawText(text)
    doc.showPage()
    doc.save()
    print(output.name)
