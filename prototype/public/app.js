/* 前端：订单、班组与下发结果由本地服务提供。 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = v => (v == null ? '' : String(v));

const state = {
  records: [], teamsByRecord: {}, current: null,
  page: 'receive', selected: new Set(), loaded: false, readMode: 'initial', changeQueryValid: false,
  modelConfigured: false, backendCurrent: false, busy: false, requestId: 0, activeTaskUrl: null,
  analysis: null, plan: null, planEl: null, traceEl: null, analysisId: null,
  dispatched: new Set(), history: [], pendingAnalysis: false, correctionDirty: false, planDispatched: false,
  objectUrl: null, miniPdfLoaded: false, lastRetrieval: null, planSearchPromise: null, planSearchResult: null, planSearchVersion: 0,
  review: null, reviewNote: '', reviewSaved: null,
};

const SERVER_VERSION = 'evidence-review-20261111';
const DECISION_TEXT = { dispatch: '建议下发', hold: '建议不下发', review: '待确认' };

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3200);
}
function withClipboardTimeout(promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 8000))]);
}
async function copyIdentifier(value) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('剪贴板不可用');
    await withClipboardTimeout(navigator.clipboard.writeText(String(value)));
    toast('编号已复制到剪贴板');
    return true;
  } catch (_) {
    toast('无法访问剪贴板，请选中完整编号后使用系统复制');
    return false;
  }
}

/* ================= 页面切换与列表 ================= */
function page(which) {
  state.page = which;
  $('#receive-page').classList.toggle('hidden', which !== 'receive');
  $('#change-page').classList.toggle('hidden', which !== 'change');
  $('#plan-page').classList.toggle('hidden', which !== 'plan');
  $$('.nav-link,.tab').forEach(el => el.classList.toggle('active', el.dataset.page === which));
}
function statusClass(status) {
  if (status === '未下发') return 'status-red';
  if (status === '无需更改') return 'status-blue';
  if (status === '未接收') return 'status-green';
  if (status === '已更改') return 'status-green';
  return 'status-gray';
}
function currentTeams() {
  return state.current ? (state.teamsByRecord[recordKey(state.current)] || []) : [];
}
function recordKey(record) { return JSON.stringify([record.orderId, record.fileId]); }
function visibleReadTeams() {
  const teams = currentTeams();
  return teams;
}
function pendingTeams() {
  return currentTeams().filter(t => t.status === '未下发');
}
function recordDispatched(record) {
  return Boolean(record && state.dispatched.has(recordKey(record)));
}

function renderRecords() {
  const body = $('#records-body');
  const query = $('#search-input').value.trim().toLowerCase();
  const matches = state.records.filter(r => !query || [r.orderId, r.fileId, r.sourceFileId, r.filename].some(v => text(v).toLowerCase().includes(query)));
  const rows = matches.slice(0, 100);
  body.innerHTML = rows.map((r, i) => {
    const done = recordDispatched(r);
    const selectedRow = state.current && state.current.orderId === r.orderId && state.current.fileId === r.fileId;
    const tds = [
      '<td class="col-check"><input type="checkbox" ' + (selectedRow ? 'checked' : '') + ' tabindex="-1" aria-label="选择记录"></td>',
      '<td>' + (i + 1) + '</td>',
      '<td title="' + esc(r.fileId) + '"><span class="copy-cell"><span class="copyable-id" tabindex="0">' + esc(r.fileId) + '</span><button type="button" class="copy-button js-copy-file" aria-label="复制文件编号">复制</button></span></td>',
      '<td title="' + esc(r.filename) + '"><button type="button" class="file-preview-link js-preview-change">' + esc(r.filename) + '</button></td>',
      '<td title="' + esc(r.productType) + '">' + esc(r.productType) + '</td>',
      '<td>' + esc(r.category) + '</td>',
      '<td>' + esc(r.designer) + '</td>',
      '<td>' + esc(r.issuedAt) + '</td>',
      '<td title="按当前销售订单单独处理"><span class="copy-cell"><span class="copyable-id" tabindex="0">' + esc(r.orderId) + '</span><button type="button" class="copy-button js-copy-order" aria-label="复制订单号">复制</button></span></td>',
      '<td>' + esc(r.customer) + '</td>',
      '<td class="' + (done ? 'status-green' : 'status-gray') + '">' + (done ? '已下发' : (r.missingChangeContent ? '变更后内容缺失' : '待分析')) + '</td>',
    ];
    return '<tr data-order="' + esc(r.orderId) + '" data-file="' + esc(r.fileId) + '" class="' + (selectedRow ? 'selected' : '') + '">' + tds.join('') + '</tr>';
  }).join('');
  $('#record-count').textContent = '共 ' + matches.length + ' 条' + (matches.length > rows.length ? '（显示前 ' + rows.length + ' 条，请搜索缩小范围）' : '');
  $$('#records-body tr').forEach(tr => {
    tr.addEventListener('click', () => selectRecord(tr.dataset.order, tr.dataset.file));
    tr.querySelectorAll('.copyable-id').forEach(el => el.addEventListener('click', ev => ev.stopPropagation()));
    tr.querySelector('.js-copy-file').addEventListener('click', ev => { ev.stopPropagation(); void copyIdentifier(tr.dataset.file); });
    tr.querySelector('.js-copy-order').addEventListener('click', ev => { ev.stopPropagation(); void copyIdentifier(tr.dataset.order); });
    tr.querySelector('.js-preview-change').addEventListener('click', ev => {
      ev.stopPropagation();
      const record = state.records.find(r => r.orderId === tr.dataset.order && r.fileId === tr.dataset.file);
      if (record) void showChangePdf(record);
    });
  });
}
function renderChange() {
  const r = state.changeQueryValid ? state.current : null;
  $('#change-count').textContent = r ? '1' : '0';
  $('#change-record-body').innerHTML = r
    ? '<tr class="selected"><td>1</td><td>' + esc(r.orderId) + '</td><td title="' + esc(r.productType) + '">' + esc(r.productType) + '</td><td>' + esc(r.fileId) + '</td><td>—</td><td>' + esc(r.category) + '</td><td>—</td><td>来源：变更记录</td></tr>'
    : '';
}
function renderTeams() {
  const filter = $('#team-filter').value.trim();
  const teams = state.loaded && state.current ? visibleReadTeams().filter(t => !filter || text(t.name).includes(filter)) : [];
  $('#teams-body').innerHTML = teams.map(t => {
    const disabled = t.status !== '未下发';
    return '<tr data-id="' + esc(t.id) + '" data-status="' + esc(t.status) + '">' +
      '<td class="col-check"><input class="team-check" type="checkbox" data-id="' + esc(t.id) + '" ' + (disabled ? 'disabled' : '') + ' ' + (state.selected.has(text(t.id)) ? 'checked' : '') + ' aria-label="选择' + esc(t.name) + '"></td>' +
      '<td>' + esc(t.name) + '</td>' +
      '<td class="' + statusClass(t.status) + '">' + esc(t.status === '未下发' ? '—' : t.status) + '</td>' +
      '<td>' + esc(t.dispatchUser || '—') + '</td>' +
      '<td>' + esc(t.dispatchTime || '—') + '</td>' +
      '<td>—</td><td>—</td><td>—</td></tr>';
  }).join('');
  $('#teams-count').textContent = teams.length;
  const eligible = $$('.team-check:not(:disabled)');
  const all = $('#select-all');
  all.disabled = !state.loaded || !eligible.length;
  all.checked = eligible.length > 0 && eligible.every(el => el.checked);
  $('#candidate-note').textContent = state.loaded
    ? '当前订单 ' + state.current.orderId + ' · ' + (state.readMode === 'all' ? '全部读取' : '初次读取') + ' · 历史状态不展示 · 共 ' + teams.filter(t => t.status === '未下发').length + ' 个可分析班组'
    : '请选择订单并点击“读取”';
  $$('.team-check').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) state.selected.add(input.dataset.id); else state.selected.delete(input.dataset.id);
      if (state.review && state.review[input.dataset.id]) state.review[input.dataset.id].decision = input.checked ? 'dispatch' : 'review';
      const vis = $$('.team-check:not(:disabled)');
      all.checked = vis.length > 0 && vis.every(el => el.checked);
      syncPlan();
    });
  });
  $$('#teams-body tr').forEach(tr => tr.addEventListener('click', ev => {
    if (ev.target.tagName === 'INPUT') return;
    const input = tr.querySelector('.team-check');
    if (input && !input.disabled) input.click();
  }));
}

