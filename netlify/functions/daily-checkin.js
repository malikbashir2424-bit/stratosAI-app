// netlify/functions/daily-checkin.js
// Daily streak check-in. Called from the platform when a Telegram-linked
// user opens it. Awards daily points, grows/breaks streaks, weekly bonus,
// and a streak shield. All logic is server-side (cannot be gamed from browser).

const SUPA_URL = process.env.DB_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

const DAILY_POINTS   = 100;   // base points per day
const WEEKLY_BONUS   = 2000;  // every 7-day streak (needs wallet)
const SHIELD_AT      = 14;    // streak length that grants a shield

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error("DB error " + res.status);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function daysBetween(a, b) {
  const d1 = new Date(a); d1.setHours(0, 0, 0, 0);
  const d2 = new Date(b); d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / 86400000);
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "https://stratosai.bet",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  if (!SUPA_URL || !SUPA_KEY)
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Not configured" }) };

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const telegramId = parseInt(p.telegramId);
  const wallet = p.wallet || null;
  if (!telegramId || telegramId <= 0)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid telegramId" }) };

  try {
    const rows = await sb(`users?telegram_id=eq.${telegramId}&select=*`);
    if (!rows || !rows.length)
      return { statusCode: 404, headers, body: JSON.stringify({ error: "User not found. Start the bot first." }) };

    const u = rows[0];
    const now = new Date();
    const last = u.last_checkin ? new Date(u.last_checkin) : null;

    // Already checked in today?
    if (last && daysBetween(last, now) === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: "already",
          streak: u.streak_count || 0,
          points: u.points || 0,
          shield: u.shield_active || false,
          message: "Already checked in today",
        }),
      };
    }

    const gap = last ? daysBetween(last, now) : 1; // days since last check-in
    let streak = u.streak_count || 0;
    let shield = u.shield_active || false;
    let shieldUsed = false;
    let earned = DAILY_POINTS;
    let weeklyHit = false;

    if (gap === 1) {
      streak += 1;                       // consecutive day
    } else if (gap >= 2) {
      // Missed at least a day
      if (shield) {
        streak += 1;                     // shield saves the streak
        shield = false;
        shieldUsed = true;
      } else {
        streak = 1;                      // streak resets
      }
    } else {
      streak = Math.max(1, streak);
    }

    // Weekly bonus: every 7th consecutive day, requires a linked wallet
    if (streak > 0 && streak % 7 === 0) {
      if (wallet) { earned += WEEKLY_BONUS; weeklyHit = true; }
    }

    // Grant shield at SHIELD_AT-day streak (once per shield)
    let grantedShield = false;
    if (streak >= SHIELD_AT && !shield && !shieldUsed && streak % SHIELD_AT === 0) {
      shield = true;
      grantedShield = true;
    }

    const longest = Math.max(u.longest_streak || 0, streak);
    const newPoints = (u.points || 0) + earned;

    await sb(`users?telegram_id=eq.${telegramId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        points: newPoints,
        streak_count: streak,
        longest_streak: longest,
        last_checkin: now.toISOString(),
        total_checkins: (u.total_checkins || 0) + 1,
        shield_active: shield,
        shield_used_at: shieldUsed ? now.toISOString() : u.shield_used_at,
        weekly_bonus_count: (u.weekly_bonus_count || 0) + (weeklyHit ? 1 : 0),
        wallet_address: wallet || u.wallet_address,
      }),
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: "ok",
        streak,
        longest,
        earned,
        points: newPoints,
        weeklyBonus: weeklyHit ? WEEKLY_BONUS : 0,
        shield,
        shieldUsed,
        grantedShield,
        nextWeeklyIn: 7 - (streak % 7 === 0 ? 7 : streak % 7),
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e.message) }) };
  }
};
