// Exact-scope historic labels for replay; this is not model inference or live state.
function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Resolve user-confirmed historical team associations for one unmodified case.
 * confirmedRecords must be the `records` array from confirmed-correspondence.json;
 * currentRecord is the exact order/file item from history-demo.json. No fuzzy join.
 * Returned teams contain only IDs, names and originating source record IDs.
 */
export function getConfirmedHistory({ orderId, fileId, currentRecord, confirmedRecords, originalText, correctedText, candidateTeams }) {
  if (!orderId || !fileId || !Array.isArray(confirmedRecords) || !Array.isArray(candidateTeams)) {
    invalid('CONFIRMED_HISTORY_INVALID_INPUT', '历史对应数据或候选班组格式有误。');
  }
  if (!currentRecord) return { available: false, reason: 'not_found', teams: [] };
  if (currentRecord.orderId !== orderId || currentRecord.fileId !== fileId || !currentRecord.sourceFileId) {
    invalid('CONFIRMED_HISTORY_SCOPE_MISMATCH', '历史对应记录的订单或文件范围不一致。');
  }
  if (typeof originalText !== 'string' || !originalText.trim()) {
    invalid('CONFIRMED_HISTORY_ORIGINAL_MISSING', '缺少用于核验的原始变更内容。');
  }
  if (correctedText !== undefined && correctedText !== null &&
      (typeof correctedText !== 'string' || correctedText.trim() !== originalText.trim())) {
    return { available: false, reason: 'content_changed', teams: [] };
  }
  if (!Array.isArray(currentRecord.changes) || !currentRecord.changes.length || !Array.isArray(currentRecord.teams)) {
    invalid('CONFIRMED_HISTORY_SOURCE_MISSING', '历史源记录或班组明细缺失。');
  }
  const sourceIds = currentRecord.changes.map(change => change?.recordId);
  if (sourceIds.some(id => typeof id !== 'string' || !id) || new Set(sourceIds).size !== sourceIds.length) {
    invalid('CONFIRMED_HISTORY_DUPLICATE_SOURCE', '历史源记录代号缺失或重复。');
  }
  if (candidateTeams.some(t => !t || typeof t.id !== 'string' || !t.id || typeof t.name !== 'string' || !t.name) ||
      new Set(candidateTeams.map(t => t.id)).size !== candidateTeams.length ||
      new Set(candidateTeams.map(t => t.name)).size !== candidateTeams.length) {
    invalid('CONFIRMED_HISTORY_CANDIDATE_INVALID', '候选班组代号或名称缺失、重复。');
  }
  const scoped = confirmedRecords.filter(row => row?.orderId === orderId && row?.fileId === fileId);
  if (!scoped.length) {
    if (confirmedRecords.some(row => sourceIds.includes(row?.recordId))) {
      invalid('CONFIRMED_HISTORY_SCOPE_MISMATCH', '源记录代号属于其他订单或文件。');
    }
    return { available: false, reason: 'not_found', teams: [] };
  }
  const rowsWithSourceIds = confirmedRecords.filter(row => sourceIds.includes(row?.recordId));
  if (new Set(rowsWithSourceIds.map(row => row.recordId)).size !== rowsWithSourceIds.length) {
    invalid('CONFIRMED_HISTORY_DUPLICATE', '历史源记录代号重复。');
  }
  if (rowsWithSourceIds.length !== sourceIds.length || rowsWithSourceIds.some(row => row.orderId !== orderId || row.fileId !== fileId)) {
    invalid('CONFIRMED_HISTORY_SOURCE_MISMATCH', '源记录代号重复或指向其他订单文件。');
  }
  const byId = new Map();
  for (const row of scoped) {
    if (!row.recordId || byId.has(row.recordId)) invalid('CONFIRMED_HISTORY_DUPLICATE', '历史对应记录缺失代号或重复。');
    if (row.sourceFileId !== currentRecord.sourceFileId || !Array.isArray(row.confirmedTeams)) {
      invalid('CONFIRMED_HISTORY_SCOPE_MISMATCH', '历史对应源文件或班组明细不一致。');
    }
    byId.set(row.recordId, row);
  }
  if (byId.size !== sourceIds.length || sourceIds.some(id => !byId.has(id))) {
    invalid('CONFIRMED_HISTORY_SOURCE_MISMATCH', '历史对应记录与当前变更源记录不一致。');
  }
  const result = new Map();
  for (const recordId of sourceIds) {
    const row = byId.get(recordId);
    const names = new Set();
    for (const item of row.confirmedTeams) {
      if (!item || !item.name || !['待更改', '已更改'].includes(item.originalStatus) || names.has(item.name)) {
        invalid('CONFIRMED_HISTORY_INVALID_ASSOCIATION', '历史正确对应班组的名称或状态有误、重复。');
      }
      names.add(item.name);
      const sourceMatches = currentRecord.teams.filter(team => team.name === item.name &&
        Array.isArray(team.sourceRecordIds) && team.sourceRecordIds.includes(recordId));
      if (sourceMatches.length !== 1 || sourceMatches[0].historicalStatus !== item.originalStatus) {
        invalid('CONFIRMED_HISTORY_SOURCE_MISMATCH', '历史正确对应班组与源状态不一致。');
      }
      const candidate = candidateTeams.find(team => team.name === item.name);
      if (!candidate) invalid('CONFIRMED_HISTORY_TEAM_MISSING', '历史正确对应班组不在当前候选班组中，请人工核对。');
      if (!result.has(item.name)) result.set(item.name, { id: candidate.id, name: candidate.name, recordIds: [] });
      result.get(item.name).recordIds.push(recordId);
    }
  }
  return { available: true, reason: 'matched', teams: [...result.values()] };
}
