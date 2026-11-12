import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reserve = createServer();
await new Promise((resolve, reject) => reserve.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd: root,
  env: { ...process.env, PORT: String(port), MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_API_KEY: '', MODEL_VISION: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stderr.on('data', chunk => { output += chunk.toString(); });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { ready = (await fetch(`${base}/api/state`)).ok; } catch { /* waiting for startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server did not start: ${output}`);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /变更/);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.modelConfigured, false);
  assert.equal(state.records.length, 3);
  for (const record of state.records) {
    assert.match(record.orderId, /^DEMO-ORDER-/);
    assert.match(record.fileId, /^DEMO-2026-/);
    assert.equal(record.documentAvailable, true);
    assert.ok(record.teams.length > 0);
    assert.ok(record.teams.every(team => team.name.startsWith('演示')));
    const result = await (await fetch(`${base}/api/production-plan?orderId=${encodeURIComponent(record.orderId)}`)).json();
    assert.equal(result.matchCount, 1);
    assert.equal(result.truckTeam, '演示桥架甲组');
    const pdf = await fetch(`${base}/api/documents/${encodeURIComponent(record.fileId)}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  }
  const knowledge = await (await fetch(`${base}/api/knowledge/search?q=${encodeURIComponent('接线')}`)).json();
  assert.ok(knowledge.count > 0);
  assert.ok(knowledge.results.every(item => item.file.startsWith('演示')));
  const sample = fileURLToPath(new URL('../documents/DEMO-2026-001.pdf', import.meta.url));
  const extractor = fileURLToPath(new URL('../lib/pdf_extract.py', import.meta.url));
  const extracted = spawnSync(process.env.PYTHON || 'python', [extractor, sample], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(extracted.status, 0, extracted.stdout || extracted.stderr);
  assert.ok(JSON.parse(extracted.stdout).pages[0].text.includes('DEMO-ORDER-001'));
  console.log('公开演示版验证通过：页面、3 个虚构订单、计划、知识检索和 PDF 文本层');
} finally {
  child.kill();
}
