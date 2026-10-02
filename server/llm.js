// OpenCode Zen, OpenAI-compatible chat completions with tool calling.

const BASE_URL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';
const API_KEY = process.env.OPENCODE_API_KEY || process.env.PENCODE_API_KEY;
export const MODEL = process.env.OPENCODE_MODEL || 'deepseek-v4.1-flash';
const TIMEOUT_MS = 45000;

export const hasLlmKey = () => Boolean(API_KEY);

export async function chat(messages, tools, { signal } = {}) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0.7, max_tokens: 1200 }),
    signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenCode ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data.choices[0].message;
}