/* ================= 记录选择 ================= */
function selectRecord(orderId, fileId, options = {}) {
  const record = state.records.find(r => r.orderId === orderId && r.fileId === fileId);
  if (!record) return;
  const changed = !state.current || state.current.orderId !== orderId || state.current.fileId !== fileId;
  state.current = record;
  if (changed) {
    $('#confirm-modal').classList.add('hidden');
    $('#pdf-modal').classList.add('hidden');
    clearReportPreview();
    state.requestId++;
    if (state.activeTaskUrl) {
      state.cancelPromise = api(state.activeTaskUrl + '/cancel', {}).catch(() => {});
    }
    state.selected = new Set();
    state.loaded = false;
    state.readMode = 'initial';
    state.planSearchVersion++;
    state.planSearchResult = null;
    state.changeQueryValid = false;
    if (!options.preserveQuery) {
      $('#file-filter').value = '';
      $('#order-filter').value = '';
    }
    state.analysis = null;
    $('#preview-button').textContent = '预览 AI 报告';
    $('#change-preview').textContent = '预览 AI 报告';
    $('#toggle-pdf').textContent = '▤ AI 报告预览';
    state.plan = null;
    state.planEl = null;
    state.traceEl = null;
    state.analysisId = null;
    state.review = null;
    state.reviewNote = '';
    state.reviewSaved = null;
    state.planDispatched = false;
    state.history = [];
    state.correctionDirty = false;
    state.miniPdfLoaded = false;
    streamReset();
  }
  $('#context-name').textContent = record.filename;
  $('#context-file').textContent = record.fileId;
  $('#context-order').textContent = record.orderId;
  $('#mini-pdf').classList.add('hidden');
  renderRecords();
  renderChange();
  renderTeams();
  if (changed && !$('#assistant').classList.contains('hidden')) {
    if (recordDispatched(record)) {
      note('该文件已完成下发，AI 不再自动重复分析。');
      progress(3, '已完成下发');
    } else if (state.busy) {
      state.pendingAnalysis = true;
    } else {
      runAnalysis();
    }
  }
}

/* ================= 时间轴 ================= */
function streamReset() {
  $('#stream').innerHTML = '';
  state.planEl = null;
  state.traceEl = null;
}
function scrollBottom() {
  const s = $('#stream');
  s.scrollTop = s.scrollHeight;
}
function appendEntry(el) {
  $('#stream').appendChild(el);
  scrollBottom();
  return el;
}
function formatText(raw) {
  return esc(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\n)\s*[-*]\s+/g, '$1• ')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function entry(kind, content) {
  const wrap = document.createElement('div');
  wrap.className = 'entry ' + kind;
  if (kind === 'note') {
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = content;
    wrap.appendChild(b);
  } else if (kind === 'user') {
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = content;
    wrap.appendChild(b);
  } else {
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = '✦';
    const b = document.createElement('div'); b.className = 'bubble';
    if (kind === 'bot') b.innerHTML = formatText(content); else b.textContent = content;
    wrap.append(avatar, b);
  }
  return appendEntry(wrap);
}
function note(t) { return entry('note', t); }
function retryEntry() {
  const wrap = document.createElement('div');
  wrap.className = 'entry';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = '!';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const link = document.createElement('span');
  link.className = 'link';
  link.textContent = '重新分析这份文件';
  link.addEventListener('click', () => {
    if (state.busy) { toast('AI 正在处理，请稍候'); return; }
    const areas = $$('#stream .js-extracted');
    const value = areas.length ? areas[areas.length - 1].value : '';
    runAnalysis(value || undefined);
  });
  bubble.append(link);
  wrap.append(avatar, bubble);
  appendEntry(wrap);
}
function manualExtractionEntry(record, initialText = '') {
  state.correctionDirty = true;
  const extractCard = card({
    title: '手工填写变更内容',
    sub: '请根据可核实的资料补充变更内容',
    avatar: '▤',
    body: '<textarea class="js-extracted" rows="6" maxlength="50000" placeholder="请填写核实后的变更内容"></textarea>' +
      '<div class="extract-foot"><span>来源：人工输入，提交前请核对</span>' +
      '<button type="button" class="btn primary js-manual-analyze">使用人工输入重新分析</button></div>',
  });
  const input = extractCard.querySelector('.js-extracted');
  input.value = initialText;
  extractCard.querySelector('.js-manual-analyze').addEventListener('click', () => {
    if (!state.current || state.current.orderId !== record.orderId || state.current.fileId !== record.fileId) { toast('订单或文件已切换，请重新核对'); return; }
    if (state.busy) { toast('AI 正在处理，请稍候'); return; }
    if (!input.value.trim()) { toast('请先填写变更内容'); input.focus(); return; }
    runAnalysis(input.value);
  });
}
function bot(t) { return entry('bot', t); }
function user(t) { return entry('user', t); }

function card(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'entry';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = opts.avatar || '✦';
  const c = document.createElement('div');
  c.className = 't-card ' + (opts.className || '');
  c.innerHTML =
    '<div class="card-head"><strong>' + esc(opts.title) + '</strong>' +
    (opts.sub ? '<span class="card-sub">' + esc(opts.sub) + '</span>' : '') +
    '<div class="card-tools">' + (opts.tools || '') + '</div></div>' +
    '<div class="card-body">' + (opts.body || '') + '</div>';
  wrap.append(avatar, c);
  appendEntry(wrap);
  return c;
}

/* ================= 进度 ================= */
function progress(index, label) {
  $$('#steps .step').forEach((el, i) => {
    el.classList.toggle('active', i === index);
    el.classList.toggle('done', i < index);
  });
  $('#progress-label').textContent = label || '';
}

/* ================= 分析 ================= */
async function runAnalysis(correctedText) {
  if (!state.current || state.busy) return;
  if (!state.backendCurrent) { toast('当前服务版本过旧，请刷新页面后重试。'); return; }
  const record = { ...state.current };
  if (recordDispatched(record)) { note('该文件已完成下发，不重复分析。'); return; }
  if (state.cancelPromise) {
    try { await state.cancelPromise; } catch (_) {}
    state.cancelPromise = null;
  }
  if (!state.current || state.current.orderId !== record.orderId || state.current.fileId !== record.fileId) return;
  const reqId = ++state.requestId;
  clearReportPreview();
  state.analysisId = null;
  state.busy = true;
  setComposerBusy(true);
  state.correctionDirty = false;

  if (correctedText !== undefined) user('（识别内容已更正，请按修正后的文本重新分析）');
  else note('开始读取 ' + record.fileId + ' 并生成下发规划…');
  const trace = card({
    title: '处理轨迹', sub: '网页上真实执行的操作', className: 'trace-card',
    body: '<details class="trace" open><summary>展开 / 收起</summary><ol id="trace-list"></ol></details>',
  });
  state.traceEl = trace.querySelector('#trace-list');
  progress(0, '正在解析文件');
  traceLine('正在读取并解析 ' + record.fileId + ' …');
  const startedAt = Date.now();
  state.elapsedTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const base = $('#progress-label').textContent.split(' · ')[0] || '正在处理';
    $('#progress-label').textContent = base + ' · 已用时 ' + seconds + 's';
  }, 1000);

  try {
    const payload = { orderId: record.orderId, fileId: record.fileId };
    if (correctedText !== undefined) payload.correctedText = correctedText;
    const data = await runAgentTask(payload, record, reqId);
    if (reqId !== state.requestId) return;
    state.analysis = data;
    state.plan = data.plan || null;
    state.analysisId = data.analysisId || null;
    state.busyRetried = false;
    renderAnalysis(data);
  } catch (err) {
    if (reqId !== state.requestId) return;
    if (!state.busyRetried && /已有 Agent 任务/.test(err.message || '')) {
      state.busyRetried = true;
      note('上一轮任务还在收尾，正在自动重试…');
      await wait(1800);
      state.busy = false;
      setComposerBusy(false);
      hideCursor();
      runAnalysis(correctedText);
      return;
    }
    state.busyRetried = false;
    entry('error', err.message);
    if (err.code === 'CASE_TEXT_UNCERTAIN' || err.code === 'CHANGE_CONTENT_MISSING') manualExtractionEntry(record, correctedText || '');
    else retryEntry();
    progress(0, '需要处理');
    if (state.traceEl && state.traceEl.lastElementChild) state.traceEl.lastElementChild.classList.add('done');
    if (correctedText !== undefined) state.correctionDirty = true;
  } finally {
    if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
    hideCursor();
    state.busy = false;
    setComposerBusy(false);
    if (state.pendingAnalysis) {
      state.pendingAnalysis = false;
      if (!$('#assistant').classList.contains('hidden') && state.current && !recordDispatched(state.current)) setTimeout(runAnalysis, 0);
    }
  }
}

function traceLine(t, done) {
  if (!state.traceEl) return;
  const li = document.createElement('li');
  if (done) li.className = 'done';
  li.dataset.t = String(Date.now());
  li.textContent = t;
  state.traceEl.appendChild(li);
  scrollBottom();
}

