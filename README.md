# Blind Stage co-op relay: deploy guide

This folder is a complete, dependency-free Node server that pairs a driver and a navigator for online co-op. It's 4 files: `index.js`, `relay.js`, `package.json`, `render.yaml`. It holds no player data and no accounts; it only forwards small messages between two players in a room.

**Recommended host: [Render](https://render.com) free plan.** Free web services stay awake while players are connected, and sleep after 15 minutes with no traffic. Waking takes up to a minute; the game shows "Waking up the co-op server…" and keeps retrying, and also starts waking the server as soon as a player opens a co-op tab. 750 free hours a month is enough for one service running all month.

---

## Deploy in about 10 minutes (no command line needed)

**1. Put the server files on GitHub**
1. Create a free account at github.com (skip if you have one).
2. Click **New repository**, name it `blind-stage-relay`; **Private** is fine. Click **Create repository**.
3. On the empty repo page click **uploading an existing file**, then drag in the 4 files from this folder:
   `index.js`, `relay.js`, `package.json`, `render.yaml`. Click **Commit changes**.

**2. Create the service on Render**
1. Sign up at render.com with **Sign in with GitHub** (that also gives Render access to the repo).
2. Click **New → Blueprint**, pick the `blind-stage-relay` repo, then **Apply**. Render reads `render.yaml` and creates a free web service named `blind-stage-relay`.
   - Or **New → Web Service** with these settings: Runtime **Node**, Build command `echo "no build step"`, Start command `node index.js`, Instance type **Free**, Health check path `/health`.
3. Wait for the deploy to show **Live** (a minute or two).

**3. Check it**
Open `https://blind-stage-relay.onrender.com/health` (use the URL Render shows if it's different). You should see:
```json
{"ok":true,"service":"blind-stage-relay","rooms":0,"players":0}
```

**4. Point the game at it**
Rebuild the itch.io zip with the relay address (`wss://`, ending in `/ws`):
```
node build.js --relay=wss://blind-stage-relay.onrender.com/ws
```
Then upload the new `dist/blind-stage-web-demo.zip` to itch.io, replacing the old one. Co-op then works between any two players online.

---

## Settings
- `ALLOWED_ORIGINS` (optional env var in Render → Environment): comma-separated regexes for the web pages allowed to connect. The default allows itch.io embeds, localhost and home networks. Add your own domain if you host the game elsewhere, e.g. `^https://([a-z0-9-]+\.)*itch\.(zone|io)$,^https://blindstage\.com$`. Set `*` to allow any page.
- `PORT`: set automatically by Render.

## Built-in protections
- Only pages from allowed sites can connect (others get `403`).
- Flood guard: a client sending more than 60 messages a second (sustained) is disconnected. The game sends 20.
- Messages are capped at 16 KB; at most 2000 connected players; dead connections are dropped after 70 s without a heartbeat.
- Room codes are 4 letters; a room holds exactly one driver and one navigator.

## Costs and limits
- Free plan: $0, sleeps after 15 idle minutes, can be restarted by Render at any time. Players in a stage at that moment get disconnected and can reconnect with a new code.
- If co-op gets popular, switch the service to a paid instance type in Render (a few dollars a month) so it never sleeps. No code changes needed.

## Local testing
`node index.js` runs it on port 8080 (or the launch config `blind-stage-relay`). Build a test zip with `node build.js --relay=ws://localhost:8080/ws` and serve it with the `blind-stage-demo-build` launch config.
