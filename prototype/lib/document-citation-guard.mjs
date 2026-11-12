const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');

// This checks literal quotations only; it is not a semantic or business validator.
export function guardDocumentClaims(reply, pdfText, { pdfIsInput = true } = {}) {
  const pdf = normalize(pdfText);
  const source = /PDF|原文件|原文|变更文件|通知单|文件内容|文档内容|报表|变更资料/i;
  const attribution = /明确|写|标注|提出|包含|列出|要求|显示|提到|提及|记载|说明|指出|载明|建议下发|负责/;
  let blocked = 0;
  const output = String(reply || '').split(/(?<=[。！？!?\n])/u).map(part => {
    if (!source.test(part) || !attribution.test(part)) return part;
    const quotes = [...part.matchAll(/[“「『"']([^”」』"']{2,})[”」』"']/g)].map(match => normalize(match[1]));
    if (!(!pdfIsInput && /PDF/i.test(part)) && quotes.length && quotes.every(quote => pdf.includes(quote))) return part;
    blocked++;
    return '涉及资料内容的说法未通过原文核对，请核实变更资料。';
  }).join('');
  return { text: output, blocked };
}
