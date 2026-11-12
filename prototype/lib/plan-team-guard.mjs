// Only categories supported by the supplied team classification and plan fields.
// Unknown team names are not mapped to a department by inference.
const categories = [
  { label: '小车班组', team: /^演示小车[甲乙丙丁]组(?:重型|特种)?$/, fields: ['小车班组'] },
  { label: '电气班组', team: /^演示电气[甲乙]组$/, fields: ['电气班组'] },
  { label: '涂装班组', team: /^演示涂装[甲乙丙丁戊己]组$/, fields: ['大车涂装班', '小车涂装班', '电气涂装班'] },
  { label: '下料班组', team: /^演示下料[甲乙丙]组$/, fields: ['主梁下料班组', '端梁下料班组', '车架下料班组'] },
];

// 接线字段不是“班组”列，但源计划中存在“演示电气乙组<br/>完工”这类
// 班组 + 原工序状态。仅接受字段开头的完整班组名；状态只是原计划
// 证据，不能据此断定本次变更已完成，也不能单独推断必须下发。
export function findPlanWiringEvidence(teamName, fields) {
  if (!/^演示电气[甲乙]组$/.test(teamName)) return [];
  const evidence = [];
  for (const field of ['小车接线', '大车接线']) {
    const raw = String(fields?.[field] ?? '').trim();
    if (!raw) continue;
    const lines = raw.replace(/<br\s*\/?\s*>/gi, '\n').split(/\r?\n/);
    const names = lines[0].split(/[,，;；、]/).map(value => value.trim()).filter(Boolean);
    if (names.includes(teamName)) evidence.push({ field, value: raw });
  }
  return evidence;
}

function explicitTeamInstruction(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`(?:由|交由|下发给|通知|指定|分配给|下发至|发送给|交给)\\s*${escaped}(?![\u4e00-\u9fffA-Za-z0-9])|${escaped}\\s*(?:负责|处理|执行|整改|接收|返工|完成)`, 'u');
  // A team name alone does not establish an instruction. Declined or historical
  // wording is not accepted as an affirmative direct instruction either.
  return String(text || '').split(/[。；;！!？?\n]/).some(sentence =>
    direct.test(sentence) && !/(?:不|无需|不要|停止|取消|不得|非|已|原先|此前|过去)/.test(sentence));
}

// 只有结构明确、可信地标为“变更后”的片段可作为直接指派依据。
// 拼接原文或无法拆分的人工文本不能通过直接指派例外。
export function planTeamReview(teamName, fields, context = {}) {
  const category = categories.find(c => c.team.test(teamName));
  if (!category) return null;
  const planned = new Set(category.fields.flatMap(field => String(fields?.[field] || '')
    .split(/[,，;；、\n]/).map(value => value.trim()).filter(value => value && value !== '/' && value !== 'null')));
  // An explicit match anywhere in the plan can legitimately assign a team to
  // more than one role; don't reject it simply based on the role's name.
  const assignedAnywhere = Object.entries(fields || {}).some(([key, value]) =>
    /班组|涂装班/.test(key) && !key.startsWith('预派') && String(value || '').split(/[,，;；、\n]/).some(item => item.trim() === teamName));
  const afterTexts = Array.isArray(context?.changes)
    ? context.changes.map(change => typeof change?.after === 'string' ? change.after.trim() : '').filter(Boolean)
    : [];
  const relevantWiring = findPlanWiringEvidence(teamName, fields).some(({field}) =>
    afterTexts.some(value => field === '小车接线' ? /小车/.test(value) : /大车|桥架|端梁/.test(value)));
  const explicitAfterInstruction = afterTexts.some(value => explicitTeamInstruction(value, teamName));
  if (assignedAnywhere || relevantWiring || explicitAfterInstruction) return null;
  return planned.size
    ? `${category.label}与当前生产计划不一致，请人工核实。`
    : `当前生产计划未明确${category.label}，请人工核实。`;
}
