// netlify/functions/ai-analysis.js
// Secure proxy for per-match AI analysis. The Anthropic API key lives ONLY
// in Netlify env vars (ANTHROPIC_API_KEY) and is never exposed to the browser.
// Adds a SHARED cache so each match is analyzed by Claude at most once per
// 6 hours — protects the Claude budget under heavy load.

const SUPA_URL = process.env.DB_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const AI_TTL = 6 * 3600; // 6 hours

async function cacheRead(key) {
  if (!SUPA_URL || !SUPA_KEY) return null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/api_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload,expires_at`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch (e) {}
  return null;
}
async function cacheWrite(key, payload) {
  if (!SUPA_URL || !SUPA_KEY) return;
  const expires_at = new Date(Date.now() + AI_TTL * 1000).toISOString();
  try {
    await fetch(`${SUPA_URL}/rest/v1/api_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ cache_key: key, payload, updated_at: new Date().toISOString(), expires_at }),
    });
  } catch (e) {}
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "https://stratosai.bet",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "AI not configured" }) };

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const home = String(p.home || "").slice(0, 60);
  const away = String(p.away || "").slice(0, 60);
  const league = String(p.league || "").slice(0, 60);
  if (!home || !away) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing teams" }) };

  const hs = Number(p.hs) || 1.4, hc = Number(p.hc) || 1.2, hForm = String(p.hForm || "").slice(0, 10);
  const as = Number(p.as) || 1.4, ac = Number(p.ac) || 1.2, aForm = String(p.aForm || "").slice(0, 10);
  const hxg = Number(p.hxg) || 1.2, axg = Number(p.axg) || 1.0;

  // Shared cache: same match served to everyone without re-calling Claude
  const cacheKey = `ai:${home}-${away}-${league}`.toLowerCase().replace(/\s+/g, "_").slice(0, 180);
  const cached = await cacheRead(cacheKey);
  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return { statusCode: 200, headers, body: JSON.stringify(cached.payload) };
  }

  const prompt =
    `You are STRATOS AI, a professional football prediction engine.\n\n` +
    `Match: ${home} vs ${away} (${league})\n` +
    `${home}: avg ${hs} goals scored, ${hc} conceded, form ${hForm}, xG ${hxg}\n` +
    `${away}: avg ${as} goals scored, ${ac} conceded, form ${aForm}, xG ${axg}\n\n` +
    `Respond ONLY as valid JSON, no markdown: {"verdict":"[Team] Win OR Draw","confidence":"High/Medium/Low","analysis":"2-3 professional sentences","tip":"One sharp tactical observation"}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 320,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    const txt = (d.content || [])
      .map((c) => c.text || "")
      .join("")
      .trim()
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(txt);
    await cacheWrite(cacheKey, parsed); // save for everyone
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (e) {
    // Serve stale AI if we have it, else signal unavailable (frontend shows fallback)
    if (cached && cached.payload) {
      return { statusCode: 200, headers, body: JSON.stringify(cached.payload) };
    }
    return { statusCode: 502, headers, body: JSON.stringify({ error: "AI unavailable" }) };
  }
};
