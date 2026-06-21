// netlify/functions/check-results.js
// Per-fixture live result with SHARED server-side cache.
// Each fixture is fetched from API-Football at most once per TTL window,
// no matter how many users are polling it. Graceful degrade on failure.

const SUPA_URL = process.env.DB_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const TTL_SECONDS = 300; // 5 min

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

async function cacheWrite(key, payload, ttl) {
  if (!SUPA_URL || !SUPA_KEY) return;
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
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
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=120, s-maxage=300",
  };

  const params = event.queryStringParameters || {};
  const fixtureId = parseInt(params.fixtureId);
  if (!fixtureId || fixtureId <= 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fixtureId." }) };
  }

  const key = `results:${fixtureId}`;
  const cached = await cacheRead(key);
  const fresh = cached && new Date(cached.expires_at).getTime() > Date.now();

  // If a finished result is cached, it never changes — serve forever.
  if (cached && cached.payload && cached.payload.finished) {
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "cache" }) };
  }
  if (fresh) {
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "cache" }) };
  }

  const API_KEY = process.env.API_FOOTBALL_KEY;
  if (!API_KEY) {
    if (cached) return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "stale" }) };
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key." }) };
  }

  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, {
      headers: { "x-apisports-key": API_KEY },
    });
    if (!res.ok) throw new Error("API failed: " + res.status);
    const data = await res.json();
    if (!data.response || !data.response.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Match not found." }) };
    }
    const match = data.response[0];
    const status = match.fixture.status.short;
    const homeGoals = match.goals.home;
    const awayGoals = match.goals.away;
    let result = null;
    if (status === "FT" || status === "AET" || status === "PEN") {
      if (homeGoals > awayGoals) result = "1";
      else if (homeGoals === awayGoals) result = "X";
      else result = "2";
    }
    const payload = {
      fixtureId,
      status,
      finished: result !== null,
      result,
      homeGoals,
      awayGoals,
      minute: match.fixture.status.elapsed,
      home: match.teams.home.name,
      away: match.teams.away.name,
    };
    // Finished results cached for 24h, live for 5 min
    await cacheWrite(key, payload, payload.finished ? 86400 : TTL_SECONDS);
    return { statusCode: 200, headers, body: JSON.stringify({ ...payload, source: "live" }) };
  } catch (err) {
    if (cached && cached.payload) {
      return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "stale" }) };
    }
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message) }) };
  }
};
