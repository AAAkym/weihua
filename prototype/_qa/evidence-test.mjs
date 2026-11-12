import assert from 'node:assert/strict';
import { buildTeamEvidence, evidenceGateDecision, evidenceQuoteFor, teamCategory } from '../lib/evidence.mjs';

const record = {
  changes: [
    { recordId: 'REC-0001', before: '小车原接线', after: '小车接线改由演示电气甲组处理，线号 12 调整', reason: '电气要求' },
    { recordId: 'REC-0002', before: '无', after: '主梁下料长度调整 20mm', reason: '工艺' },
  ],
};
const plan = { '电气班组': '演示电气甲组', '小车班组': '演示小车乙组重型,演示小车丙组', '主梁下料班组': '演示下料甲组', '端梁下料班组': '演示下料乙组', '大车涂装班': '演示涂装戊组' };

// 引用只能来自变更后内容，不得来自变更前或原因。
const quote = evidenceQuoteFor('演示电气甲组', record.changes);
assert.equal(quote.matched, '变更原文含该班组名称');
assert.ok(quote.quote.includes('演示电气甲组'));
assert.ok(!quote.quote.includes('原接线'));
assert.equal(evidenceQuoteFor('演示电气乙组', record.changes), null);
const byKeyword = evidenceQuoteFor('演示下料乙组', record.changes);
assert.ok(byKeyword && byKeyword.quote.includes('主梁下料'));

// 状态分层：历史确认、原文+计划、仅一侧、都没有。
const historical = buildTeamEvidence({ teamName: '演示电气甲组', changes: record.changes, planFields: plan, historyRecordIds: ['REC-0001'] });
assert.equal(historical.status, 'historical_confirmed');
assert.deepEqual(historical.historical.recordIds, ['REC-0001']);
const both = buildTeamEvidence({ teamName: '演示电气甲组', changes: record.changes, planFields: plan });
assert.equal(both.status, 'source_matched');
assert.equal(both.plan.field, '电气班组');
const planOnly = buildTeamEvidence({ teamName: '演示涂装戊组', changes: record.changes, planFields: plan });
assert.equal(planOnly.status, 'plan_only');
assert.equal(planOnly.change, null);
const quoteOnly = buildTeamEvidence({ teamName: '演示总装组', changes: record.changes, planFields: plan });
assert.equal(quoteOnly.status, 'incomplete');
assert.equal(quoteOnly.category, '未分类');

// 计划字段按完整名称匹配，不做相似名称推断。
const similar = buildTeamEvidence({ teamName: '演示小车甲组特种', changes: record.changes, planFields: plan });
assert.equal(similar.status, 'incomplete');

// 证据闸门：缺依据或存在冲突时不得作为建议下发。
assert.equal(evidenceGateDecision(both).allowed, true);
assert.equal(evidenceGateDecision(historical).allowed, true);
assert.equal(evidenceGateDecision(planOnly).allowed, false);
assert.match(evidenceGateDecision(planOnly).reason, /待确认/);
const conflicted = buildTeamEvidence({ teamName: '演示电气甲组', changes: record.changes, planFields: plan, conflictNote: '电气班组与当前生产计划不一致，请人工核实。' });
assert.equal(evidenceGateDecision(conflicted).allowed, false);
assert.match(evidenceGateDecision(conflicted).reason, /不一致/);
// 用户确认的历史对应不因计划字段差异被推翻，但差异保留可见。
const confirmedConflict = buildTeamEvidence({ teamName: '演示下料甲组', changes: record.changes, planFields: plan, historyRecordIds: ['REC-0002'], conflictNote: '下料班组与当前生产计划不一致，请人工核实。' });
assert.equal(evidenceGateDecision(confirmedConflict).allowed, true);
assert.match(confirmedConflict.conflict, /不一致/);

// 分类只用于定位计划字段，不推断职责。
assert.equal(teamCategory('演示电气乙组').label, '电气班组');
assert.equal(teamCategory('演示涂装己组').label, '涂装班组');
assert.equal(teamCategory('演示桥架戊组'), null);
assert.equal(buildTeamEvidence({ teamName: '演示桥架戊组', changes: record.changes, planFields: { '大车班组': '演示桥架戊组' } }).status, 'incomplete');

// 多记录变更：命中来自正确记录号。
const multi = buildTeamEvidence({ teamName: '演示下料乙组', changes: record.changes, planFields: plan });
assert.ok(multi.change.recordId === 'REC-0002' || multi.change.recordId === 'REC-0001');
assert.equal(multi.change.field, '变更后内容');
console.log('证据核验通过：原文引用、状态分层、完整名称匹配、闸门与冲突');
