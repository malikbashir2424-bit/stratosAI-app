// netlify/functions/fixtures.js
exports.handler = async function (event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key on server." }) };
  }
  const apiHeaders = { "x-apisports-key": API_KEY };

  const LEAGUE_PRIORITY = {
    1:   100, 2:   95,  3:   90,  848: 88,
    39:  85,  140: 83,  135: 81,  78:  79,
    61:  77,  94:  75,  88:  73,  203: 72,
    4:   70,  5:   70,  6:   68,  9:   65,
    10:  63,  13:  60,  15:  60,  29:  55,
    30:  55,  34:  55,  45:  55,  48:  55,
  };

  function leaguePriority(leagueId) {
    return LEAGUE_PRIORITY[leagueId] || 40;
  }

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API request failed: " + res.status);
    return res.json();
  }

  try {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    let fixtures = [];

    // 1. Today: get LIVE + upcoming (NS) matches
    const liveStatuses = 'NS-LIVE-1H-2H-HT-ET-BT-P';
    try {
      const todayStr = fmt(today);
      const data = await api(`/fixtures?date=${todayStr}&status=${liveStatuses}`);
      if (data.response && data.response.length) {
        fixtures = fixtures.concat(data.response);
      }
    } catch(e) {}

    // 2. Next 6 days - NS only
    for (let i = 1; i <= 6 && fixtures.length < 40; i++) {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      try {
        const data = await api(`/fixtures?date=${date}&status=NS`);
        if (data.response && data.response.length) {
          fixtures = fixtures.concat(data.response);
        }
      } catch (e) {}
    }

    // 3. If still empty, try yesterday's finished matches as fallback
    if (fixtures.length === 0) {
      try {
        const yesterday = fmt(new Date(today.getTime() - 86400000));
        const data = await api(`/fixtures?date=${yesterday}&status=FT`);
        if (data.response && data.response.length) {
          fixtures = fixtures.concat(data.response.slice(0, 10));
        }
      } catch(e) {}
    }

    // Deduplicate
    const seen = new Set();
    fixtures = fixtures.filter(f => {
      if (seen.has(f.fixture.id)) return false;
      seen.add(f.fixture.id);
      return true;
    });

    // Filter to priority leagues if we have enough
    const priorityLeagues = Object.keys(LEAGUE_PRIORITY).map(Number);
    const filtered = fixtures.filter(f => priorityLeagues.includes(f.league.id));
    if (filtered.length >= 5) fixtures = filtered;

    // Sort: live first, then by priority, then by kickoff
    const liveSet = new Set(['1H','2H','HT','ET','BT','P','LIVE']);
    fixtures.sort((a, b) => {
      const aLive = liveSet.has(a.fixture.status.short) ? 1 : 0;
      const bLive = liveSet.has(b.fixture.status.short) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive; // live first
      const pa = leaguePriority(a.league.id);
      const pb = leaguePriority(b.league.id);
      if (pb !== pa) return pb - pa;
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
      leaguePriority: leaguePriority(f.league.id),
      homeId: f.teams.home.id,
      home: f.teams.home.name,
      homeLogo: f.teams.home.logo,
      homeGoals: f.goals ? f.goals.home : null,
      awayId: f.teams.away.id,
      away: f.teams.away.name,
      awayLogo: f.teams.away.logo,
      awayGoals: f.goals ? f.goals.away : null,
    }));

    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
