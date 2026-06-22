exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "https://stratosai.bet",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const BOT_WEBHOOK = process.env.BOT_WEBHOOK_URL;
  const SECRET = process.env.WEBHOOK_SECRET;

  if (!BOT_WEBHOOK || !SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server not configured" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) };
  }

  const telegramId = parseInt(payload.telegramId);
  const eventType = payload.eventType;
  const allowed = ["visit_sportsbook", "connect_wallet", "place_bet"];

  if (!telegramId || telegramId <= 0 || !allowed.includes(eventType)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  try {
    const res = await fetch(BOT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": SECRET },
      body: JSON.stringify({ telegramId, eventType }),
    });
    const data = await res.json().catch(() => ({}));
    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Upstream failed" }) };
  }
};
