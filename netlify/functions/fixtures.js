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
  const popularLeagues = [1, 39, 140, 135, 78, 61, 2, 3, 4, 5, 6, 9, 10, 13, 15, 29, 30, 34, 45, 48];

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API request failed: " + res.status);
    return res.json();
  }

  try {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    let fixtures = [];

    // Try multiple status combinations for each day
    const statusGroups = ['NS', 'NS-TBD-PST', '1H-2H-HT-ET-BT-LIVE'];

    for (let i = 0; i <= 6 && fixtures.length < 10; i++) {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      for (let s = 0; s < statusGroups.length && fixtures.length < 10; s++) {
        try {
          const data = await api(`/fixtures?date=${date}&status=${statusGroups[s]}`);
          if (data.response && data.response.length) {
            const filtered = data.response.filter(f => popularLeagues.includes(f.league.id));
            fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 5));
          }
        } catch (e) {}
      }
    }

    // Deduplicate
    const seen = new Set();
    fixtures = fixtures.filter(f => {
      if (seen.has(f.fixture.id)) return false;
      seen.add(f.fixture.id);
      return true;
    });

    // Sort: live first, then NS, then by kickoff
    const liveSet = new Set(['1H','2H','HT','ET','BT','LIVE']);
    fixtures.sort((a, b) => {
      const aLive = liveSet.has(a.fixture.status.short) ? 0 : 1;
      const bLive = liveSet.has(b.fixture.status.short) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
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
      homeGoals: f.goals ? f.goals.home : null,
      awayId: f.teams.away.id,
      away: f.teams.away.name,
      awayLogo: f.teams.away.logo,
      awayGoals: f.goals ? f.goals.away : null,
    }));

    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