function renderAnalysis(data) {
  $('#preview-button').textContent = '预览 AI 报告';
  $('#change-preview').textContent = '预览 AI 报告';
  $('#toggle-pdf').textContent = '▤ AI 报告预览';
  bot(data.summary || '分析完成，请核对时间轴中的下发单。');
  state.review = null;
  state.reviewSaved = null;
  const changes = Array.isArray(data.changes) ? data.changes : [];
  if (changes.length) {
    const body = changes.map((c, i) =>
      '<div class="change-item"><b>变更 ' + (i + 1) + '：' + esc(c.text) + '</b>' +
      '<div class="meta">隶属部件：' + esc(c.component || '待确认') +
      (c.state ? '　在制状态：' + esc(c.state) : '') +
      (c.reason ? '　原因：' + esc(c.reason) : '') +
      '　来源：' + esc(c.source || '待确认') + '</div></div>').join('');
    card({ title: '变更条目', sub: '共 ' + changes.length + ' 条 · 逐条分析', body: body, avatar: '▤' });
  }
  const extractCard = card({
    title: '识别内容', sub: '来自变更资料识别结果，可人工修正', avatar: '▤',
    body: '<textarea class="js-extracted" rows="6">' + esc(data.extractedText || '') + '</textarea>' +
      '<div class="extract-foot"><span>来源：' + esc(data.source || 'PDF 提取') + '</span>' +
      '<span class="link js-reanalyze">按修正内容重新分析</span></div>',
  });
  const extracted = extractCard.querySelector('.js-extracted');
  extracted.addEventListener('input', () => {
    state.correctionDirty = true;
    clearReportPreview();
    $('#progress-label').textContent = '识别内容已修改，需重新分析后才能下发';
  });
  extractCard.querySelector('.js-reanalyze').addEventListener('click', () => runAnalysis(extracted.value));

  retrievalCard(data.retrieval, '检索依据（BM25）');
  progress(3, '等待你审批');
  planCard(record_snapshot());
}

function retrievalCard(list, title) {
  if (!Array.isArray(list) || !list.length) return;
  const row = item => '<li><b>' + esc(item.file) + ' › ' + esc(item.section) + '</b> <span class="score">' + esc(item.score) + '</span></li>';
  const visible = list.slice(0, 8);
  const rest = list.slice(8);
  const body = '<ol class="retrieval-list">' + visible.map(row).join('') + '</ol>' +
    (rest.length
      ? '<details class="retrieval-more"><summary>展开其余 ' + rest.length + ' 段</summary><ol class="retrieval-list">' + rest.map(row).join('') + '</ol></details>'
      : '');
  card({ title: title || '检索依据', sub: list.length + ' 段命中 · 供模型引用', avatar: '▤', body: body });
}
function record_snapshot() {
  return state.current;
}

/* ================= 下发单（审批卡） ================= */
function reasonOf(teamId) {
  const plan = state.plan;
  if (!plan) return { decision: 'review', reason: '尚未分析', evidence: '' };
  for (const key of ['dispatch', 'hold', 'review']) {
    const hit = (plan[key] || []).find(x => x.teamId === teamId);
    if (hit) {
      return {
        decision: key, reason: hit.reason, evidence: hit.evidence,
        evidenceDetail: hit.evidenceDetail || null,
        modelReason: hit.modelReason || '', modelDecision: hit.modelDecision || '',
      };
    }
  }
  return { decision: 'review', reason: 'AI 未覆盖该班组', evidence: '', evidenceDetail: null, modelReason: '', modelDecision: '' };
}

function planCard() {
  const el = document.createElement('div');
  el.className = 'entry';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = '✓';
  const c = document.createElement('div');
  c.className = 't-card plan-card';
  c.id = 'plan-card';
  el.append(avatar, c);
  if (state.planEl) {
    // 旧下发单保留在时间轴里，但不再占用 #plan-card 及其内部标识，避免重复 id。
    state.planEl.id = '';
    state.planEl.classList.add('stale');
    state.planEl.querySelectorAll('[id]').forEach(el => { el.id = ''; });
    const oldActions = state.planEl.querySelector('.plan-actions');
    if (oldActions) oldActions.innerHTML = '<span class="hint">已被后续分析替代，请以下方新的下发单为准</span>';
  }
  appendEntry(el);
  state.planEl = c;
  syncPlan();
  setTimeout(() => { if (state.planEl === c) c.scrollIntoView({ block: 'start', inline: 'nearest' }); }, 140);
  return c;
}

function syncPlan() {
  if (state.syncScheduled) return;
  state.syncScheduled = true;
  requestAnimationFrame(() => {
    state.syncScheduled = false;
    renderPlan();
  });
}
function evidenceTag(entry) {
  const detail = entry && entry.evidenceDetail;
  if (!detail) return '';
  const cls = detail.status === 'historical_confirmed' ? 'ev-history'
    : detail.status === 'source_matched' ? 'ev-source'
      : detail.status === 'incomplete' ? 'ev-missing' : 'ev-partial';
  return '<span class="ev-tag ' + cls + '">' + esc(detail.statusLabel || '证据') + '</span>';
}

function evidenceDetailHtml(entry) {
  const detail = entry && entry.evidenceDetail;
  if (!detail) return '<div class="ev-detail muted">没有可回看的证据记录。</div>';
  const change = detail.change
    ? '<div><b>变更原文：</b>「' + esc(detail.change.quote) + '」<span class="muted">（' + esc(detail.change.recordId || '') + ' · ' + esc(detail.change.matched || '') + '）</span></div>'
    : '<div><b>变更原文：</b>无可回看的片段</div>';
  const plan = detail.plan
    ? '<div><b>计划字段：</b>' + esc(detail.plan.field) + ' = ' + esc(detail.plan.value) + '</div>'
    : '<div><b>计划字段：</b>未找到指向该班组的字段</div>';
  const historical = detail.historical
    ? '<div><b>已确认对应：</b>' + esc((detail.historical.recordIds || []).join('、')) + '</div>'
    : '';
  const conflict = detail.conflict ? '<div class="ev-conflict"><b>差异：</b>' + esc(detail.conflict) + '</div>' : '';
  const model = entry && entry.modelReason && entry.modelReason !== entry.reason
    ? '<div class="ev-model"><b>AI 原始理由：</b>' + esc(entry.modelReason) + '<span class="muted">（规则已改为待确认）</span></div>' : '';
  return '<div class="ev-detail">' + change + plan + historical + conflict + model +
    '<div class="muted">' + esc(detail.note || '') + '</div></div>';
}

function reviewMap() {
  if (!state.review) state.review = {};
  for (const team of pendingTeams()) {
    if (!state.review[team.id]) {
      const ai = reasonOf(team.id);
      const decision = ai.decision === 'dispatch' ? 'dispatch' : ai.decision === 'hold' ? 'hold' : 'review';
      state.review[team.id] = { decision, reason: ai.reason || '', modelDecision: decision };
    }
  }
  return state.review;
}

function setReviewDecision(teamId, decision, reason) {
  const map = reviewMap();
  const entry = map[teamId] || { decision: 'review', reason: '' };
  entry.decision = decision;
  if (reason !== undefined) entry.reason = reason;
  map[teamId] = entry;
  if (decision === 'dispatch') state.selected.add(teamId); else state.selected.delete(teamId);
  const input = $('#teams-body .team-check[data-id="' + teamId + '"]');
  if (input && !input.disabled && input.checked !== (decision === 'dispatch')) input.checked = decision === 'dispatch';
  syncPlan();
}

function aiDecisionOf(teamId) {
  const ai = reasonOf(teamId);
  return ai.decision === 'dispatch' ? 'dispatch' : ai.decision === 'hold' ? 'hold' : 'review';
}

function aiReasonOf(teamId) {
  const ai = reasonOf(teamId);
  return ai.reason || '未填写原因';
}

function reviewRow(team, entry) {
  const ai = reasonOf(team.id);
  const aiKey = aiDecisionOf(team.id);
  const changed = entry.decision !== aiKey;
  const button = (value, label) => '<button type="button" data-decide="' + value + '" data-id="' + esc(team.id) + '" class="' +
    (entry.decision === value ? 'on ' : '') + value + '">' + label + '</button>';
  return '<div class="review-row" data-id="' + esc(team.id) + '">' +
    '<span class="rv-team">' + esc(team.name) + evidenceTag(ai) +
    '<button type="button" class="rv-toggle" data-detail="' + esc(team.id) + '">证据</button></span>' +
    '<span class="rv-ai">' + esc(DECISION_TEXT[aiKey] || '待确认') + (changed ? '<i class="rv-diff">已调整</i>' : '') + '</span>' +
    '<span class="rv-dec">' + button('dispatch', '下发') + button('hold', '不下发') + button('review', '待确认') + '</span>' +
    '<input class="rv-reason" data-reason="' + esc(team.id) + '" value="' + esc(entry.reason || '') + '" placeholder="' +
    (entry.decision === 'dispatch' ? '可留空' : '必填：不下发或待确认的原因') + '">' +
    '<div class="ev-slot hidden" id="ev-' + esc(team.id) + '">' + evidenceDetailHtml(ai) + '</div>' +
    '</div>';
}

