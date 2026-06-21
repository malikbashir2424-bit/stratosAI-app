// netlify/functions/fixtures.js
// Resilient fixtures endpoint with SHARED server-side cache.
//
// Flow:
//   1. Read 'fixtures' row from Supabase api_cache.
//   2. If fresh (not expired) -> return it. ZERO API-Football calls.
//   3. If stale/missing -> call API-Football ONCE, save to cache, return.
//   4. If API-Football fails -> serve the last cached copy (even if stale)
//      so the site never shows an empty page.
//
// Result: 10,000 users in an hour still cost only ~1 API-Football call.

const SUPA_URL = process.env.DB_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CACHE_KEY = "fixtures";
const TTL_SECONDS = 3600; // refresh at most once per hour

async function cacheRead() {
  if (!SUPA_URL || !SUPA_KEY) return null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/api_cache?cache_key=eq.${CACHE_KEY}&select=payload,expires_at`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch (e) {}
  return null;
}

async function cacheWrite(payload) {
  if (!SUPA_URL || !SUPA_KEY) return;
  const expires_at = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  try {
    await fetch(`${SUPA_URL}/rest/v1/api_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        cache_key: CACHE_KEY,
        payload,
        updated_at: new Date().toISOString(),
        expires_at,
      }),
    });
  } catch (e) {}
}

async function fetchFromApiFootball() {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  if (!API_KEY) throw new Error("Missing API key");
  const BASE = "https://v3.football.api-sports.io";
  const apiHeaders = { "x-apisports-key": API_KEY };
  const popularLeagues = [1, 39, 140, 135, 78, 61, 2, 3, 4, 5, 6, 9, 10, 13, 15, 29, 30, 34, 45, 48, 17, 88, 94, 203];

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API failed: " + res.status);
    return res.json();
  }

  const fmt = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  let fixtures = [];

  try {
    const data = await api(`/fixtures?date=${fmt(today)}`);
    if (data.response?.length) {
      const filtered = data.response.filter((f) => popularLeagues.includes(f.league.id));
      fixtures = filtered.length ? filtered : data.response.slice(0, 15);
    }
  } catch (e) {}

  for (let i = 1; i <= 3 && fixtures.length < 5; i++) {
    try {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      const data = await api(`/fixtures?date=${date}&status=NS`);
      if (data.response?.length) {
        const filtered = data.response.filter((f) => popularLeagues.includes(f.league.id));
        fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 5));
      }
    } catch (e) {}
  }

  const seen = new Set();
  fixtures = fixtures.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });

  const liveSet = new Set(["1H", "2H", "HT", "ET", "BT", "LIVE"]);
  const nsSet = new Set(["NS", "TBD"]);
  fixtures.sort((a, b) => {
    const rank = (s) => (liveSet.has(s) ? 0 : nsSet.has(s) ? 1 : 2);
    const diff = rank(a.fixture.status.short) - rank(b.fixture.status.short);
    if (diff !== 0) return diff;
    return new Date(a.fixture.date) - new Date(b.fixture.date);
  });

  fixtures = fixtures.slice(0, 20);

  const matches = fixtures.map((f) => ({
    id: f.fixture.id,
    kickoff: f.fixture.date,
    status: f.fixture.status.short,
    elapsed: f.fixture.status.elapsed,
    league: f.league.name,
    leagueLogo: f.league.logo,
    leagueId: f.league.id,
    homeId: f.teams.home.id,
    home: f.teams.home.name,
    homeLogo: f.teams.home.logo,
    homeGoals: f.goals?.home ?? null,
    awayId: f.teams.away.id,
    away: f.teams.away.name,
    awayLogo: f.teams.away.logo,
    awayGoals: f.goals?.away ?? null,
  }));

  return { updated: new Date().toISOString(), count: matches.length, matches };
}

exports.handler = async function () {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=900",
  };

  const cached = await cacheRead();
  const now = Date.now();
  const fresh = cached && new Date(cached.expires_at).getTime() > now;

  if (fresh) {
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "cache" }) };
  }

  try {
    const data = await fetchFromApiFootball();
    await cacheWrite(data);
    return { statusCode: 200, headers, body: JSON.stringify({ ...data, source: "live" }) };
  } catch (err) {
    if (cached && cached.payload) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ...cached.payload, source: "stale", note: "Live data temporarily unavailable" }),
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ updated: new Date().toISOString(), count: 0, matches: [], source: "empty", error: String(err) }),
    };
  }
};
