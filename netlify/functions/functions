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
  async function api(path) {
    const res = await fetch(BASE + path, { headers: apiHeaders });
    if (!res.ok) throw new Error("API request failed: " + res.status);
    return res.json();
  }
  try {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    let fixtures = [];
    for (let i = 0; i <= 6 && fixtures.length < 10; i++) {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      try {
        const data = await api(`/fixtures?date=${date}&status=NS`);
        if (data.response && data.response.length) {
          const popularLeagues = [1, 39, 140, 135, 78, 61, 2, 3, 4, 5, 6, 9, 10, 13, 15, 29, 30, 34, 45, 48];
          const filtered = data.response.filter(f => popularLeagues.includes(f.league.id));
          fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 5));
        }
      } catch (e) { /* skip */ }
    }
    const seen = new Set();
    fixtures = fixtures.filter(f => {
      if (seen.has(f.fixture.id)) return false;
      seen.add(f.fixture.id);
      return true;
    });
    fixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    fixtures = fixtures.slice(0, 10);
    const matches = fixtures.map((f) => ({
      id: f.fixture.id,
      kickoff: f.fixture.date,
      league: f.league.name,
      leagueLogo: f.league.logo,
      homeId: f.teams.home.id,
      home: f.teams.home.name,
      homeLogo: f.teams.home.logo,
      awayId: f.teams.away.id,
      away: f.teams.away.name,
      awayLogo: f.teams.away.logo,
      leagueId: f.league.id,
    }));
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=900" },
      body: JSON.stringify({ updated: new Date().toISOString(), count: matches.length, matches }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