function reviewStatusText() {
  const saved = state.reviewSaved;
  if (!saved) return '审批意见尚未保存';
  if (saved.analysisId !== state.analysisId) return '审批意见对应旧分析，需重新保存';
  return '审批意见已保存：' + saved.savedAt;
}

function renderPlan() {
  const c = state.planEl;
  if (!c) return;
  const plan = state.plan || { dispatch: [], hold: [], review: [] };
  const teams = currentTeams();
  const pending = teams.filter(t => t.status === '未下发');
  const done = Boolean(state.planDispatched);
  const doneIds = (state.lastDispatched && state.lastDispatched.ids) || [];
  const selectedIds = done ? doneIds : pending.filter(t => state.selected.has(t.id)).map(t => t.id);
  const unselectedIds = done ? pending.map(t => t.id) : pending.filter(t => !state.selected.has(t.id)).map(t => t.id);
  const holdIds = unselectedIds.filter(id => reasonOf(id).decision === 'hold');
  const reviewIds = unselectedIds.filter(id => reasonOf(id).decision === 'review');
  const removedIds = unselectedIds.filter(id => reasonOf(id).decision === 'dispatch');
  const analyzedCount = (plan.dispatch || []).length + (plan.hold || []).length;
  const candidateCount = analyzedCount + (plan.review || []).length;
  const coverage = candidateCount ? analyzedCount + '/' + candidateCount : '—';
  const changed = selectedIds.filter(id => reasonOf(id).decision !== 'dispatch');
  const missingEvidence = [...(plan.dispatch || []), ...(plan.review || [])]
    .filter(entry => entry.evidenceDetail && entry.evidenceDetail.status === 'incomplete').length;

  const metrics = '<div class="plan-metrics">' +
    '<span class="metric dispatch"><b>' + selectedIds.length + '</b>将下发</span>' +
    '<span class="metric hold"><b>' + holdIds.length + '</b>建议不下发</span>' +
    '<span class="metric review"><b>' + reviewIds.length + '</b>待确认</span>' +
    (removedIds.length ? '<span class="metric"><b>' + removedIds.length + '</b>人工移出</span>' : '') +
    (missingEvidence ? '<span class="metric"><b>' + missingEvidence + '</b>缺可回看依据</span>' : '') +
    '<span class="metric"><b>' + coverage + '</b>AI 覆盖</span>' +
    '</div>';

  const chips = selectedIds.length
    ? selectedIds.map(id => {
      const t = teams.find(x => x.id === id) || {};
      return '<span class="chip" data-id="' + esc(id) + '">' + esc(t.name || id) + (done ? '' : '<button data-remove="' + esc(id) + '" title="移出名单">×</button>') + '</span>';
    }).join('')
    : '<span class="tiny muted">当前没有勾选班组</span>';

  const groupList = ids => ids.length
    ? '<ul class="hold-list">' + ids.map(id => {
      const t = teams.find(x => x.id === id) || {};
      const r = reasonOf(id);
      return '<li data-row="' + esc(id) + '"><span class="team">' + esc(t.name || id) + evidenceTag(r) + '</span>' +
        '<span class="why" data-expand="' + esc(id) + '" title="' + esc(r.reason || '') + '">' + esc(r.reason || '—') + '</span>' +
        '<span class="act">' + (done ? '' : '<span class="link" data-add="' + esc(id) + '">改为下发</span>') + '</span></li>';
    }).join('') + '</ul>'
    : '<span class="tiny muted">无</span>';

  const map = reviewMap();
  const reviewPanel = done ? '' :
    '<div class="plan-group review-panel"><div class="group-title"><b>集中审批</b><span>逐项确认后保存；待确认项不会被记为已确认不下发</span></div>' +

    pending.map(team => reviewRow(team, map[team.id])).join('') +
    '<div class="review-actions"><span class="tiny muted" id="review-status">' + esc(reviewStatusText()) + '</span>' +
    '<input id="review-note" class="rv-note" placeholder="整单说明（可选）" value="' + esc(state.reviewNote || '') + '">' +
    '<button class="btn" id="save-review">保存审批意见</button></div></div>';

  const disabled = state.busy || !selectedIds.length;
  const warn = reviewIds.length
    ? '<div class="plan-note">有 ' + reviewIds.length + ' 个班组证据不足，需人工核实；本次名单未包含这些班组。</div>'
    : '';
  const diff = changed.length
    ? '<div class="plan-note">名单已由你调整：' + changed.length + ' 个班组与 AI 建议不同，将按你的选择下发。</div>'
    : '';

  c.innerHTML =
    '<div class="card-head"><strong>AI 下发单</strong><span class="card-sub">订单 ' + esc(state.current ? state.current.orderId : '') + ' · 按当前订单处理</span>' +
    '<div class="card-tools"><span class="tiny muted">' + (state.analysisId ? '已生成' : '生成中') + '</span></div></div>' +

    metrics +
    '<div class="plan-group"><div class="group-title"><b>' + (done ? '已下发班组' : '本次将下发') + '</b><span>' + (done ? (state.current && state.current.dispatchedAt || '') : '点 × 可移出名单') + '</span></div><div class="chips">' + chips + '</div></div>' +
    '<div class="plan-group"><div class="group-title"><b>待确认</b><span>证据不足，需人工核实</span></div>' + groupList(reviewIds) + '</div>' +
    '<div class="plan-group"><div class="group-title"><b>建议不下发</b><span>请审核判断依据</span></div>' + groupList(holdIds) + '</div>' +
    (removedIds.length ? '<div class="plan-group"><div class="group-title"><b>人工移出</b><span>原建议下发</span></div>' + groupList(removedIds) + '</div>' : '') +
    reviewPanel +
    (done ? '' : warn + diff) +
    (done
      ? '<div class="plan-actions"><span class="approved-badge">✓ 已完成下发，共 ' + selectedIds.length + ' 个班组</span><span class="hint">已记录审批结果</span></div>'
      : '<div class="plan-actions"><button class="btn primary approve js-approve" ' + (disabled ? 'disabled' : '') + '>审核通过并下发 ' + selectedIds.length + ' 个班组</button>' +
        '<span class="hint">下发需人工确认<br>结果仅更新当前页面</span></div>');

  c.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { if (!c.classList.contains('stale')) setReviewDecision(b.dataset.remove, 'review'); }));
  c.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { if (!c.classList.contains('stale')) setReviewDecision(b.dataset.add, 'dispatch'); }));
  c.querySelectorAll('[data-expand]').forEach(el => el.addEventListener('click', () => el.parentElement.classList.toggle('expanded')));
  c.querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', () => {
    if (c.classList.contains('stale')) return;
    const current = reviewMap()[b.dataset.id] || {};
    setReviewDecision(b.dataset.id, b.dataset.decide, current.reason);
  }));
  c.querySelectorAll('[data-reason]').forEach(input => input.addEventListener('input', () => {
    const current = reviewMap();
    if (!current[input.dataset.reason]) return;
    current[input.dataset.reason].reason = input.value;
  }));
  c.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => {
    const slot = c.querySelector('#ev-' + CSS.escape(b.dataset.detail));
    if (slot) slot.classList.toggle('hidden');
  }));
  const noteInput = c.querySelector('#review-note');
  if (noteInput) noteInput.addEventListener('input', () => { state.reviewNote = noteInput.value; });
  const saveBtn = c.querySelector('#save-review');
  if (saveBtn) saveBtn.addEventListener('click', () => { if (!c.classList.contains('stale')) void saveReview(); });
  const approveBtn = c.querySelector('.js-approve');
  if (approveBtn) approveBtn.addEventListener('click', () => { if (!c.classList.contains('stale')) openConfirm(); });
}

