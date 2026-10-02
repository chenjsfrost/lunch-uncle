// Real agent client. Streams events from the backend's /api/chat.
// Falls back to the mock agent (sample places) when no backend is reachable,
// e.g. on the static GitHub Pages site.

const API_BASE = (window.LUNCH_UNCLE_API || '').replace(/\/$/, '');

// A free Render instance sleeps when idle and can take up to ~a minute to
// wake, so wait generously before giving up and falling back to demo mode.
const WAKE_TIMEOUT_MS = 75000;

let backendCheck = null;
let backendKnown = false;
function backendAvailable() {
  backendCheck ??= fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(WAKE_TIMEOUT_MS) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => Boolean(d?.ok))
    .catch(() => false)
    .finally(() => { backendKnown = true; });
  return backendCheck;
}

async function* readEvents(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let end;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (data) yield JSON.parse(data);
    }
  }
}

async function* runAgent(history, ctx) {
  if (!backendKnown) yield { type: 'status', text: 'Uncle waking up, wait ah…' };
  if (!(await backendAvailable())) {
    yield* mockRunAgent(history, ctx);
    return;
  }

  yield { type: 'tool_call', id: 'loc', name: 'get_user_location', label: 'Checking where you are' };
  const loc = await ctx.getLocation();
  yield { type: 'tool_result', id: 'loc', summary: `You're at ${loc.label}` };

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, location: { lat: loc.lat, lng: loc.lng } }),
  });
  if (res.status === 429) {
    yield { type: 'final', text: 'Wah, so many questions! Uncle need to catch his breath. Wait one minute then ask again ah.' };
    return;
  }
  if (!res.ok) throw new Error(`Backend ${res.status}`);

  for await (const ev of readEvents(res)) {
    if (ev.type === 'error') throw new Error(ev.message);
    yield ev;
  }
}
