// 班组判断证据：把“变更片段 → 部件/工序 → 计划字段 → 班组 → 依据类型”落成可回看的字段。
// 字符级核验只说明这段文字确实出现在指定来源里，不证明班组职责，也不证明因果关系。
const CATEGORIES = [
  { label: '小车班组', team: /^演示小车[甲乙丙丁]组(?:重型|特种)?$/, keywords: ['小车'], fields: ['小车班组', '小车涂装班', '小车接线'] },
  { label: '电气班组', team: /^演示电气[甲乙]组$/, keywords: ['电气', '电器', '接线'], fields: ['电气班组', '电气涂装班', '小车接线', '大车接线'] },
  { label: '涂装班组', team: /^演示涂装[甲乙丙丁戊己]组$/, keywords: ['涂装'], fields: ['大车涂装班', '小车涂装班', '电气涂装班'] },
  { label: '下料班组', team: /^演示下料[甲乙丙]组$/, keywords: ['下料', '主梁', '端梁', '车架'], fields: ['主梁下料班组', '端梁下料班组', '车架下料班组'] },
];

const MAX_QUOTE = 80;

function cleanText(value) {
  return String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/\r\n/g, '\n').trim();
}

function namesInField(value) {
  return cleanText(value).split(/[\n,，;；、]/).map(item => item.trim()).filter(Boolean);
}

export function teamCategory(teamName) {
  return CATEGORIES.find(item => item.team.test(String(teamName || ''))) || null;
}

// 片段里若出现别的班组（如“演示电气甲组”），不能当作本班组（“演示电气乙组”）的依据。
function namesOtherTeam(snippet, teamName) {
  const tokens = String(snippet || '').match(/演示[\u4e00-\u9fff]{1,10}组(?:重型|特种)?/g) || [];
  return tokens.some(token => !token.includes(teamName));
}

// 取一段可回看的变更原文：优先命中班组名称，其次命中该班组所属部件或工序关键字。
// 找不到或片段指向别的班组时返回 null，由调用方标为“缺少原文片段”，不补写内容。
export function evidenceQuoteFor(teamName, changes = []) {
  const name = String(teamName || '');
  const category = teamCategory(name);
  const texts = changes
    .filter(change => typeof change?.after === 'string' && cleanText(change.after) && cleanText(change.after) !== '无')
    .map(change => ({ recordId: String(change.recordId || ''), text: cleanText(change.after) }));
  const pick = (keyword, kind) => {
    for (const item of texts) {
      let index = item.text.indexOf(keyword);
      while (index >= 0) {
        const start = Math.max(0, index - 30);
        const snippet = item.text.slice(start, Math.min(item.text.length, index + keyword.length + MAX_QUOTE - 30)).trim();
        if (!namesOtherTeam(snippet, name)) {
          return { recordId: item.recordId, quote: snippet, matched: kind === 'name' ? '变更原文含该班组名称' : `变更原文含“${keyword}”相关部件或工序` };
        }
        index = item.text.indexOf(keyword, index + keyword.length);
      }
    }
    return null;
  };
  if (name) {
    const byName = pick(name, 'name');
    if (byName) return byName;
  }
  const keywords = category ? category.keywords : [name.replace(/[一二三]?班.*$/, '')].filter(keyword => keyword.length >= 2);
  for (const keyword of keywords) {
    const byKeyword = pick(keyword, 'keyword');
    if (byKeyword) return byKeyword;
  }
  return null;
}

/**
 * 组装单个班组的证据。
 * changes 只能是本记录的变更原文；historyRecordIds 只在历史回放模式下传入。
 * conflictNote 来自计划字段与班组的冲突检查，非空即表示存在可见差异。
 */
export function buildTeamEvidence({ teamName, changes = [], planFields = {}, historyRecordIds = [], conflictNote = '' }) {
  const name = String(teamName || '');
  const category = teamCategory(name);
  const quote = evidenceQuoteFor(name, changes);
  const change = quote ? { recordId: quote.recordId, field: '变更后内容', quote: quote.quote, matched: quote.matched } : null;
  const planFieldsOfCategory = category ? category.fields : [];
  const matchingPlanFields = planFieldsOfCategory
    .filter(field => namesInField(planFields?.[field]).includes(name))
    .map(field => ({ field, value: cleanText(planFields[field]) }));
  const plan = matchingPlanFields[0] || null;
  const historical = Array.isArray(historyRecordIds) && historyRecordIds.length
    ? { recordIds: [...new Set(historyRecordIds.map(String))], kind: '本单已确认的对应关系' }
    : null;

  let status = 'incomplete';
  if (historical) status = 'historical_confirmed';
  else if (change && plan) status = 'source_matched';
  else if (change) status = 'change_only';
  else if (plan) status = 'plan_only';

  const labels = {
    historical_confirmed: '已确认对应',
    source_matched: '变更原文 + 计划字段',
    change_only: '仅变更原文',
    plan_only: '仅计划字段',
    incomplete: '缺可回看依据',
  };
  const note = {
    historical_confirmed: '本单已确认的对应关系；不代表本次是否下发。',
    source_matched: '已核对变更原文与计划字段的文字；两者与班组职责的业务关联仍需审核。',
    change_only: '能回看变更原文，但当前计划中没有指向该班组的字段，业务关联待核实。',
    plan_only: '计划字段指向该班组，但变更原文没有可回看的片段，是否涉及本次变更待核实。',
    incomplete: '变更原文与计划字段都没有可回看的依据，不能仅凭模型描述确认。',
  }[status];

  return {
    status,
    statusLabel: labels[status],
    category: category?.label || '未分类',
    change,
    plan,
    planFields: matchingPlanFields.map(item => item.field),
    historical,
    conflict: String(conflictNote || '') || null,
    note,
  };
}

// 证据闸门：建议下发必须有可回看的变更原文来源，且计划字段不冲突。
// 只有计划字段、没有变更原文，说明不了本次变更是否涉及该班组，一律转待确认。
const DISPATCHABLE = new Set(['historical_confirmed', 'source_matched', 'change_only']);
export function evidenceGateDecision(evidence) {
  if (!evidence) return { allowed: true, reason: '' };
  // 用户确认的本记录对应不因计划字段差异被推翻，但差异仍需在报告中可见。
  if (evidence.conflict && evidence.status !== 'historical_confirmed') return { allowed: false, reason: evidence.conflict };
  if (DISPATCHABLE.has(evidence.status)) return { allowed: true, reason: '' };
  if (evidence.status === 'plan_only') {
    return { allowed: false, reason: '计划字段涉及该班组，但变更原文没有可回看的片段，先列为待确认，请人工核实。' };
  }
  return { allowed: false, reason: '缺少可回看的变更原文片段和计划字段，先列为待确认，请人工核实。' };
}