async function saveReview() {
  if (!state.current || !state.analysisId) { toast('请先完成整单分析，再保存审批意见'); return null; }
  if (state.correctionDirty) { toast('识别内容已修改，请先重新分析'); return null; }
  const map = reviewMap();
  const decisions = pendingTeams().map(team => {
    const entry = map[team.id] || { decision: 'review', reason: '' };
    const reason = (entry.reason || '').trim() || (entry.decision === 'dispatch' ? '' : aiReasonOf(team.id));
    return { teamId: team.id, decision: entry.decision, reason };
  });
  try {
    const data = await api('/api/review', {
      orderId: state.current.orderId, fileId: state.current.fileId,
      analysisId: state.analysisId, decisions, note: state.reviewNote || '',
    });
    state.reviewSaved = data.review;
    syncPlan();
    toast('审批意见已保存');
    return data.review;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

/* ================= AI 操作光标 ================= */
const agent = { el: null, enabled: true };
// 操作动画节奏：一次移动 220ms、点击前后各 55/120ms、逐字 8ms。
const AGENT_TIMING = { move: 80, beforeClick: 15, afterClick: 45, typeDelay: 4, typeSettle: 20 };
agent.stats = { moves: 0, clicks: 0, ms: 0 };
window.__agentStats = agent.stats;
function ensureCursor() {
  if (agent.el) return agent.el;
  const el = document.createElement('div');
  el.id = 'agent-cursor';
  el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 2l7 18 2.4-7.4L21 10z" fill="#1668b3" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
    '<span class="agent-label"></span>';
  document.body.appendChild(el);
  agent.el = el;
  return el;
}
function cursorLabel(text) {
  const el = ensureCursor();
  el.querySelector('.agent-label').textContent = text || '';
}
function hideCursor() {
  if (agent.el) agent.el.classList.remove('visible');
}
async function moveCursor(target, label) {
  if (!agent.enabled) return;
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(8, Math.min(rect.left + Math.min(rect.width / 2, 90), window.innerWidth - 26));
  const y = Math.max(8, Math.min(rect.top + rect.height / 2, window.innerHeight - 26));
  const cursor = ensureCursor();
  agent.stats.moves++;
  cursor.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  cursor.classList.add('visible');
  cursorLabel(label);
  el.classList.add('agent-target');
  await wait(AGENT_TIMING.move);
  el.classList.remove('agent-target');
}
async function agentClick(target, label) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const startedAt = performance.now();
  agent.stats.clicks++;
  await moveCursor(el, label);
  if (agent.enabled) {
    const rect = el.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'agent-ripple';
    dot.style.left = (rect.left + rect.width / 2) + 'px';
    dot.style.top = (rect.top + rect.height / 2) + 'px';
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  }
  await wait(AGENT_TIMING.beforeClick);
  el.click();
  await wait(AGENT_TIMING.afterClick);
  agent.stats.ms += performance.now() - startedAt;
}
async function agentPasteIdentifier(el, value, copyButton, label, record, reqId) {
  if (!el) throw new Error('未找到需要填写的输入框。');
  if (el.dataset.manualPaste === '1' && el.value === String(value)) {
    traceLine('已核验人工粘贴的当前' + label, true);
    return;
  }
  agent.copyPromise = null;
  await agentClick(copyButton, '复制当前' + label);
  const copied = await agent.copyPromise;
  if (!copied || !navigator.clipboard?.readText) throw new Error('无法访问系统剪贴板，请在当前页面手动复制并粘贴' + label + '到对应输入框后重新分析。');
  let pasted;
  traceLine('正在请求读取系统剪贴板；如浏览器提示，请允许访问', true);
  try { pasted = await withClipboardTimeout(navigator.clipboard.readText()); }
  catch (_) { throw new Error('无法读取系统剪贴板，请在当前页面手动复制并粘贴' + label + '到对应输入框后重新分析。'); }
  assertAgentScope(record, reqId);
  if (pasted !== String(value)) throw new Error('剪贴板内容与当前记录不一致，请重新复制。');
  await moveCursor(el, '读取剪贴板并填入' + label);
  el.focus();
  el.select();
  el.setRangeText(pasted, 0, el.value.length, 'end');
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: pasted }));
  if (el.value !== String(value)) throw new Error('剪贴板内容未能正确填入。');
  traceLine('已复制当前' + label + '到系统剪贴板并读取填入', true);
}

