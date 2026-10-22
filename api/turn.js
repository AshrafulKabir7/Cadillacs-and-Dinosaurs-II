// Vercel serverless function: short-lived TURN relay credentials for online co-op (net.js asks for them before
// hosting or joining). Players behind strict NATs (mobile data, campus, office networks) cannot connect directly,
// so their WebRTC traffic has to go through a TURN relay. The provider secrets stay in Vercel environment variables:
//   Cloudflare Realtime TURN: CF_TURN_KEY_ID + CF_TURN_API_TOKEN
//   Metered TURN:             METERED_DOMAIN (e.g. yourapp.metered.live) + METERED_API_KEY
// With neither configured it answers with an empty list and the game falls back to direct connections.
const TTL = 4 * 60 * 60;   // credentials live for four hours, longer than a play session

async function cloudflare() {
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return null;
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL }),
  });
  if (!res.ok) throw new Error(`cloudflare ${res.status}`);
  const body = await res.json();
  const list = [].concat(body.iceServers || []);
  return { provider: 'cloudflare', iceServers: list };
}

async function metered() {
  const domain = process.env.METERED_DOMAIN, key = process.env.METERED_API_KEY;
  if (!domain || !key) return null;
  const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`metered ${res.status}`);
  const list = await res.json();
  return { provider: 'metered', iceServers: Array.isArray(list) ? list : [] };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const errors = [];
  for (const source of [cloudflare, metered]) {
    try {
      const out = await source();
      if (out && out.iceServers.length) { res.statusCode = 200; res.end(JSON.stringify(out)); return; }
    } catch (e) { errors.push(String(e.message || e)); }
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ provider: null, iceServers: [], errors }));
};
