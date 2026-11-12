// 业务评估集：先只用盲态输入做预测，再读取标签算分，避免答案回到预测路径。
// 现在没有经人工复核的负例，因此误下发率与完整精确率不计算，只公布有分母的指标。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTeamReview } from '../lib/plan-team-guard.mjs';
import { buildTeamEvidence, evidenceGateDecision } from '../lib/evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalDir = path.join(root, 'data', 'business-evaluation');
const ALLOWED_CASE_KEYS = new Set(['caseId', 'orderId', 'sourceFileId', 'fileId', 'changeBefore', 'changeAfter', 'changeReason', 'candidateTeams', 'productionPlan', 'dataReviewRequired']);
const LABEL_FIELD_PATTERN = /positive|confirmed|label|answer|gold|expected/i;

function load(file) {
  const filePath = path.join(evalDir, file);
  if (!existsSync(filePath)) throw new Error(`缺少评估文件：${file}，请先运行 scripts/build_business_eval.py`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function verifyBlindPackaging(blind) {
  const problems = [];
  for (const item of blind.cases) {
    for (const key of Object.keys(item)) {
      if (!ALLOWED_CASE_KEYS.has(key)) problems.push(`${item.caseId} 含未预期的输入字段 ${key}`);
      if (LABEL_FIELD_PATTERN.test(key)) problems.push(`${item.caseId} 的输入字段 ${key} 疑似答案`);
    }
    if (!Array.isArray(item.candidateTeams) || !item.candidateTeams.length) problems.push(`${item.caseId} 缺少候选班组`);
    if (!item.productionPlan || typeof item.productionPlan !== 'object') problems.push(`${item.caseId} 缺少生产计划`);
  }
  const text = JSON.stringify(blind);
  if (/"label"\s*:/.test(text) || /"confirmedTeams"\s*:/.test(text)) problems.push('盲态输入中出现标签结构');
  return problems;
}

// 只用盲态输入做判断：可解释、无模型调用、可重复。
function predict(item) {
  const changes = [{
    recordId: item.caseId,
    before: item.changeBefore || '',
    after: item.changeAfter || '',
    reason: item.changeReason || '',
  }];
  const predictions = [];
  for (const team of item.candidateTeams) {
    const evidence = buildTeamEvidence({ teamName: team, changes, planFields: item.productionPlan });
    const conflict = planTeamReview(team, item.productionPlan || {}, { changes });
    const detailed = { ...evidence, conflict: conflict || evidence.conflict };
    const gate = evidenceGateDecision(detailed);
    const decision = gate.allowed ? 'dispatch' : 'review';
    predictions.push({ team, decision, reason: gate.allowed ? detailed.note : gate.reason, evidenceStatus: detailed.status });
  }
  return predictions;
}

function score(blind, labels) {
  const gold = new Map(labels.cases.map(item => [item.caseId, item]));
  const perCase = [];
  const totals = { required: 0, recalled: 0, dispatched: 0, candidates: 0, review: 0, requiredInReview: 0, requiredInHold: 0, reviewedNegatives: 0, falseDispatchOnReviewed: 0 };
  for (const item of blind.cases) {
    const label = gold.get(item.caseId);
    if (!label) throw new Error(`标签缺失：${item.caseId}`);
    const predicted = predict(item);
    const required = new Set(label.labels.filter(entry => entry.label === 'required').map(entry => entry.team));
    const unknown = new Set(label.labels.filter(entry => entry.label !== 'required').map(entry => entry.team));
    const dispatched = new Set(predicted.filter(entry => entry.decision === 'dispatch').map(entry => entry.team));
    const review = new Set(predicted.filter(entry => entry.decision === 'review').map(entry => entry.team));
    const missed = [...required].filter(team => !dispatched.has(team));
    const extra = [...dispatched].filter(team => !required.has(team));
    const unreviewedExtra = extra.filter(team => unknown.has(team));
    totals.required += required.size;
    totals.recalled += required.size - missed.length;
    totals.dispatched += dispatched.size;
    totals.candidates += predicted.length;
    totals.review += review.size;
    totals.requiredInReview += missed.filter(team => review.has(team)).length;
    totals.requiredInHold += missed.filter(team => !review.has(team)).length;
    totals.reviewedNegatives += 0;
    totals.falseDispatchOnReviewed += 0;
    perCase.push({
      caseId: item.caseId,
      required: [...required],
      dispatched: [...dispatched],
      missed,
      extraUnconfirmed: unreviewedExtra,
      reviewCount: review.size,
      candidateCount: predicted.length,
      // 未确认班组不是负例，不参与“整单正确”的判定；只记录供人工复核。
      exactMatch: missed.length === 0,
      predictions: predicted,
    });
  }
  const reviewedCases = labels.cases.filter(item => item.review && item.review.state !== 'pending').length;
  const metric = (name, numerator, denominator, note) => ({ name, numerator, denominator, value: denominator ? Number((numerator / denominator).toFixed(4)) : null, note });
  return {
    perCase,
    metrics: [
      metric('已确认班组召回', totals.recalled, totals.required, '分母为用户确认的历史正确班组数；未确认班组不计入负例。'),
      metric('漏下发率', totals.required - totals.recalled, totals.required, '漏下发 = 用户确认应有但未进入建议下发的班组；含列为待确认的漏项。'),
      metric('待确认比例', totals.review, totals.candidates, '分母为全部候选班组数；待确认不等于已确认不下发。'),
      metric('整单正确率', perCase.filter(item => item.exactMatch).length, perCase.length, '整单无漏项（已确认班组全部进入建议下发）的订单数占比；未确认班组不计为错误。'),
      metric('已复核负例中的误下发率', totals.falseDispatchOnReviewed, totals.reviewedNegatives, '没有经人工复核的负例，暂不计算，也不以历史未记录班组充当负例。'),
      metric('完整精确率', null, null, '缺少已复核负例，无法计算；请先完成逐单复核。'),
      metric('人工审核耗时', null, null, `需在复核记录中填写开始与结束时间；当前已复核案例 ${reviewedCases}/${labels.cases.length}。`),
    ],
    totals,
    reviewedCases,
  };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push('# 业务评估集结果（独立预测口径）', '');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`数据版本：${result.datasetVersion}`);
  lines.push(`样本：${result.caseCount} 条留出案例；已人工复核 ${result.reviewedCases} 条。`);
  lines.push('');
  lines.push('本次只运行可解释的确定性判断层（计划字段冲突 + 证据闸门），不含模型调用，因此结果不代表端到端 Agent 准确率。');
  lines.push('');
  lines.push('| 指标 | 分子 | 分母 | 值 | 说明 |', '| --- | --- | --- | --- | --- |');
  for (const item of result.metrics) {
    lines.push(`| ${item.name} | ${item.numerator ?? '—'} | ${item.denominator ?? '—'} | ${item.value ?? '不计算'} | ${item.note} |`);
  }
  lines.push('', '## 失败案例', '');
  const failures = result.perCase.filter(item => item.missed.length || item.extraUnconfirmed.length);
  if (!failures.length) lines.push('没有漏项，也没有额外下发。');
  for (const item of failures) {
    lines.push(`- ${item.caseId}：漏项 ${item.missed.join('、') || '无'}；额外下发（未确认，不计为错误） ${item.extraUnconfirmed.join('、') || '无'}；待确认 ${item.reviewCount}/${item.candidateCount}`);
  }
  lines.push('', '## 边界', '');
  lines.push('- 用户确认的历史正确班组作为正例保留；“无需更改”等状态不作为负例。');
  lines.push('- 未确认班组一律不计为负例，因此本报告不含完整精确率与误下发率。');
  lines.push('- 该结果是规则层的下限参考，模型预测另需单独评测，两者不共享准确率。');
  return lines.join('\n') + '\n';
}

const blind = load('blind-input.json');
const problems = verifyBlindPackaging(blind);
if (problems.length) {
  console.error(JSON.stringify({ ok: false, problems }, null, 2));
  process.exit(1);
}
const predictions = blind.cases.map(item => ({ caseId: item.caseId, predictions: predict(item) }));
if (predictions.length !== blind.cases.length) throw new Error('预测数量与样本数量不一致');
// 预测完成后才读取标签，避免答案进入预测路径。
const labels = load('labels.private.json');
if (labels.datasetVersion !== blind.datasetVersion) throw new Error('标签与盲态输入的版本不一致，请重新构建评估集。');
const scored = score(blind, labels);
const result = {
  datasetVersion: blind.datasetVersion,
  caseCount: blind.cases.length,
  reviewedCases: scored.reviewedCases,
  mode: 'independent_analysis',
  layer: 'deterministic_rules_only',
  generatedAt: new Date().toISOString(),
  metrics: scored.metrics,
  totals: scored.totals,
  perCase: scored.perCase,
};
writeFileSync(path.join(evalDir, 'evaluation-report.json'), JSON.stringify(result, null, 2), 'utf8');
writeFileSync(path.join(evalDir, 'evaluation-report.md'), renderMarkdown(result), 'utf8');
console.log(JSON.stringify({
  ok: true, caseCount: result.caseCount, reviewedCases: result.reviewedCases,
  metrics: result.metrics.map(item => ({ name: item.name, numerator: item.numerator, denominator: item.denominator, value: item.value })),
}, null, 2));
