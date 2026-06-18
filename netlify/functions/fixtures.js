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

  // League priority scores — higher = more important
  const LEAGUE_PRIORITY = {
    1:   100, // FIFA World Cup
    2:   95,  // UEFA Champions League
    3:   90,  // UEFA Europa League
    848: 88,  // UEFA Conference League
    39:  85,  // Premier League
    140: 83,  // La Liga
    135: 81,  // Serie A
    78:  79,  // Bundesliga
    61:  77,  // Ligue 1
    94:  75,  // Primeira Liga
    88:  73,  // Eredivisie
    203: 72,  // Super Lig
    4:   70,  // Euro Championship
    5:   70,  // UEFA Nations League
    6:   68,  // Copa America
    9:   65,  // Copa Libertadores
    10:  63,  // Copa Sudamericana
    13:  60,  // AFCON
    15:  60,  // FIFA Club World Cup
    29:  55,  // CAF Champions League
    30:  55,  // Asian Cup
    34:  55,  // J-League
    45:  55,  // FA Cup
    48:  55,  // League Cup
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

    // Fetch next 7 days until we have 40+ candidates
    for (let i = 0; i <= 6 && fixtures.length < 40; i++) {
      const date = fmt(new Date(today.getTime() + i * 86400000));
      try {
        const data = await api(`/fixtures?date=${date}&status=NS`);
        if (data.response && data.response.length) {
          const priorityLeagues = Object.keys(LEAGUE_PRIORITY).map(Number);
          const filtered = data.response.filter(f => priorityLeagues.includes(f.league.id));
          // If no priority leagues today, take top 8 by whatever is available
          fixtures = fixtures.concat(filtered.length ? filtered : data.response.slice(0, 8));
        }
      } catch (e) { /* skip day */ }
    }

    // Deduplicate
    const seen = new Set();
    fixtures = fixtures.filter(f => {
      if (seen.has(f.fixture.id)) return false;
      seen.add(f.fixture.id);
      return true;
    });

    // Sort by: 1) League priority (desc), 2) Kickoff time (asc)
    fixtures.sort((a, b) => {
      const pa = leaguePriority(a.league.id);
      const pb = leaguePriority(b.league.id);
      if (pb !== pa) return pb - pa; // higher priority first
      return new Date(a.fixture.date) - new Date(b.fixture.date); // earlier first
    });

    // Take top 20
    fixtures = fixtures.slice(0, 20);

    const matches = fixtures.map((f) => ({
      id: f.fixture.id,
      kickoff: f.fixture.date,
      league: f.league.name,
      leagueLogo: f.league.logo,
      leagueId: f.league.id,
      leaguePriority: leaguePriority(f.league.id),
      homeId: f.teams.home.id,
      home: f.teams.home.name,
      homeLogo: f.teams.home.logo,
      awayId: f.teams.away.id,
      away: f.teams.away.name,
      awayLogo: f.teams.away.logo,
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
