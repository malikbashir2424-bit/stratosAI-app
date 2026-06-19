exports.handler = async function (event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600"
  };
  if (!API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key." }) };
  const apiHeaders = { "x-apisports-key": API_KEY };
  const popularLeagues = [1, 39, 140, 135, 78, 61, 2, 3, 4, 5, 6, 9, 10, 13, 15, 29, 30, 34, 45, 48, 17, 88, 94, 203];

  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API failed: " + res.status);
    return res.json();
  }

  try {
    const fmt = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    let fixtures = [];

    // Get today ALL statuses - no filter
    try {
      const data = await api(`/fixtures?date=${fmt(today)}`);
      if (data.response?.length) {
        const filtered = data.response.filter(f => popularLeagues.includes(f.league.id));
        fixtures = filtered.length ? filtered : data.response.slice(0, 15);
      }
    } catch(e) {}

    // If less than 5, try next 3 days NS only
    for (let i = 1; i <= 3 && fixtures.length < 5; i++) {
      try {
        const date = fmt(new Date(today.getTime() + i * 86400000));
        const data = await api(`/fixtures?date=${date}&status=NS`);
        if (data.response?.length) {
          const filtered = data.response.filter(f => popularLeagues.includes(f.league.id));
          fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 5));
        }
      } catch(e) {}
    }

    // Deduplicate
    const seen = new Set();
    fixtures = fixtures.filter(f => { if (seen.has(f.fixture.id)) return false; seen.add(f.fixture.id); return true; });

    // Sort: live first, then NS, then FT
    const liveSet = new Set(['1H','2H','HT','ET','BT','LIVE']);
    const nsSet = new Set(['NS','TBD']);
    fixtures.sort((a, b) => {
      const rank = s => liveSet.has(s) ? 0 : nsSet.has(s) ? 1 : 2;
      const diff = rank(a.fixture.status.short) - rank(b.fixture.status.short);
      if (diff !== 0) return diff;
      return new Date(a.fixture.date) - new Date(b.fixture.date);
    });

    fixtures = fixtures.slice(0, 20);

    const matches = fixtures.map(f => ({
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

    return { statusCode: 200, headers, body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
