import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';

// 将已明确配置的分享来源转到现有服务，保持同一份演示状态。
const target = 'http://127.0.0.1:4173';
const port = 4178;
const originFile = fileURLToPath(new URL('../data/trusted-public-origins.json', import.meta.url));
const proxy = httpProxy.createProxyServer({ target, changeOrigin: true });
proxy.on('error', (_err, _req, res) => {
  if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, code: 'BACKEND_UNAVAILABLE', error: '本地服务暂不可用。' }));
});
http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    let origins;
    try { origins = JSON.parse(readFileSync(originFile, 'utf8')); } catch { origins = []; }
    if (!Array.isArray(origins) || !origins.includes(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, code: 'ORIGIN_BLOCKED', error: '不允许从其他来源访问本地服务。' }));
    }
    req.headers.origin = target;
  }
  proxy.web(req, res);
}).listen(port, '127.0.0.1', () => console.log(`分享转发服务已启动：http://127.0.0.1:${port}`));
