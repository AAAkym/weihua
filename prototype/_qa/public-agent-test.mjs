import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local mock model: verifies the workflow only, never calls an external model.
const mock = http.createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const { messages = [] } = JSON.parse(body);
  let message;
  if (!messages.some(item => item.role === 'tool')) {
    const roster = messages[0].content.split('\n').find(line => line.includes('需要你判断的候选班组')) || '';
    const teams = [...roster.matchAll(/(team-\d+)\s+([^；\n]+)/g)];
    const recommendations = teams.map(([, teamId, name]) => ({ teamId, decision: 'review', reason: `测试桩：${name}需核对`, evidence: '虚构测试数据' }));
    message = { role: 'assistant', content: null, tool_calls: [{ id: 'stub', type: 'function', function: { name: 'recommend_teams', arguments: JSON.stringify({ recommendations }) } }] };
  } else {
    message = { role: 'assistant', content: JSON.stringify({ summary: '本地测试', changes: [{ text: '演示变更', component: '演示部件', state: '', reason: '', source: '虚构文件' }] }) };
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message }] }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const reviewStore = path.join(mkdtempSync(path.join(tmpdir(), 'weihua-demo-')), 'review.json');
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd: root,
  env: { ...process.env, PORT: String(port), MODEL_BASE_URL: `http://127.0.0.1:${mockPort}`, MODEL_NAME: 'local-stub', MODEL_API_KEY: 'mock-local-only', MODEL_VISION: '0', REVIEW_STORE: reviewStore },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', chunk => { logs += chunk.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || String(response.status)), { code: data.code });
  return data;
}
try {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { state = await request('/api/state'); break; } catch { await sleep(100); }
  }
  assert.ok(state, `Server did not start: ${logs}`);
  const item = state.records.find(record => record.fileId === 'DEMO-2026-001');
  const started = await request('/api/agent/start', { orderId: item.orderId, fileId: item.fileId });
  let result;
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = await request(`/api/agent/tasks/${started.taskId}`);
    if (status.status === 'failed') throw Object.assign(new Error(status.error), { code: status.code });
    if (status.status === 'completed') { result = status.result; break; }
    if (status.status === 'waiting') {
      const action = status.action;
      let payload;
      switch (action.name) {
        case 'navigate_production_plan': payload = { page: 'production_plan' }; break;
        case 'search_production_plan': {
          const plan = await request('/api/production-plan?orderId=' + encodeURIComponent(item.orderId));
          assert.equal(plan.planFields['大车班组'], '演示桥架甲组');
          payload = { orderId: item.orderId, matchCount: plan.matchCount, truckTeam: plan.truckTeam }; break;
        }
        case 'navigate_change_record': payload = { page: 'change_record' }; break;
        case 'search_record': payload = { orderId: item.orderId, fileId: item.fileId, found: true }; break;
        case 'read_teams':
        case 'read_all_teams': payload = { orderId: item.orderId, fileId: item.fileId, teams: item.teams }; break;
        case 'recommend_teams': payload = { orderId: item.orderId, fileId: item.fileId, selectedTeamIds: action.args.recommendations.filter(entry => entry.decision === 'recommend').map(entry => entry.teamId) }; break;
        default: throw new Error(`Unexpected action: ${action.name}`);
      }
      await request(`/api/agent/tasks/${started.taskId}/ack`, { actionId: action.id, ok: true, result: payload });
    }
    await sleep(20);
  }
  assert.ok(result, 'Agent task timed out');
  assert.equal(result.mode, 'independent_analysis');
  assert.ok(result.extractedText.includes('DEMO-ORDER-001'));
  assert.ok(result.references.some(name => name.startsWith('演示')));
  const pending = item.teams.filter(team => team.status === '未下发');
  assert.equal(result.plan.review.length, pending.length);
  const review = await request('/api/review', {
    orderId: item.orderId, fileId: item.fileId, analysisId: result.analysisId,
    decisions: pending.map(team => ({ teamId: team.id, decision: 'review', reason: '虚构样例，等待人工核对' })),
  });
  assert.equal(review.review.unresolvedTeamIds.length, pending.length);
  console.log('公开演示版验证通过：本地模拟模型、页面操作、分析和人工审核');
} finally {
  child.kill();
  await new Promise(resolve => mock.close(resolve));
}
