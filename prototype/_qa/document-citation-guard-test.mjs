import assert from 'node:assert/strict';
import { guardDocumentClaims } from '../lib/document-citation-guard.mjs';

const pdf = '变更后内容：小车接线箱新增电容。';
assert.match(guardDocumentClaims('PDF 明确提出“本次建议下发演示电气乙组”。', pdf).text, /未通过原文核对/);
assert.match(guardDocumentClaims('PDF 显示应下发演示电气乙组。', pdf).text, /未通过原文核对/);
assert.equal(guardDocumentClaims('PDF 写明“小车接线箱新增电容”。', pdf).blocked, 0);
assert.equal(guardDocumentClaims('PDF 写明“小车接线箱新增电容”。', pdf, {pdfIsInput:false}).blocked, 1);
assert.equal(guardDocumentClaims('报表写明“小车接线箱新增电容”。', pdf, {pdfIsInput:false}).blocked, 0);
assert.equal(guardDocumentClaims('AI 建议下发演示电气甲组，需要人工审核。', pdf).blocked, 0);
console.log('文件引文校验通过：不存在引文和无引文断言被拦截；AI 建议分离');
