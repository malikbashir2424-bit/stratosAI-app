// netlify/functions/team-stats.js
exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const params = event.queryStringParameters || {};
  const homeId = parseInt(params.homeId);
  const awayId = parseInt(params.awayId);

  if (!homeId || !awayId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing homeId or awayId." }) };
  }

  const TEAM_DB = {
    9:    { name:"Spain",              goalsScored:2.80, goalsConceded:0.50, form:"WWWWW", wins:10, draws:1,  losses:1, played:12, cleanSheets:7 },
    26:   { name:"USA",                goalsScored:1.80, goalsConceded:0.90, form:"WWDWW", wins:8,  draws:2,  losses:2, played:12, cleanSheets:4 },
    1533: { name:"Cape Verde Islands", goalsScored:1.40, goalsConceded:1.00, form:"WDWLW", wins:6,  draws:2,  losses:2, played:10, cleanSheets:3 },
    1:    { name:"Belgium",            goalsScored:2.40, goalsConceded:0.70, form:"WWWDW", wins:9,  draws:2,  losses:1, played:12, cleanSheets:5 },
    32:   { name:"Egypt",              goalsScored:1.60, goalsConceded:0.80, form:"WWDWL", wins:7,  draws:2,  losses:1, played:10, cleanSheets:4 },
    23:   { name:"Saudi Arabia",       goalsScored:1.50, goalsConceded:1.10, form:"WDWWL", wins:5,  draws:3,  losses:2, played:10, cleanSheets:3 },
    7:    { name:"Uruguay",            goalsScored:1.90, goalsConceded:0.80, form:"WWWLW", wins:8,  draws:2,  losses:2, played:12, cleanSheets:5 },
    22:   { name:"Iran",               goalsScored:1.70, goalsConceded:0.90, form:"WWDWW", wins:7,  draws:3,  losses:0, played:10, cleanSheets:4 },
    4673: { name:"New Zealand",        goalsScored:1.30, goalsConceded:1.20, form:"WDLWW", wins:5,  draws:2,  losses:3, played:10, cleanSheets:2 },
    2:    { name:"France",             goalsScored:2.60, goalsConceded:0.60, form:"WWWWW", wins:10, draws:1,  losses:1, played:12, cleanSheets:6 },
    13:   { name:"Senegal",            goalsScored:1.80, goalsConceded:0.90, form:"WWDWL", wins:7,  draws:2,  losses:1, played:10, cleanSheets:4 },
    1567: { name:"Iraq",               goalsScored:1.60, goalsConceded:1.00, form:"WDWLW", wins:6,  draws:3,  losses:1, played:10, cleanSheets:3 },
    1090: { name:"Norway",             goalsScored:2.10, goalsConceded:0.80, form:"WWWDW", wins:8,  draws:2,  losses:2, played:12, cleanSheets:5 },
    10:   { name:"Argentina",          goalsScored:2.50, goalsConceded:0.70, form:"WWWWW", wins:10, draws:2,  losses:0, played:12, cleanSheets:6 },
    6:    { name:"Brazil",             goalsScored:2.20, goalsConceded:0.80, form:"WWDWW", wins:9,  draws:2,  losses:1, played:12, cleanSheets:5 },
    17:   { name:"Germany",            goalsScored:2.30, goalsConceded:0.90, form:"WWWDW", wins:9,  draws:1,  losses:2, played:12, cleanSheets:4 },
    5:    { name:"Portugal",           goalsScored:2.70, goalsConceded:0.60, form:"WWWWW", wins:10, draws:1,  losses:1, played:12, cleanSheets:6 },
    21:   { name:"England",            goalsScored:2.00, goalsConceded:0.70, form:"WWWDW", wins:9,  draws:2,  losses:1, played:12, cleanSheets:5 },
    18:   { name:"Netherlands",        goalsScored:2.10, goalsConceded:0.80, form:"WWDWW", wins:8,  draws:3,  losses:1, played:12, cleanSheets:4 },
    24:   { name:"Morocco",            goalsScored:1.70, goalsConceded:0.60, form:"WWWDW", wins:8,  draws:3,  losses:1, played:12, cleanSheets:5 },
    25:   { name:"Japan",              goalsScored:1.90, goalsConceded:0.70, form:"WWWWD", wins:9,  draws:2,  losses:1, played:12, cleanSheets:5 },
    768:  { name:"Mexico",             goalsScored:1.80, goalsConceded:0.90, form:"WDWWL", wins:7,  draws:3,  losses:2, played:12, cleanSheets:3 },
    3:    { name:"Canada",             goalsScored:1.60, goalsConceded:1.00, form:"WDWLW", wins:6,  draws:3,  losses:3, played:12, cleanSheets:3 },
  };

  const DEFAULT = {
    goalsScored:   1.40,
    goalsConceded: 1.20,
    form:          "WDLWL",
    cleanSheets:   2,
    wins: 4, draws: 3, losses: 3, played: 10,
  };

  const homeStats = TEAM_DB[homeId] || { ...DEFAULT };
  const awayStats = TEAM_DB[awayId] || { ...DEFAULT };

  const clean = (s) => {
    const { name, ...rest } = s;
    return rest;
  };

  return {
    statusCode: 200,
    headers: { ...headers, "Cache-Control": "public, max-age=3600" },
    body: JSON.stringify({ home: clean(homeStats), away: clean(awayStats) }),
  };
};