/* ================= Agent 网页动作 ================= */
function assertAgentScope(record, reqId) {
  if (reqId !== state.requestId || state.current?.orderId !== record.orderId || state.current?.fileId !== record.fileId) {
    throw new Error('当前订单或文件已切换，停止后续操作。');
  }
}
function visibleChangePage() {
  return !$('#change-page').classList.contains('hidden') && state.page === 'change';
}
const planFields = ['规格型号（来自合同详情）', '梁盒班组', '大车班组', '大车进度', '端梁进度', '小车班组', '小车进度', '小车接线', '电气班组', '电气进度', '主梁下料班组', '端梁下料班组', '车架下料班组', '大车涂装班', '小车涂装班', '电气涂装班', '计划交期', '生产状态'];
async function queryProductionPlan() {
  const orderId = $('#plan-keyword').value.trim();
  const version = ++state.planSearchVersion;
  state.planSearchResult = null;
  if (!orderId) throw new Error('请输入订单号查询生产作业计划。');
  $('#plan-body').innerHTML = '<tr><td colspan="19" class="plan-empty">正在查询生产作业计划…</td></tr>';
  $('#plan-count').textContent = '0';
  const result = await api('/api/production-plan?orderId=' + encodeURIComponent(orderId));
  if (version !== state.planSearchVersion || $('#plan-keyword').value.trim() !== orderId) return null;
  if (!Array.isArray(result.rows) || !Array.isArray(result.columns) || result.matchCount !== result.rows.length) throw new Error('生产计划查询结果格式不正确。');
  const positions = planFields.map(field => result.columns.indexOf(field));
  const rows = result.rows.map((row, index) => {
    if (!Array.isArray(row.values)) throw new Error('生产计划记录格式不正确。');
    const fields = positions.map(pos => pos < 0 ? '' : text(row.values[pos]).replace(/<br\s*\/?\s*>/gi, '；'));
    return '<tr data-source-row="' + esc(row.sourceRow) + '" data-truck-team="' + esc(fields[2]) + '"><td>' + (index + 1) + '</td>' +
      fields.map(value => '<td>' + esc(value || '—') + '</td>').join('') + '</tr>';
  });
  $('#plan-body').innerHTML = rows.join('') || '<tr><td colspan="19" class="plan-empty">未找到匹配的生产作业计划</td></tr>';
  $('#plan-count').textContent = String(result.matchCount);
  state.planSearchResult = { orderId, matchCount: result.matchCount, truckTeam: result.matchCount === 1 ? text(result.truckTeam).trim() : '' };
  return state.planSearchResult;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function executeAgentAction(action, record, reqId) {
  assertAgentScope(record, reqId);
  const name = action.name;
  const args = action.args || {};
  if (name === 'navigate_change_record') {
    await agentClick('.nav-link[data-page="change"]', '打开变更记录');
    if (!visibleChangePage()) throw new Error('变更记录页面没有成功显示。');
    traceLine('已打开变更记录页面', true);
    progress(1, '正在分析规划');
    await wait(80);
    return { page: 'change_record' };
  }
  if (name === 'navigate_production_plan') {
    await agentClick('.nav-link[data-page="plan"]', '打开生产作业计划');
    assertAgentScope(record, reqId);
    if (state.page !== 'plan' || $('#plan-page').classList.contains('hidden')) throw new Error('生产作业计划页面没有成功显示。');
    traceLine('已打开生产作业计划页面', true);
    return { page: 'production_plan' };
  }
  if (name === 'search_production_plan') {
    if (state.page !== 'plan' || $('#plan-page').classList.contains('hidden')) throw new Error('当前页面不是生产作业计划。');
    if (args.orderId !== record.orderId) throw new Error('查询订单与当前对象不一致。');
    await agentPasteIdentifier($('#plan-keyword'), args.orderId, '#copy-context-order', '订单号', record, reqId);
    await agentClick('#plan-search', '查询生产作业计划');
    const result = await state.planSearchPromise;
    assertAgentScope(record, reqId);
    if (!result || result.orderId !== record.orderId || $('#plan-keyword').value.trim() !== record.orderId || state.page !== 'plan') throw new Error('生产计划查询已失效或订单已切换。');
    if (Number($('#plan-count').textContent) !== result.matchCount) throw new Error('生产计划页面结果数量与查询不一致。');
    if (result.matchCount === 1) {
      const displayed = $('#plan-body tr')?.dataset.truckTeam?.trim() || '';
      if (displayed !== result.truckTeam) throw new Error('页面显示的大车班组与查询结果不一致。');
    }
    traceLine(result.matchCount === 1 && result.truckTeam ? '已核验生产计划大车班组：' + result.truckTeam : '生产计划未能唯一确认大车班组，请人工核对', true);
    return result;
  }
  if (name === 'read_all_teams' && !visibleChangePage()) {
    await agentClick('.nav-link[data-page="change"]', '返回变更记录');
    assertAgentScope(record, reqId);
  }
  if (!visibleChangePage()) throw new Error('当前页面不是变更记录，停止操作。');
  if (name === 'search_record') {
    if (args.orderId !== record.orderId || args.fileId !== record.fileId) throw new Error('查询订单或文件与当前对象不一致。');
    await agentPasteIdentifier($('#file-filter'), args.fileId, '#copy-context-file', '文件编号', record, reqId);
    await agentPasteIdentifier($('#order-filter'), args.orderId, '#copy-context-order', '订单号', record, reqId);
    await agentClick('#change-search', '点击查询');
    if ($('#file-filter').value !== record.fileId || $('#order-filter').value !== record.orderId) throw new Error('查询条件未按当前对象填写。');
    const row = $('#change-record-body').textContent || '';
    if (!row.includes(record.orderId) || !row.includes(record.fileId)) throw new Error('查询结果与当前订单或文件不一致。');
    traceLine('按 ' + record.fileId + ' / ' + record.orderId + ' 查询并核验唯一订单', true);
    await wait(80);
    return { orderId: record.orderId, fileId: record.fileId, found: true };
  }
  if (name === 'read_teams' || name === 'read_all_teams') {
    await agentClick('#team-reset', '清空筛选');
    await agentClick(name === 'read_all_teams' ? '#read-all' : '#read-teams', name === 'read_all_teams' ? '全部读取候选班组' : '读取候选班组');
    assertAgentScope(record, reqId);
    const rows = $$('#teams-body tr');
    const teams = rows.map(tr => ({
      id: tr.querySelector('.team-check')?.dataset.id,
      name: tr.cells[1]?.textContent.trim(),
      status: tr.dataset.status,
    }));
    if (!state.loaded || teams.length !== visibleReadTeams().length || teams.some(t => !t.id || !t.name || !t.status)) {
      throw new Error('候选班组读取不完整。');
    }
    traceLine((name === 'read_all_teams' ? '从页面全部读取 ' : '从页面初次读取 ') + teams.length + ' 个候选班组（其中 ' + teams.filter(t => t.status === '未下发').length + ' 个可分析）', true);
    progress(2, '正在读取班组');
    await wait(80);
    return { orderId: record.orderId, fileId: record.fileId, teams };
  }
  if (name === 'recommend_teams') {
    if (!state.loaded || !Array.isArray(args.recommendations)) throw new Error('尚未读取班组或建议格式无效。');
    const recs = args.recommendations;
    const inputs = $$('.team-check:not(:disabled)');
    for (const input of inputs) {
      assertAgentScope(record, reqId);
      if (!visibleChangePage()) throw new Error('页面已切换，停止勾选。');
      const target = recs.find(r => r.teamId === input.dataset.id);
      const shouldCheck = Boolean(target && target.decision === 'recommend');
      if (input.checked !== shouldCheck) {
        const teamName = input.closest('tr')?.cells[1]?.innerText.trim() || '';
        await agentClick(input, '勾选 ' + teamName);
      }
      if (input.checked !== shouldCheck) throw new Error('班组勾选状态未按预期更新。');
    }
    const selectedTeamIds = $$('.team-check:checked').map(el => el.dataset.id);
    const recommended = recs.filter(r => r.decision === 'recommend').length;
    traceLine('按建议在页面勾选 ' + selectedTeamIds.length + ' 个班组（建议下发 ' + recommended + ' 个）', true);
    progress(2, '正在勾选班组');
    await wait(100);
    return { orderId: record.orderId, fileId: record.fileId, selectedTeamIds };
  }
  throw new Error('模型请求了不允许的网页操作。');
}

async function runAgentTask(payload, record, reqId) {
  const started = await api('/api/agent/start', payload);
  if (!started.taskId) throw new Error('Agent 服务未返回任务编号。');
  const url = '/api/agent/tasks/' + encodeURIComponent(started.taskId);
  state.activeTaskUrl = url;
  try {
    for (;;) {
      const status = await api(url);
      if (status.status === 'failed') throw Object.assign(new Error(status.error || 'Agent 任务执行失败。'), { code: status.code });
      if (status.status === 'completed') { assertAgentScope(record, reqId); return status.result; }
      if (status.status === 'waiting' && status.action) {
        const action = status.action;
        let result;
        try {
          result = await executeAgentAction(action, record, reqId);
          assertAgentScope(record, reqId);
        } catch (err) {
          try { await api(url + '/ack', { actionId: action.id, ok: false, error: err.message }); } catch (_) {}
          throw err;
        }
        await api(url + '/ack', { actionId: action.id, ok: true, result });
      } else if (reqId !== state.requestId) {
        throw new Error('当前订单或文件已切换，停止后续操作。');
      }
      await wait(450);
    }
  } catch (err) {
    try { await api(url + '/cancel', {}); } catch (_) {}
    throw err;
  } finally {
    if (state.activeTaskUrl === url) state.activeTaskUrl = null;
  }
}

/* ================= 对话 ================= */
function setComposerBusy(busy) {
  $('#send-chat').disabled = busy;
  $('#chat-input').disabled = busy;
  $('#chat-input').placeholder = busy ? 'AI 正在处理，请稍候…' : '继续问，比如：演示涂装甲组为什么不下发？（Enter 发送，Shift+Enter 换行）';
  if (state.planEl) syncPlan();
}
async function sendChat() {
  if (!state.current) { toast('请先选择一个订单文件'); return; }
  if (!state.analysis) { toast('请先点击“AI 智能分析”，完成整单规划后再提问'); return; }
  if (state.busy) { toast('AI 正在处理，请稍候'); return; }
  const input = $('#chat-input');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  user(value);
  state.busy = true;
  setComposerBusy(true);
  const record = { ...state.current };
  const reqId = state.requestId;
  state.lastRetrieval = null;
  const viewer = streamBubble();
  let reply = '';
  try {
    reply = await streamChat(value, chatContext(record), viewer, reqId);
    viewer.done();
    if (!reply.trim()) throw new Error('模型未返回有效文本。');
  } catch (err) {
    if (!reply.trim()) {
      try {
        const data = await api('/api/chat', { message: value, context: chatContext(record) });
        reply = data.reply || data.answer || '';
        if (data.retrieval) state.lastRetrieval = data.retrieval;
        viewer.set(reply);
        viewer.done();
      } catch (fallbackError) {
        viewer.error(fallbackError.message);
        state.busy = false;
        setComposerBusy(false);
        return;
      }
    } else {
      viewer.done();
      note('输出中断：' + err.message);
    }
  }
  if (reqId !== state.requestId) { state.busy = false; setComposerBusy(false); return; }
  state.history.push({ role: 'user', content: value }, { role: 'assistant', content: reply });
  if (state.history.length > 24) state.history = state.history.slice(-24);
  retrievalCard(state.lastRetrieval, '本轮检索依据（BM25）');
  state.busy = false;
  setComposerBusy(false);
}
function streamBubble() {
  const wrap = document.createElement('div');
  wrap.className = 'entry bot';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = '✦';
  const bubble = document.createElement('div');
  bubble.className = 'bubble streaming';
  wrap.append(avatar, bubble);
  appendEntry(wrap);
  return {
    set(text) { bubble.innerHTML = formatText(text); scrollBottom(); },
    error(message) { bubble.classList.remove('streaming'); bubble.textContent = message; bubble.style.color = '#a94442'; },
    done() { bubble.classList.remove('streaming'); },
  };
}
function chatContext(record) {
  const areas = $$('#stream .js-extracted');
  return {
    orderId: record.orderId,
    fileId: record.fileId,
    documentText: areas.length ? areas[areas.length - 1].value : '',
    history: state.history,
    plan: state.plan,
  };
}
async function streamChat(value, context, viewer, reqId) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: value, context }),
  });
  if (!response.ok || !response.body) throw new Error('流式接口不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let payload;
        try { payload = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
        if (payload.retrieval) state.lastRetrieval = payload.retrieval;
        if (payload.error) throw new Error(payload.error);
        if (payload.delta) {
          if (reqId !== state.requestId) return full;
          full += payload.delta;
          viewer.set(full);
        }
        if (payload.done && payload.reply) { full = payload.reply; viewer.set(full); }
      }
    }
  }
  return full;
}

