// Real agent client. Streams events from the backend's /api/chat.
// Falls back to the mock agent (sample places) when no backend is reachable,
// e.g. on the static GitHub Pages site.

const API_BASE = (window.LUNCH_UNCLE_API || '').replace(/\/$/, '');

let backendCheck = null;
function backendAvailable() {
  backendCheck ??= fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => Boolean(d?.ok))
    .catch(() => false);
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
