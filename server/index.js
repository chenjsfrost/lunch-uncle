// Lunch Uncle backend: serves the app and runs the agent.
//   GET  /api/health  → { ok, model }
//   GET  /api/where?lat=&lng= → { label, landmark, area }, e.g. "near Bugis Street, Rochor"
//   POST /api/chat    → Server-Sent Events: status, tool_call, tool_result, final, error
//
// Run: npm start  (reads keys from .env)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from './agent.js';
import { MODEL, hasLlmKey } from './llm.js';
import { hasPlacesKey, whereAmI } from './places.js';

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only these files are served, so .env and server code never leave the machine.
const STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/config.js': 'config.js',
  '/app.js': 'app.js',
  '/api-agent.js': 'api-agent.js',
  '/mock-agent.js': 'mock-agent.js',
  '/routing.js': 'routing.js',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// Browsers on these origins may call the API (e.g. the GitHub Pages frontend).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://chenjsfrost.github.io')
  .split(',').map((s) => s.trim()).filter(Boolean);
const isAllowedOrigin = (o) => ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

// Simple per-IP limit so a public URL can't burn through the API keys.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 12;
const hits = new Map();

// Behind a proxy (Render), every request comes from the proxy's IP. The proxy
// appends the real client IP as the last X-Forwarded-For entry; earlier entries
// can be spoofed by the client, so only the last one is trusted.
const TRUST_PROXY = Boolean(process.env.TRUST_PROXY);
function clientIp(req) {
  const xff = TRUST_PROXY && req.headers['x-forwarded-for'];
  if (xff) return xff.split(',').pop().trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (now - times[times.length - 1] > 60000) hits.delete(key);
  }
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function readJson(req, limit = 50000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

function cleanOrigin(loc) {
  if (loc?.lat == null || loc?.lng == null || loc.lat === '' || loc.lng === '') return null;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function handleChat(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many requests. Uncle need to rest a while.' });

  let body;
  try { body = await readJson(req); } catch (err) { return sendJson(res, 400, { error: err.message }); }
  const history = cleanHistory(body.history);
  const origin = cleanOrigin(body.location);
  if (!history.length || history[history.length - 1].role !== 'user') return sendJson(res, 400, { error: 'Last message must be from the user' });
  if (!origin) return sendJson(res, 400, { error: 'Missing location' });
  if (typeof body.place === 'string' && body.place.trim()) origin.label = body.place.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const emit = (ev) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };

  try {
    await runAgent({ history, origin, emit, signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[chat]', err);
      emit({ type: 'error', message: 'Agent failed' });
    }
  }
  res.end();
}

async function handleWhere(req, res, url) {
  if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: 'Too many requests' });
  const origin = cleanOrigin({ lat: url.searchParams.get('lat'), lng: url.searchParams.get('lng') });
  if (!origin) return sendJson(res, 400, { error: 'Missing lat/lng' });
  try {
    sendJson(res, 200, await whereAmI(origin));
  } catch (err) {
    console.error('[where]', err.message);
    sendJson(res, 502, { error: 'Lookup failed' });
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res) {
  const file = STATIC[new URL(req.url, 'http://x').pathname];
  if (!file) return sendJson(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(path.join(ROOT, file));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  if (pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: hasLlmKey() && hasPlacesKey(), model: MODEL });
  if (pathname === '/api/where' && req.method === 'GET') return handleWhere(req, res, url);
  if (pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  sendJson(res, 405, { error: 'Method not allowed' });
});

if (!hasLlmKey()) console.warn('⚠️  OPENCODE_API_KEY is missing from .env');
if (!hasPlacesKey()) console.warn('⚠️  GOOGLE_PLACES_API_KEY is missing from .env');
server.listen(PORT, () => console.log(`Lunch Uncle running at http://localhost:${PORT} (model: ${MODEL})`));
