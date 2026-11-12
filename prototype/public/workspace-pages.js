/* 配套页面只读取现有接口，订单处理仍使用原有页面。 */
(function () {
  'use strict';

  const root = document.getElementById('workspace-pages');
  if (!root) return;

  const names = { overview: '处理总览', records: '变更单报表', issues: '问题跟踪', reviews: '审批记录' };
  const views = {
    records: { query: '', filter: 'all', page: 1, size: 20 },
    issues: { query: '', filter: 'all', page: 1, size: 20 },
    reviews: { query: '', filter: 'all', page: 1, size: 20 },
  };
  let records = [];
  let hasLoadedRecords = false;
  let activePage = '';
  let loadVersion = 0;
  let reviewVersion = 0;
  let selectedReview = '';

  const heading = (title, description) => `
    <div class="wp-heading">
      <div><div class="wp-eyebrow">生产变更管理</div><h1>${title}</h1><p>${description}</p></div>
      <button class="btn wp-refresh" type="button" data-wp-refresh>刷新数据</button>
    </div>`;

  const pager = name => `
    <div class="wp-pager" data-pager="${name}">
      <span class="wp-count"></span>
      <div class="wp-pager-actions">
        <label>每页 <select class="wp-page-size" aria-label="每页条数"><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
        <button type="button" class="btn" data-wp-prev="${name}">上一页</button>
        <span class="wp-page-number"></span>
        <button type="button" class="btn" data-wp-next="${name}">下一页</button>
      </div>
    </div>`;

  root.innerHTML = `
    <section class="page wp-page hidden" data-wp-page="overview">
      ${heading('处理总览', '围绕订单和变更文件查看处理进度与资料情况。')}
      <div class="wp-notice" data-wp-notice role="status"></div>
      <div class="wp-stat-grid">
        <button class="wp-stat" type="button" data-wp-go="records" data-wp-filter="all"><span>订单文件记录</span><strong data-wp-stat="total">—</strong><small>查看全部记录 →</small></button>
        <button class="wp-stat" type="button" data-wp-go="records" data-wp-filter="dispatched"><span>已下发</span><strong data-wp-stat="dispatched">—</strong><small>当前服务状态 →</small></button>
        <button class="wp-stat" type="button" data-wp-go="issues" data-wp-filter="all"><span>资料待核查</span><strong data-wp-stat="issues">—</strong><small>查看问题清单 →</small></button>
        <button class="wp-stat" type="button" data-wp-go="reviews" data-wp-filter="all"><span>已保存审批</span><strong data-wp-stat="reviews">—</strong><small>查看审批记录 →</small></button>
      </div>
      <div class="wp-overview-grid">
        <section class="wp-panel">
          <div class="wp-panel-head"><div><h2>资料核查</h2><p>不同问题可能出现在同一条记录中。</p></div><button class="wp-link" type="button" data-wp-go="issues">查看全部</button></div>
          <div class="wp-issue-summary">
            <button type="button" data-wp-go="issues" data-wp-filter="missingChange"><span class="wp-mark warn">!</span><span><b>缺少变更后内容</b><small>需核对并补充变更资料</small></span><strong data-wp-stat="missingChange">—</strong><i>›</i></button>
            <button type="button" data-wp-go="issues" data-wp-filter="missingTeams"><span class="wp-mark danger">!</span><span><b>缺少候选班组</b><small>需核对当前订单班组</small></span><strong data-wp-stat="missingTeams">—</strong><i>›</i></button>
            <button type="button" data-wp-go="issues" data-wp-filter="difference"><span class="wp-mark blue">≠</span><span><b>资料差异待核</b><small>需对照原始资料确认</small></span><strong data-wp-stat="difference">—</strong><i>›</i></button>
          </div>
        </section>
        <section class="wp-panel wp-guide">
          <div class="wp-panel-head"><div><h2>处理入口</h2><p>按订单和文件查看，再进入变更助手。</p></div></div>
          <button type="button" data-wp-go="records"><span class="wp-guide-icon">▤</span><span><b>查找变更记录</b><small>按订单号或文件编号定位</small></span><i>›</i></button>
          <button type="button" data-wp-go="issues"><span class="wp-guide-icon orange">!</span><span><b>核对待处理资料</b><small>集中查看缺失及差异</small></span><i>›</i></button>
          <button type="button" data-wp-go="reviews"><span class="wp-guide-icon green">✓</span><span><b>查看审批记录</b><small>核对已保存意见和下发名单</small></span><i>›</i></button>
        </section>
      </div>
      <p class="wp-footnote">统计按订单与文件的组合计算，已下发为当前服务中的状态。</p>
    </section>

    <section class="page wp-page hidden" data-wp-page="records">
      ${heading('变更单报表', '按订单与文件查看现有记录，支持筛选和分页。')}
      <div class="wp-notice" data-wp-notice role="status"></div>
      <div class="wp-panel">
        <form class="wp-filters" data-wp-form="records">
          <label>关键字 <input name="query" type="search" placeholder="订单号、文件编号或产品规格"></label>
          <label>记录范围 <select name="filter"><option value="all">全部记录</option><option value="undispatched">未下发</option><option value="dispatched">已下发</option><option value="issue">资料待核查</option><option value="reviewed">已保存审批</option></select></label>
          <button class="btn green" type="submit">查询</button><button class="btn" type="button" data-wp-reset="records">清空</button>
          <button class="btn wp-export" type="button" data-wp-export>导出当前筛选 CSV</button>
        </form>
        <div class="wp-table-wrap"><table class="wp-table"><thead><tr><th>订单号</th><th>文件编号</th><th>产品规格</th><th>候选班组</th><th>当前状态</th><th>资料情况</th><th>操作</th></tr></thead><tbody data-wp-body="records"></tbody></table></div>
        ${pager('records')}
      </div>
      <p class="wp-footnote">每行对应一个订单和文件的组合；状态以当前服务返回的数据为准。</p>
    </section>

    <section class="page wp-page hidden" data-wp-page="issues">
      ${heading('问题跟踪', '集中查看需要核对的变更资料。')}
      <div class="wp-notice" data-wp-notice role="status"></div>
      <div class="wp-panel">
        <form class="wp-filters" data-wp-form="issues">
          <label>关键字 <input name="query" type="search" placeholder="订单号或文件编号"></label>
          <label>问题类型 <select name="filter"><option value="all">全部问题</option><option value="missingChange">缺变更后内容</option><option value="missingTeams">缺候选班组</option><option value="difference">资料差异待核</option></select></label>
          <button class="btn green" type="submit">查询</button><button class="btn" type="button" data-wp-reset="issues">清空</button>
        </form>
        <div class="wp-table-wrap"><table class="wp-table"><thead><tr><th>订单号</th><th>文件编号</th><th>需要核对</th><th>当前状态</th><th>操作</th></tr></thead><tbody data-wp-body="issues"></tbody></table></div>
        ${pager('issues')}
      </div>
      <p class="wp-footnote">问题根据已有资料标记生成；同一条记录可以有多项问题。</p>
    </section>

    <section class="page wp-page hidden" data-wp-page="reviews">
      ${heading('审批记录', '查看已保存的审批意见与对应的下发名单。')}
      <div class="wp-notice" data-wp-notice role="status"></div>
      <div class="wp-panel">
        <form class="wp-filters" data-wp-form="reviews">
          <label>关键字 <input name="query" type="search" placeholder="订单号或文件编号"></label>
          <label>当前状态 <select name="filter"><option value="all">全部</option><option value="undispatched">未下发</option><option value="dispatched">已下发</option></select></label>
          <button class="btn green" type="submit">查询</button><button class="btn" type="button" data-wp-reset="reviews">清空</button>
        </form>
        <div class="wp-table-wrap"><table class="wp-table"><thead><tr><th>订单号</th><th>文件编号</th><th>审批保存时间</th><th>当前状态</th><th>操作</th></tr></thead><tbody data-wp-body="reviews"></tbody></table></div>
        ${pager('reviews')}
      </div>
      <div class="wp-panel wp-review-detail" data-wp-review-detail><div class="wp-empty-detail">选择一条记录，查看审批明细。</div></div>
      <p class="wp-footnote">每条订单文件显示最近保存的一份审批；当前下发状态和已保存审批分别查看。</p>
    </section>`;

  function node(tag, className, value) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined && value !== null) result.textContent = String(value);
    return result;
  }

  function button(text, className, action) {
    const result = node('button', className, text);
    result.type = 'button';
    result.addEventListener('click', action);
    return result;
  }

  function candidateCount(record) {
    if (Number.isFinite(record.teamCount) && record.teamCount >= 0) return record.teamCount;
    return Array.isArray(record.teams) ? record.teams.length : null;
  }

  function issuesOf(record) {
    const issues = [];
    if (record.missingChangeContent) issues.push({ key: 'missingChange', label: '缺变更后内容', style: 'warn' });
    if (candidateCount(record) === 0) issues.push({ key: 'missingTeams', label: '缺候选班组', style: 'danger' });
    if (record.differenceFlag) issues.push({ key: 'difference', label: '资料差异待核', style: 'blue' });
    return issues;
  }

  function matches(record, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [record.orderId, record.fileId, record.sourceFileId, record.filename, record.productType]
      .some(value => String(value || '').toLowerCase().includes(needle));
  }

  function filtered(name) {
    const view = views[name];
    return records.filter(record => {
      if (!matches(record, view.query)) return false;
      const issues = issuesOf(record);
      if (name === 'issues') return issues.length > 0 && (view.filter === 'all' || issues.some(issue => issue.key === view.filter));
      if (name === 'reviews' && !record.reviewSavedAt) return false;
      if (view.filter === 'dispatched') return Boolean(record.dispatchedAt);
      if (view.filter === 'undispatched') return !record.dispatchedAt;
      if (view.filter === 'issue') return issues.length > 0;
      if (view.filter === 'reviewed') return Boolean(record.reviewSavedAt);
      return true;
    });
  }

  function updateOverview() {
    const counts = {
      total: records.length,
      dispatched: records.filter(record => record.dispatchedAt).length,
      issues: records.filter(record => issuesOf(record).length).length,
      reviews: records.filter(record => record.reviewSavedAt).length,
      missingChange: records.filter(record => record.missingChangeContent).length,
      missingTeams: records.filter(record => candidateCount(record) === 0).length,
      difference: records.filter(record => record.differenceFlag).length,
    };
    for (const element of root.querySelectorAll('[data-wp-stat]')) {
      element.textContent = counts[element.dataset.wpStat].toLocaleString('zh-CN');
    }
  }

  function statusCell(record) {
    const cell = node('td');
    cell.append(node('span', 'wp-badge ' + (record.dispatchedAt ? 'ok' : 'neutral'), record.dispatchedAt ? '已下发' : '未下发'));
    return cell;
  }

  function issueCell(record) {
    const cell = node('td');
    const issues = issuesOf(record);
    if (!issues.length) cell.append(node('span', 'wp-muted', '无已标记问题'));
    for (const issue of issues) cell.append(node('span', 'wp-badge ' + issue.style, issue.label));
    return cell;
  }

  function textCell(value, className) {
    const display = value === null || value === undefined || value === '' ? '—' : String(value);
    const cell = node('td', className, display);
    cell.title = display === '—' ? '' : display;
    return cell;
  }

  function openRecord(record) {
    if (typeof state !== 'undefined' && state.busy) {
      if (typeof toast === 'function') toast('助手正在处理，请稍候再切换订单。');
      return;
    }
    if (!document.getElementById('assistant').classList.contains('hidden')) {
      if (typeof toast === 'function') toast('请先收起助手，再切换订单。');
      return;
    }
    if (typeof state === 'undefined' || !state.records.some(item => item.orderId === record.orderId && item.fileId === record.fileId)) {
      if (typeof toast === 'function') toast('记录尚未载入，请刷新页面后重试。');
      return;
    }
    document.getElementById('search-input').value = record.fileId;
    document.querySelector('.nav-link[data-page="receive"]').click();
    document.getElementById('search').click();
    if (typeof selectRecord === 'function') selectRecord(record.orderId, record.fileId);
  }

  function renderRow(name, record) {
    const row = node('tr');
    row.append(textCell(record.orderId), textCell(record.fileId));
    if (name === 'records') {
      row.append(textCell(record.productType, 'wp-product'), textCell(candidateCount(record)), statusCell(record), issueCell(record));
    } else if (name === 'issues') {
      row.append(issueCell(record), statusCell(record));
    } else {
      row.append(textCell(record.reviewSavedAt), statusCell(record));
    }
    const action = node('td', 'wp-actions');
    if (name === 'reviews') action.append(button('查看审批', 'wp-link', () => loadReview(record)));
    else action.append(button('去处理', 'wp-link', () => openRecord(record)));
    row.append(action);
    return row;
  }

  function renderTable(name) {
    const view = views[name];
    const matches = filtered(name);
    const totalPages = Math.max(1, Math.ceil(matches.length / view.size));
    view.page = Math.min(Math.max(view.page, 1), totalPages);
    const body = root.querySelector(`[data-wp-body="${name}"]`);
    body.replaceChildren();
    const items = matches.slice((view.page - 1) * view.size, view.page * view.size);
    if (!items.length) {
      const row = node('tr');
      const cell = node('td', 'wp-empty', name === 'reviews' ? '暂无符合条件的审批记录' : '暂无符合条件的记录');
      cell.colSpan = name === 'records' ? 7 : 5;
      row.append(cell);
      body.append(row);
    } else {
      for (const record of items) body.append(renderRow(name, record));
    }
    const controls = root.querySelector(`[data-pager="${name}"]`);
    controls.querySelector('.wp-count').textContent = `共 ${matches.length} 条`;
    controls.querySelector('.wp-page-number').textContent = `${view.page} / ${totalPages}`;
    controls.querySelector('[data-wp-prev]').disabled = view.page <= 1;
    controls.querySelector('[data-wp-next]').disabled = view.page >= totalPages;
    controls.querySelector('.wp-page-size').value = String(view.size);
    const form = root.querySelector(`[data-wp-form="${name}"]`);
    form.elements.query.value = view.query;
    form.elements.filter.value = view.filter;
  }

  function updateAll() {
    updateOverview();
    for (const name of Object.keys(views)) renderTable(name);
  }

  function showNotice(message, isError) {
    for (const notice of root.querySelectorAll('[data-wp-notice]')) {
      notice.textContent = message;
      notice.classList.toggle('is-error', Boolean(isError));
      notice.classList.toggle('shown', Boolean(message));
    }
  }

  async function loadData() {
    const version = ++loadVersion;
    showNotice('正在读取记录…');
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('服务返回异常');
      const data = await response.json();
      if (!Array.isArray(data.records)) throw new Error('记录格式不正确');
      if (version !== loadVersion) return;
      records = data.records;
      hasLoadedRecords = true;
      updateAll();
      showNotice('');
    } catch (error) {
      if (version !== loadVersion) return;
      const message = hasLoadedRecords
        ? '记录读取失败，当前显示上次读取的数据；请检查服务后刷新。'
        : '记录读取失败，请检查服务后点击“刷新数据”。';
      showNotice(message, true);
    }
  }

  function hideWorkspace() {
    activePage = '';
    for (const page of root.querySelectorAll('[data-wp-page]')) page.classList.add('hidden');
    for (const nav of document.querySelectorAll('.workspace-nav')) nav.classList.remove('active');
    const tab = document.querySelector('.workspace-tab');
    tab.classList.add('hidden');
    tab.classList.remove('active');
  }

  function clearReviewDetail() {
    reviewVersion += 1;
    selectedReview = '';
    root.querySelector('[data-wp-review-detail]').replaceChildren(node('div', 'wp-empty-detail', '选择一条记录，查看审批明细。'));
  }

  function showPage(name) {
    if (!names[name]) return;
    if (typeof state !== 'undefined' && state.busy) {
      if (typeof toast === 'function') toast('助手正在处理，请稍候再切换页面。');
      return;
    }
    activePage = name;
    for (const page of document.querySelectorAll('#receive-page,#plan-page,#change-page')) page.classList.add('hidden');
    for (const page of root.querySelectorAll('[data-wp-page]')) page.classList.toggle('hidden', page.dataset.wpPage !== name);
    for (const nav of document.querySelectorAll('.nav-link,.tab,.workspace-nav')) nav.classList.remove('active');
    const selected = document.querySelector(`.workspace-nav[data-workspace-page="${name}"]`);
    if (selected) selected.classList.add('active');
    const tab = document.querySelector('.workspace-tab');
    tab.textContent = names[name];
    tab.classList.remove('hidden');
    tab.classList.add('active');
    if (views[name]) renderTable(name);
    loadData();
  }

  function reviewKey(record) {
    return JSON.stringify([record.orderId, record.fileId]);
  }

  function reviewList(title, values) {
    const section = node('div', 'wp-review-group');
    section.append(node('h3', '', title));
    section.append(node('p', '', values.length ? values.join('、') : '无'));
    return section;
  }

  async function loadReview(record) {
    const version = ++reviewVersion;
    selectedReview = reviewKey(record);
    const detail = root.querySelector('[data-wp-review-detail]');
    detail.replaceChildren(node('div', 'wp-empty-detail', '正在读取审批记录…'));
    try {
      const query = new URLSearchParams({ orderId: record.orderId, fileId: record.fileId });
      const response = await fetch('/api/review?' + query.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error('审批记录读取失败');
      const data = await response.json();
      if (version !== reviewVersion || selectedReview !== reviewKey(record)) return;
      detail.replaceChildren();
      if (!data.review) {
        detail.append(node('div', 'wp-empty-detail', '当前记录没有已保存的审批意见。'));
        return;
      }
      const review = data.review;
      const title = node('div', 'wp-panel-head');
      const titleText = node('div');
      titleText.append(node('h2', '', '审批明细'), node('p', '', `${record.orderId} · ${record.fileId} · 保存于 ${review.savedAt || '未知时间'}`));
      title.append(titleText, button('去处理', 'btn', () => openRecord(record)));
      detail.append(title);
      if (data.draft) detail.append(node('div', 'wp-review-alert', '这份审批与当前分析不一致或当前没有有效分析，继续处理前请重新核对。'));
      if (review.dispatch && !record.dispatchedAt) detail.append(node('div', 'wp-review-alert', '审批记录中有下发记录，但当前服务未显示已下发，请核对。'));
      const decisions = Array.isArray(review.decisions) ? review.decisions : [];
      const actualIds = Array.isArray(review.dispatch?.finalTeamIds) ? review.dispatch.finalTeamIds : null;
      const reviewedIds = decisions.filter(item => item.decision === 'dispatch').map(item => String(item.teamId));
      if (actualIds && decisions.length && [...actualIds].map(String).sort().join('|') !== reviewedIds.sort().join('|')) {
        detail.append(node('div', 'wp-review-alert', '审批明细与下发名单不一致，请核对。'));
      }
      const groups = node('div', 'wp-review-groups');
      const namesById = new Map((record.teams || []).map(team => [String(team.id), team.name]));
      for (const item of decisions) if (item.teamId && item.name) namesById.set(String(item.teamId), item.name);
      const actualNames = actualIds ? actualIds.map(id => namesById.get(String(id)) || String(id)) : [];
      groups.append(reviewList(actualIds ? '记录中的下发名单' : '审批中选择下发', actualIds ? actualNames : decisions.filter(item => item.decision === 'dispatch').map(item => item.name)));
      groups.append(reviewList('审批时标记待确认', decisions.filter(item => item.decision === 'review').map(item => item.name)));
      detail.append(groups);
      if (review.note) detail.append(node('p', 'wp-review-note', '整单说明：' + review.note));
      if (decisions.length) {
        const wrap = node('div', 'wp-table-wrap');
        const table = node('table', 'wp-table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['班组', 'AI 建议', '审批结论', '原因']) headRow.append(node('th', '', label));
        head.append(headRow);
        const body = document.createElement('tbody');
        const labels = { dispatch: '下发', hold: '不下发', review: '待确认' };
        for (const item of decisions) {
          const row = document.createElement('tr');
          row.append(textCell(item.name), textCell(labels[item.aiDecision] || item.aiDecision), textCell(labels[item.decision] || item.decision), textCell(item.reason));
          body.append(row);
        }
        table.append(head, body);
        wrap.append(table);
        detail.append(wrap);
      }
    } catch (error) {
      if (version !== reviewVersion) return;
      detail.replaceChildren(node('div', 'wp-empty-detail', '审批记录读取失败，请稍后重试。'));
    }
  }

  function csvValue(value) {
    let text = String(value == null ? '' : value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportRecords() {
    const rows = [['订单号', '文件编号', '产品规格', '候选班组数', '当前状态', '资料情况']];
    for (const record of filtered('records')) {
      rows.push([record.orderId, record.fileId, record.productType, candidateCount(record), record.dispatchedAt ? '已下发' : '未下发', issuesOf(record).map(issue => issue.label).join('；') || '无已标记问题']);
    }
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvValue).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = '变更单报表.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  for (const nav of document.querySelectorAll('[data-workspace-page]')) {
    nav.addEventListener('click', () => showPage(nav.dataset.workspacePage));
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-page]')) hideWorkspace();
  }, true);
  for (const form of root.querySelectorAll('[data-wp-form]')) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const name = form.dataset.wpForm;
      views[name].query = form.elements.query.value;
      views[name].filter = form.elements.filter.value;
      views[name].page = 1;
      if (name === 'reviews') clearReviewDetail();
      renderTable(name);
    });
  }
  root.addEventListener('change', event => {
    const select = event.target.closest('.wp-page-size');
    if (!select) return;
    const name = select.closest('[data-pager]').dataset.pager;
    views[name].size = Number(select.value);
    views[name].page = 1;
    if (name === 'reviews') clearReviewDetail();
    renderTable(name);
  });
  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-wp-refresh')) {
      if (activePage === 'reviews') clearReviewDetail();
      return void loadData();
    }
    if (target.hasAttribute('data-wp-export')) return void exportRecords();
    if (target.dataset.wpGo) {
      const name = target.dataset.wpGo;
      if (views[name]) {
        views[name].filter = target.dataset.wpFilter || 'all';
        views[name].query = '';
        views[name].page = 1;
      }
      return void showPage(name);
    }
    const reset = target.dataset.wpReset;
    if (reset) {
      views[reset].query = '';
      views[reset].filter = 'all';
      views[reset].page = 1;
      if (reset === 'reviews') clearReviewDetail();
      return void renderTable(reset);
    }
    const previous = target.dataset.wpPrev;
    if (previous) { views[previous].page -= 1; if (previous === 'reviews') clearReviewDetail(); return void renderTable(previous); }
    const next = target.dataset.wpNext;
    if (next) { views[next].page += 1; if (next === 'reviews') clearReviewDetail(); return void renderTable(next); }
  });
}());