/* ================= 审批下发 ================= */
function openConfirm() {
  if (!state.current) return;
  if (!state.analysis || !state.analysisId) { toast('请先点击“AI 智能分析”，完成整单规划后再审批'); return; }
  if (state.correctionDirty) { toast('识别内容已修改，请先重新分析'); return; }
  if (state.busy) { toast('AI 正在处理，请稍候'); return; }
  const teams = currentTeams();
  const selected = teams.filter(t => state.selected.has(t.id) && t.status === '未下发');
  if (!selected.length) { toast('请先勾选需要下发的班组'); return; }
  const review = ((state.plan?.review) || []).filter(r => !selected.some(t => t.id === r.teamId));
  const changed = selected.filter(t => reasonOf(t.id).decision !== 'dispatch');
  const tags = selected.map(t => '<span class="team-tag">' + esc(t.name) + '</span>').join('');
  const warn = review.length
    ? '<div class="confirm-warning">还有 ' + review.length + ' 个班组 AI 无法充分判断，本次不下发：' +
      esc(review.map(r => r.name).join('、')) + '。如需下发，请返回名单将其加入。</div>'
    : '';
  const diff = changed.length
    ? '<div class="confirm-warning">其中 ' + changed.length + ' 个班组与 AI 建议不同（' + esc(changed.map(t => t.name).join('、')) + '），将按你的决定下发。</div>'
    : '';
  const noEvidence = selected.filter(t => (reasonOf(t.id).evidenceDetail || {}).status === 'incomplete');
  const evidenceWarn = noEvidence.length
    ? '<div class="confirm-warning">其中 ' + noEvidence.length + ' 个班组缺少可回看的变更原文或计划字段（' + esc(noEvidence.map(t => t.name).join('、')) + '），下发前请人工确认依据。</div>'
    : '';
  const reviewSaved = state.reviewSaved && state.reviewSaved.analysisId === state.analysisId;
  const saveWarn = reviewSaved ? '' : '<div class="confirm-warning">审批意见尚未保存，确认时会先写入审批记录。</div>';
  $('#confirm-content').innerHTML =
    '<div class="row"><span>文件编号</span><b>' + esc(state.current.fileId) + '</b></div>' +
    '<div class="row"><span>订单号</span><b>' + esc(state.current.orderId) + '</b></div>' +
    '<div class="row"><span>下发班组</span><div style="flex:1"><div class="team-tags">' + tags + '</div></div></div>' +
    '<div class="row"><span>下发数量</span><b>' + selected.length + ' 个</b></div>' +
    warn + diff + evidenceWarn + saveWarn +
    '<div class="row"><span>说明</span><span class="muted">确认后仅更新当前页面状态。</span></div>';
  $('#confirm-modal').classList.remove('hidden');
}

