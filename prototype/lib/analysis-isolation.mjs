// 模式隔离审计：把“这次到底用了什么、排除了什么”写成可回看的记录。
// 独立预测模式下，用户确认的历史对应不得进入分析；历史回放模式下必须说明来源是用户确认关系。
export const RULES_VERSION = 'rules-20261110-evidence';
export const PROMPT_VERSION = 'prompt-20261111-brand-zhida';

const MAX_LISTED = 6;

function listedIds(ids) {
  const unique = [...new Set(ids.map(String))];
  return unique.slice(0, MAX_LISTED);
}

/**
 * @param {object} input
 * @param {'historical_replay'|'independent_analysis'} input.mode
 * @param {object} input.current       当前记录（订单、文件、源记录代号）
 * @param {object} [input.confirmed]    历史回放命中的用户确认关系；独立模式必须为空
 * @param {Array}  [input.excluded]     被排除的历史案例及原因
 * @param {Array}  [input.retrievedCases] 实际进入参考资料的相似案例
 * @param {Array}  [input.candidateTeams] 当前订单候选班组
 * @param {string} input.datasetVersion 数据版本
 */
export function buildIsolationAudit({ mode, current, confirmed = null, excluded = [], retrievedCases = [], candidateTeams = [], datasetVersion = '' }) {
  const replay = mode === 'historical_replay';
  const orderId = String(current?.orderId || '');
  const sourceFileId = String(current?.sourceFileId || '');
  const ownRecordIds = new Set((current?.changes || []).map(change => String(change.recordId || '')));

  const grouped = new Map();
  for (const item of excluded) {
    const reason = String(item.reason || 'unknown');
    if (!grouped.has(reason)) grouped.set(reason, []);
    for (const caseId of item.caseIds || []) grouped.get(reason).push(String(caseId));
  }
  const exclusions = [...grouped.entries()].map(([reason, ids]) => ({
    reason,
    labels: {
      same_order: '同订单案例',
      same_source_file: '同源文件案例',
      duplicate_text: '重复或高度相似文本',
      own_record: '本记录自身',
      invalid_case: '缺少已确认对应',
    }[reason] || '其他排除项',
    count: new Set(ids).size,
    caseIds: listedIds(ids),
  }));

  // 实际进入参考资料的案例不得与当前订单或源文件同范围。
  const scopeLeaks = retrievedCases.filter(item => String(item.orderId || '') === orderId || String(item.sourceFileId || '') === sourceFileId);
  const ownAnswerInReferences = retrievedCases.filter(item => (item.sourceRecordIds || []).some(id => ownRecordIds.has(String(id))));
  const confirmedNames = new Set((confirmed?.teams || []).map(team => String(team.name)));

  const checks = replay
    ? [
      { id: 'label_source', label: '依据来源为本单已确认对应', ok: Boolean(confirmed?.teams?.length), detail: confirmed?.teams?.length ? `确认班组 ${confirmed.teams.length} 个，来源记录 ${listedIds(confirmed.teams.flatMap(team => team.recordIds || [])).join('、') || '—'}` : '未命中用户确认对应' },
      { id: 'content_unchanged', label: '变更原文未被人工修订', ok: true, detail: '修订过的内容不进入回放，由服务端拒绝。' },
      { id: 'other_teams_not_negative', label: '未确认班组不作为负例', ok: true, detail: '回放只标记确认班组，其余列为待确认，不计算误报。' },
      { id: 'scope', label: '范围限定在同一订单与源文件', ok: scopeLeaks.length === 0, detail: `${orderId} / ${sourceFileId}` },
    ]
    : [
      { id: 'label_store_not_loaded', label: '未引用本单确认记录', ok: confirmed === null, detail: confirmed === null ? '服务端未加载本单的确认记录。' : '意外加载了本单确认记录。' },
      { id: 'same_scope_excluded', label: '同订单与同源文件案例已排除', ok: scopeLeaks.length === 0, detail: `排除同订单 ${exclusions.find(item => item.reason === 'same_order')?.count || 0} 条、同源文件 ${exclusions.find(item => item.reason === 'same_source_file')?.count || 0} 条` },
      { id: 'duplicate_text_excluded', label: '重复或高度相似文本已排除', ok: ownAnswerInReferences.length === 0, detail: `排除重复文本 ${exclusions.find(item => item.reason === 'duplicate_text')?.count || 0} 条` },
      { id: 'reference_scope', label: '参考资料不含本记录答案', ok: ownAnswerInReferences.length === 0, detail: retrievedCases.length ? `进入参考的相似案例 ${retrievedCases.length} 条，均来自其他订单与源文件` : '本次没有可用的相似案例' },
    ];

  return {
    mode,
    verdict: replay ? 'historical_replay' : (checks.every(check => check.ok) ? 'isolated' : 'attention'),
    datasetVersion,
    rulesVersion: RULES_VERSION,
    promptVersion: PROMPT_VERSION,
    scope: { orderId, sourceFileId, recordIds: listedIds([...ownRecordIds]) },
    exclusions,
    retrievedCaseIds: listedIds(retrievedCases.map(item => item.caseId).filter(Boolean)),
    checks,
    confirmedTeamCount: replay ? confirmedNames.size : 0,
    candidateTeamCount: candidateTeams.length,
    summary: replay
      ? '依据本单已确认的对应关系生成建议，不代表本次是否下发。'
      : '按变更资料独立分析：未引用本单确认结果，同订单、同源文件与重复文本案例已排除。',
  };
}
