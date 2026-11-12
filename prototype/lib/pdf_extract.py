"""Extract actual PDF text and, for scanned pages, render images for vision models."""
import base64
import json
import sys

try:
    import fitz
except ImportError:
    print(json.dumps({'error': 'PDF 解析依赖 PyMuPDF 未安装'}))
    sys.exit(1)

try:
    doc = fitz.open(sys.argv[1])
    if len(doc) > 12:
        raise ValueError('演示版最多处理 12 页 PDF，请先拆分文件。')
    pages = []
    for index, page in enumerate(doc):
        content = page.get_text('text').strip()
        item = {'page': index + 1, 'text': content}
        if len(content) < 30:
            pix = page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False)
            item['png'] = base64.b64encode(pix.tobytes('png')).decode('ascii')
        pages.append(item)
    print(json.dumps({'pages': pages}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'error': str(exc)}, ensure_ascii=False))
    sys.exit(1)
