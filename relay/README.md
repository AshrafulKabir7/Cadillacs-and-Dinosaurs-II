# cnd2-relay: the game's WebSocket relay

Online co-op normally connects the players' browsers directly (WebRTC through PeerJS). Some networks block that,
for example mobile data and ISP carrier-grade NAT (CGNAT), and campus and office networks. When the direct link
to the host doesn't open within about 7 seconds, `net.js` sends the game through this relay instead. It uses
`wss://` on port 443, which almost every network allows.

It is a Cloudflare Worker with one Durable Object per room code. It runs on the Workers **free plan** (a
SQLite-backed Durable Object class, so no card is needed). It is a dumb forwarder: one host and at most two
joiners per room, 64 KB per message, a per-socket rate cap and an Origin allow-list. It stores nothing. The
protocol is described at the top of `src/index.js`.

## Deploy (once)

Run these inside this `relay/` folder:

```
npm install
npx wrangler login
npx wrangler deploy
```

`wrangler login` opens a browser so you can sign in to your Cloudflare account (the free plan is enough).
`wrangler deploy` prints the Worker's address when it finishes, for example:

```
Deployed cnd2-relay triggers
  https://cnd2-relay.<your-subdomain>.workers.dev
```

You can also find it later in the Cloudflare dashboard, under Workers & Pages, then cnd2-relay. Check that it
works: `https://cnd2-relay.<your-subdomain>.workers.dev/health` should answer `ok`.

Then put that address in `net.js`, in the `RELAY_URL` constant near the top, using `wss://` instead of `https://`:

```js
const RELAY_URL = 'wss://cnd2-relay.<your-subdomain>.workers.dev';
```

Commit and push. Vercel deploys the game, and `.vercelignore` keeps this folder out of it. After any change to
`src/index.js`, run `npx wrangler deploy` again.

## Settings

- `ALLOWED_ORIGINS` (in `wrangler.toml`, under `[vars]`) lists the pages that may open a relay socket. `*` matches
  any port. Add a Vercel preview domain here if you want to test online play on preview URLs.
- `RELAY_URL = ''` in `net.js` turns the relay off: the game then uses only direct connections, as it did before.
- `?relay=<url>` on the game's address overrides `RELAY_URL` (tests, or trying a new relay). Plain `ws://` is
  only accepted for this computer. `?relay=off` forces direct connections only. `?net=relay` skips the direct
  attempt and goes straight to the relay.

## Free-plan budget

Only sessions that actually fall back to the relay use it; direct WebRTC games never touch it. Durable Objects on
the free plan include 100,000 requests a day, and incoming WebSocket messages count as 1/20 of a request.
`net.js` batches what each player sends into at most about 30 messages a second (a 3-player test measured 80
incoming messages a second in total), so a relayed 3-player game costs about 4–6 requests a second. That works
out to roughly 5–7 hours of relayed 3-player play a day across all rooms, and more with 2 players. Cloudflare's dashboard shows the usage, under Workers & Pages, then cnd2-relay, then Metrics.

## Local test

`npx wrangler dev --port 8787` runs the Worker on this computer with no Cloudflare account. Open the game with
`?net=relay&relay=ws://127.0.0.1:8787`. The test suites (`tests/net.cjs`, `tests/multiplayer.cjs` tier T6) start
`wrangler dev` themselves through `tests/lib/relay.cjs`. If wrangler isn't installed, they use
`tests/fixtures/relay-node.cjs`, the same protocol written in plain Node.
