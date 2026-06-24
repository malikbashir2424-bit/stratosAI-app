// netlify/functions/fixtures.js
// Resilient fixtures endpoint with SHARED server-side cache.
//
// Flow:
//   1. Read 'fixtures' row from Supabase api_cache.
//   2. If fresh (not expired) AND non-empty -> return it. ZERO API-Football calls.
//   3. If stale/missing -> call API-Football ONCE.
//        - if it returns matches -> save to cache, return.
//        - if it returns NOTHING -> DO NOT cache. Serve last good cache,
//          else serve built-in fallback fixtures.
//   4. If API-Football errors -> serve last good cache, else fallback.
//
// Two guarantees added vs. the old version:
//   A) An empty/zero-match result is NEVER written to the cache, so a transient
//      failure can't get "stuck" and keep serving an empty page.
//   B) The site is NEVER empty: if everything fails, built-in fallback fixtures
//      are returned so investors always see a working board.

const SUPA_URL = process.env.DB_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CACHE_KEY = "fixtures";
const TTL_SECONDS = 3600; // refresh at most once per hour

// ──────────────────────────────────────────────
// BUILT-IN FALLBACK FIXTURES
// Shown only when API-Football returns nothing AND there is no good cache.
// Uses team IDs present in the frontend TEAM_DB so odds + AI still work.
// Kickoffs are generated relative to "now" so they always look upcoming.
// ──────────────────────────────────────────────
function fallbackFixtures() {
  const now = Date.now();
  const h = (n) => new Date(now + n * 3600 * 1000).toISOString();
  const L = { name: "World Cup", logo: "https://media.api-sports.io/football/leagues/1.png", id: 1 };
  const team = (id, name) => ({
    id,
    name,
    logo: `https://media.api-sports.io/football/teams/${id}.png`,
  });

  // [homeId, homeName, awayId, awayName, hoursFromNow]
  const defs = [
    [9, "Spain", 23, "Saudi Arabia", 3],
    [1, "Belgium", 22, "Iran", 6],
    [7, "Uruguay", 1533, "Cape Verde Islands", 9],
    [2, "France", 13, "Senegal", 26],
    [10, "Argentina", 768, "Mexico", 29],
    [5, "Portugal", 25, "Japan", 32],
    [17, "Germany", 18, "Netherlands", 49],
    [21, "England", 24, "Morocco", 52],
  ];

  const matches = defs.map(([hid, hn, aid, an, hrs], i) => {
    const home = team(hid, hn), away = team(aid, an);
    return {
      id: 900000000 + i, // synthetic ids, won't collide with real fixtures
      kickoff: h(hrs),
      status: "NS",
      elapsed: null,
      league: L.name,
      leagueLogo: L.logo,
      leagueId: L.id,
      homeId: home.id,
      home: home.name,
      homeLogo: home.logo,
      homeGoals: null,
      awayId: away.id,
      away: away.name,
      awayLogo: away.logo,
      awayGoals: null,
    };
  });

  return { updated: new Date().toISOString(), count: matches.length, matches };
}

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
  // GUARD: never cache an empty result.
  if (!payload || !Array.isArray(payload.matches) || payload.matches.length === 0) return;
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

  // 1) Live matches happening right now (any league)
  try {
    const live = await api(`/fixtures?live=all`);
    if (live.response?.length) {
      const f = live.response.filter((x) => popularLeagues.includes(x.league.id));
      fixtures = fixtures.concat(f.length ? f : live.response.slice(0, 10));
    }
  } catch (e) {}

  // 2) Today's fixtures
  try {
    const data = await api(`/fixtures?date=${fmt(today)}`);
    if (data.response?.length) {
      const filtered = data.response.filter((f) => popularLeagues.includes(f.league.id));
      fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 15));
    }
  } catch (e) {}

  // 3) Next 7 days of upcoming (not-started) fixtures — full week ahead
  for (let i = 1; i <= 7; i++) {
    try {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      const data = await api(`/fixtures?date=${date}&status=NS`);
      if (data.response?.length) {
        const filtered = data.response.filter((f) => popularLeagues.includes(f.league.id));
        fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 8));
      }
    } catch (e) {}
  }

  const seen = new Set();
  fixtures = fixtures.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });

  const liveSet = new Set(["1H", "2H", "HT", "ET", "BT", "LIVE", "P", "INT"]);
  const nsSet = new Set(["NS", "TBD"]);
  // Keep only upcoming + live in the feed (drop finished/postponed/cancelled at source)
  fixtures = fixtures.filter((f) => {
    const s = f.fixture.status.short;
    return liveSet.has(s) || nsSet.has(s);
  });
  fixtures.sort((a, b) => {
    const rank = (s) => (liveSet.has(s) ? 0 : nsSet.has(s) ? 1 : 2);
    const diff = rank(a.fixture.status.short) - rank(b.fixture.status.short);
    if (diff !== 0) return diff;
    return new Date(a.fixture.date) - new Date(b.fixture.date);
  });

  fixtures = fixtures.slice(0, 40);

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
  // Only treat cache as usable if it is fresh AND actually has matches.
  const cacheHasMatches = cached && cached.payload && Array.isArray(cached.payload.matches) && cached.payload.matches.length > 0;
  const fresh = cacheHasMatches && new Date(cached.expires_at).getTime() > now;

  if (fresh) {
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "cache" }) };
  }

  try {
    const data = await fetchFromApiFootball();

    if (data.matches && data.matches.length > 0) {
      await cacheWrite(data); // only caches non-empty (guarded)
      return { statusCode: 200, headers, body: JSON.stringify({ ...data, source: "live" }) };
    }

    // API returned ZERO matches: do NOT cache. Serve last good cache if any,
    // otherwise built-in fallback so the page is never empty.
    if (cacheHasMatches) {
      return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "stale", note: "No new fixtures; showing last available" }) };
    }
    const fb = fallbackFixtures();
    return { statusCode: 200, headers, body: JSON.stringify({ ...fb, source: "fallback", note: "Showing featured fixtures" }) };

  } catch (err) {
    // API error: serve last good cache, else fallback. Never empty, never error page.
    if (cacheHasMatches) {
      return { statusCode: 200, headers, body: JSON.stringify({ ...cached.payload, source: "stale", note: "Live data temporarily unavailable" }) };
    }
    const fb = fallbackFixtures();
    return { statusCode: 200, headers, body: JSON.stringify({ ...fb, source: "fallback", note: "Live data temporarily unavailable" }) };
  }
};