async function confirmDispatch() {
  if (!state.current) return;
  const button = $('#confirm-dispatch');
  button.disabled = true;
  const selectedIds = currentTeams().filter(t => state.selected.has(t.id) && t.status === '未下发').map(t => t.id);
  try {
    if (!state.reviewSaved || state.reviewSaved.analysisId !== state.analysisId) {
      const saved = await saveReview();
      if (!saved) { button.disabled = false; return; }
    }
    const data = await api('/api/dispatch', { orderId: state.current.orderId, fileId: state.current.fileId, teamIds: selectedIds });
    state.teamsByRecord[recordKey(state.current)] = data.teams;
    state.dispatched.add(recordKey(state.current));
    state.planDispatched = true;
    state.lastDispatched = { ids: selectedIds.slice(), at: data.dispatchedAt };
    state.current.dispatchedAt = data.dispatchedAt;
    state.selected = new Set();
    state.loaded = true;
    renderTeams();
    renderRecords();
    $('#confirm-modal').classList.add('hidden');
    bot('已按你的审批完成下发：' + data.teams.filter(t => selectedIds.includes(t.id)).map(t => t.name).join('、') + '，共 ' + selectedIds.length + ' 个班组。');
    if (Array.isArray(data.unresolved) && data.unresolved.length) {
      note('仍为待确认（未记为已确认不下发）：' + data.unresolved.join('、') + '。');
    }
    note('文件 ' + state.current.fileId + ' 已处理完成，AI 不会重复分析该文件。');
    progress(3, '已完成下发');
    if (state.planEl) {
      state.planEl.classList.add('approved');
      syncPlan();
    }
    toast('下发完成');
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

/* ================= 基础 ================= */
async function api(path, body) {
  let resp;
  try {
    resp = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (_) { throw new Error('无法连接本地服务，请确认服务已经启动。'); }
  let data;
  try { data = await resp.json(); } catch (_) { throw new Error('服务返回内容无法解析。'); }
  if (!resp.ok || data.ok === false) throw Object.assign(new Error(data.error || data.message || ('请求失败（' + resp.status + '）')), { code: data.code });
  return data;
}
function clearReportPreview() {
  state.reportVersion = (state.reportVersion || 0) + 1;
  state.changePreviewVersion = (state.changePreviewVersion || 0) + 1;
  state.previewEpoch = (state.previewEpoch || 0) + 1;
  state.reportCacheKey = null;
  if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
  if (state.changeObjectUrl) { URL.revokeObjectURL(state.changeObjectUrl); state.changeObjectUrl = null; }
  $('#pdf-inline').removeAttribute('src');
  $('#pdf-frame').removeAttribute('src');
  $('#mini-pdf').classList.add('hidden');
  $('#pdf-modal').classList.add('hidden');
}
async function loadReport() {
  if (!state.current) throw new Error('请先选择订单文件');
  if (!state.analysisId || state.correctionDirty || state.busy) throw new Error('请先完成当前记录的 AI 分析，再预览报告。');
  const record = { ...state.current }, analysisId = state.analysisId, version = state.reportVersion || 0;
  const cacheKey = JSON.stringify([record.orderId, record.fileId, analysisId]);
  if (state.objectUrl && state.reportCacheKey === cacheKey) return state.objectUrl;
  const params = new URLSearchParams({orderId: record.orderId, fileId: record.fileId, analysisId});
  const res = await fetch('/api/report?' + params.toString(), {cache: 'no-store'});
  if (!res.ok) {
    let message = '报告暂不可用，请重新分析。';
    try { const data = await res.json(); message = data.error || message; } catch (_) {}
    throw new Error(message);
  }
  const blob = await res.blob();
  if (version !== (state.reportVersion || 0) || !state.current || recordKey(record) !== recordKey(state.current) || state.analysisId !== analysisId) throw new Error('记录或分析结果已变化，请重新预览。');
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  state.reportCacheKey = cacheKey;
  return state.objectUrl;
}
async function showPdf() {
  if (!state.current) { toast('请先选择订单文件'); return; }
  if (!state.analysisId || state.correctionDirty || state.busy) { toast('请先完成当前记录的 AI 分析，再预览报告。'); return; }
  state.changePreviewVersion = (state.changePreviewVersion || 0) + 1;
  const previewEpoch = state.previewEpoch = (state.previewEpoch || 0) + 1;
  $('#pdf-title').textContent = '变更智达：生产变更分析报告';
  $('#pdf-label').textContent = state.current.orderId + ' · ' + state.current.fileId + ' · 报告为 AI 分析结果，不包含人工勾选调整';
  $('#pdf-modal').classList.remove('hidden');
  $('#pdf-frame').classList.add('hidden');
  $('#pdf-empty').classList.remove('hidden');
  $('#pdf-empty').textContent = '正在生成分析报告…';
  try {
    const url = await loadReport();
    if (previewEpoch !== state.previewEpoch || $('#pdf-modal').classList.contains('hidden')) return;
    $('#pdf-frame').src = url;
    $('#pdf-empty').classList.add('hidden');
    $('#pdf-frame').classList.remove('hidden');
  } catch (err) {
    if (previewEpoch === state.previewEpoch && !$('#pdf-modal').classList.contains('hidden')) $('#pdf-empty').textContent = err.message;
  }
}
async function showChangePdf(record = state.current) {
  if (!record) { toast('请先选择订单文件'); return; }
  const version = state.changePreviewVersion = (state.changePreviewVersion || 0) + 1;
  const previewEpoch = state.previewEpoch = (state.previewEpoch || 0) + 1;
  $('#pdf-title').textContent = '变更要求预览';
  $('#pdf-label').textContent = record.orderId + ' · ' + record.fileId + ' · 根据变更记录生成';
  $('#pdf-modal').classList.remove('hidden');
  $('#pdf-frame').classList.add('hidden');
  $('#pdf-empty').classList.remove('hidden');
  $('#pdf-empty').textContent = '正在生成变更要求预览…';
  try {
    const params = new URLSearchParams({orderId: record.orderId, fileId: record.fileId});
    const res = await fetch('/api/change-document?' + params.toString(), {cache:'no-store'});
    if (!res.ok) {
      let message = '变更要求预览暂不可用。';
      try { const data = await res.json(); message = data.error || message; } catch (_) {}
      throw new Error(message);
    }
    const blob = await res.blob();
    if (version !== state.changePreviewVersion || previewEpoch !== state.previewEpoch || $('#pdf-modal').classList.contains('hidden')) return;
    if (state.changeObjectUrl) URL.revokeObjectURL(state.changeObjectUrl);
    state.changeObjectUrl = URL.createObjectURL(blob);
    $('#pdf-frame').src = state.changeObjectUrl;
    $('#pdf-empty').classList.add('hidden');
    $('#pdf-frame').classList.remove('hidden');
  } catch (err) {
    if (version === state.changePreviewVersion && previewEpoch === state.previewEpoch && !$('#pdf-modal').classList.contains('hidden')) $('#pdf-empty').textContent = err.message;
  }
}
async function loadState() {
  try {
    const data = await api('/api/state');
    state.backendCurrent = data.serverVersion === SERVER_VERSION;
    $('#version-warning').classList.toggle('hidden', state.backendCurrent);
    state.records = (data.records || []).map(r => ({ ...r }));
    state.teamsByRecord = {};
    state.dispatched = new Set();
    for (const r of state.records) {
      state.teamsByRecord[recordKey(r)] = (r.teams || []).map(t => ({ ...t }));
      if (r.dispatchedAt) state.dispatched.add(recordKey(r));
    }
    state.modelConfigured = Boolean(data.modelConfigured);
    $('#model-status').textContent = state.modelConfigured ? (data.modelName || '已配置') : '未配置';
    if (state.records.length) selectRecord(state.records[0].orderId, state.records[0].fileId);
    else renderRecords();
  } catch (err) {
    $('#model-status').textContent = '服务不可用';
    toast(err.message);
  }
}

/* ================= 事件绑定 ================= */
function showAssistant() {
  if (!state.current) { toast('请先选择一个订单文件'); return; }
  $('#assistant').classList.remove('hidden');
  $('#drawer-shade').classList.remove('hidden');
  if (recordDispatched(state.current)) { note('该文件已完成下发，AI 不再自动重复分析。'); progress(3, '已完成下发'); return; }
  if (!state.analysis && !state.busy) runAnalysis();
}
function closeAssistant() {
  hideCursor();
  $('#assistant').classList.add('hidden');
  $('#drawer-shade').classList.add('hidden');
}
$$('[data-page]').forEach(el => el.addEventListener('click', () => page(el.dataset.page)));
$('#search').addEventListener('click', renderRecords);
$('#search-input').addEventListener('keydown', e => { if (e.key === 'Enter') renderRecords(); });
$('#reset-search').addEventListener('click', () => { $('#search-input').value = ''; renderRecords(); });
$('#refresh').addEventListener('click', () => location.reload());
$('#reset-demo').addEventListener('click', async () => {
  const button = $('#reset-demo');
  button.disabled = true;
  try {
    const data = await api('/api/reset', {});
    toast('已重置 ' + data.records.length + ' 条记录的状态');
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(err.message);
    button.disabled = false;
  }
});
$('#open-assistant').addEventListener('click', showAssistant);
$('#open-assistant-2').addEventListener('click', showAssistant);
$('#top-ai').addEventListener('click', showAssistant);
$('#close-assistant').addEventListener('click', closeAssistant);
$('#toggle-agent').addEventListener('click', () => {
  agent.enabled = !agent.enabled;
  $('#toggle-agent').textContent = '操作动画：' + (agent.enabled ? '开' : '关');
  if (!agent.enabled) hideCursor();
});
$('#copy-context-file').addEventListener('click', () => { agent.copyPromise = copyIdentifier($('#context-file').textContent); });
$('#copy-context-order').addEventListener('click', () => { agent.copyPromise = copyIdentifier($('#context-order').textContent); });
$('#preview-button').addEventListener('click', showPdf);
$('#preview-change-button').addEventListener('click', () => showChangePdf());
$('#change-preview').addEventListener('click', showPdf);
$('#open-pdf').addEventListener('click', showPdf);
$('#toggle-pdf').addEventListener('click', async () => {
  const box = $('#mini-pdf');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  try {
    const url = await loadReport();
    const note = box.querySelector('p');
    if (note) note.textContent = 'AI 分析结果，不包含人工勾选调整';
    $('#pdf-inline').title = '生产变更分析报告预览';
    $('#pdf-inline').src = url;
    box.classList.remove('hidden');
    scrollBottom();
  } catch (err) { toast(err.message); }
});
$$('[data-close]').forEach(el => el.addEventListener('click', () => {
  $('#' + el.dataset.close).classList.add('hidden');
  if (el.dataset.close === 'pdf-modal') {
    state.changePreviewVersion = (state.changePreviewVersion || 0) + 1;
    state.previewEpoch = (state.previewEpoch || 0) + 1;
  }
}));
$('#change-search').addEventListener('click', () => {
  const file = $('#file-filter').value.trim();
  const order = $('#order-filter').value.trim();
  if (!file || !order) {
    state.changeQueryValid = false;
    state.loaded = false;
    renderChange();
    renderTeams();
    toast('请粘贴文件编号与订单号后查询');
    return;
  }
  const matches = state.records.filter(r => (!file || r.fileId === file) && (!order || r.orderId === order));
  if (matches.length === 1) {
    state.loaded = false;
    selectRecord(matches[0].orderId, matches[0].fileId, { preserveQuery: true });
    state.changeQueryValid = true;
    state.loaded = false;
    renderChange();
    renderTeams();
    toast('已查询当前文件与订单，请点击“读取”加载候选班组');
  } else {
    state.changeQueryValid = false;
    state.loaded = false;
    state.selected = new Set();
    $('#change-record-body').innerHTML = '';
    $('#change-count').textContent = '0';
    renderTeams();
    toast(matches.length ? '请同时填写文件编号和订单号，确定唯一订单' : '未找到匹配的记录');
  }
});
$('#change-reset').addEventListener('click', () => {
  $('#file-filter').value = '';
  $('#order-filter').value = '';
  delete $('#file-filter').dataset.manualPaste;
  delete $('#order-filter').dataset.manualPaste;
  state.changeQueryValid = false;
  state.loaded = false;
  state.selected = new Set();
  renderChange();
  renderTeams();
});
for (const el of [$('#file-filter'), $('#order-filter')]) {
  el.addEventListener('input', event => {
    el.dataset.manualPaste = event.isTrusted && event.inputType === 'insertFromPaste' ? '1' : '';
    state.changeQueryValid = false;
    state.loaded = false;
    state.selected = new Set();
    $('#change-record-body').innerHTML = '';
    renderTeams();
  });
}
function readTeams(mode = 'initial') {
  if (!state.current) { toast('请先选择订单文件'); return; }
  const file = $('#file-filter').value.trim();
  const order = $('#order-filter').value.trim();
  const matched = state.records.find(r => r.orderId === order && r.fileId === file);
  if (!state.changeQueryValid || !matched || matched.orderId !== state.current.orderId || matched.fileId !== state.current.fileId) { toast('请先粘贴文件编号与订单号并查询'); return; }
  if (mode === 'all') $('#team-filter').value = '';
  state.changeQueryValid = true;
  state.readMode = mode;
  state.loaded = true;
  renderTeams();
  toast(mode === 'all' ? '已全部读取候选班组' : '已初次读取候选班组');
}
$('#read-teams').addEventListener('click', () => readTeams('initial'));
$('#read-all').addEventListener('click', () => readTeams('all'));
$('#plan-search').addEventListener('click', () => {
  state.planSearchPromise = queryProductionPlan().catch(err => {
    $('#plan-body').innerHTML = '<tr><td colspan="19" class="plan-empty">' + esc(err.message) + '</td></tr>';
    $('#plan-count').textContent = '0';
    toast(err.message);
    return null;
  });
});
$('#plan-keyword').addEventListener('input', () => {
  state.planSearchVersion++;
  state.planSearchResult = null;
});
$('#plan-keyword').addEventListener('input', event => {
  event.target.dataset.manualPaste = event.isTrusted && event.inputType === 'insertFromPaste' ? '1' : '';
});
$('#plan-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') $('#plan-search').click(); });
$('#plan-reset').addEventListener('click', () => {
  $('#plan-keyword').value = '';
  state.planSearchVersion++;
  state.planSearchResult = null;
  $('#plan-count').textContent = '0';
  $('#plan-body').innerHTML = '<tr><td colspan="19" class="plan-empty">请输入订单号查询生产作业计划</td></tr>';
});
$('#team-search').addEventListener('click', renderTeams);
$('#team-filter').addEventListener('keydown', e => { if (e.key === 'Enter') renderTeams(); });
$('#team-reset').addEventListener('click', () => { $('#team-filter').value = ''; renderTeams(); });
$('#select-all').addEventListener('change', e => {
  $$('.team-check:not(:disabled)').forEach(input => { if (input.checked !== e.target.checked) input.click(); });
  syncPlan();
});
$('#dispatch').addEventListener('click', openConfirm);
$('#confirm-dispatch').addEventListener('click', confirmDispatch);
$('#send-chat').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$$('.quick-chips button').forEach(b => b.addEventListener('click', () => {
  $('#chat-input').value = b.dataset.q;
  sendChat();
}));

// 未实现的入口统一禁用并说明，避免产生"似乎成功"的假反馈。
const supported = new Set(['top-ai', 'search', 'reset-search', 'preview-button', 'preview-change-button', 'copy-context-file', 'copy-context-order', 'open-assistant', 'open-assistant-2', 'refresh', 'change-search', 'change-reset', 'change-preview', 'team-search', 'team-reset', 'read-teams', 'read-all', 'plan-search', 'plan-reset', 'dispatch', 'close-assistant', 'open-pdf', 'toggle-pdf', 'send-chat', 'confirm-dispatch', 'select-all', 'toggle-agent', 'reset-demo']);
$$('button').forEach(btn => {
  if (!btn.id || supported.has(btn.id)) return;
  btn.disabled = true;
  btn.title = '该功能在当前版本中未实现';
});
$('#select-all').disabled = true;

loadState();
