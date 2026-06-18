// netlify/functions/check-results.js
exports.handler = async function(event) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const BASE = "https://v3.football.api-sports.io";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API key." }) };
  }
  const params = event.queryStringParameters || {};
  const fixtureId = params.fixtureId;
  if (!fixtureId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fixtureId." }) };
  }
  try {
    const res = await fetch(`${BASE}/fixtures?id=${fixtureId}`, {
      headers: { "x-apisports-key": API_KEY }
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
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fixtureId: parseInt(fixtureId),
        status,
        finished: result !== null,
        result,
        homeGoals,
        awayGoals,
        home: match.teams.home.name,
        away: match.teams.away.name,
      })
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message) }) };
  }
};
