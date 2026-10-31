# Publishing Maze Shooters

The submission build runs as one Node 24 service: built browser assets and the authoritative WebSocket server share an origin. No AI API, database, paid realtime provider, analytics service, or user account is required during play.

## Verify locally

```sh
npm ci
npm run build
PORT=4174 HOST=127.0.0.1 npm start
```

Open http://127.0.0.1:4174/. The public entry redirects to online play; `/?offline=1` retains keyboard hotseat. `/health` is the health check and `/duel` is the WebSocket endpoint. HTTPS hosting automatically selects WSS. Production has no development test hooks.

## Render Free

The user selected Render Free without a payment method. `render.yaml` declares a single free instance, manual deployments, Node 24.22.1, and a small demo capacity of 16 rooms / 32 connected sockets. These capacity limits bound concurrent simulation work; they are not billing limits or a load-test guarantee. Visitors beyond capacity are rejected rather than creating extra instances.

1. Put the reviewed deployment source in a GitHub repository accessible to the Render account. A private repository is sufficient; give Render access only to that repository.
2. Create one **Web Service**, using the repository or its Blueprint.
3. Verify **Free** is selected. Do not add a card, enable paid services, add databases, or configure autoscaling.
4. Use build command `npm ci --include=dev && npm run build`, start command `npm start`, and health path `/health`.
5. Set `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=24.22.1`, `MAX_ROOMS=16`, and `MAX_CONNECTIONS=32`. Render supplies `PORT`.
6. Deploy, then test the actual HTTPS URL using two independent browsers, including a phone. Verify room creation, Ready, both live missiles, touch steering, a result, reload recovery, and both-party rematch.
7. Confirm the Render workspace has no saved payment method and the service remains Free before sharing the URL.

Render's documented Free behavior is to suspend free services on bandwidth exhaustion when no payment method exists. Adding a payment method changes this: bandwidth/build overages can be charged even for free compute. Review the actual account Billing page; the source repository cannot enforce its settings. Free services sleep after 15 minutes of inactivity and take about a minute to wake. Do not promise uninterrupted judging availability. Restarts erase in-memory rooms; players must create a new room. A stalled network peer is detected by ping/pong before normal disconnect grace begins.

Sources checked 30 October 2026: [Free limits and billing](https://render.com/docs/free), [WebSocket transport and bandwidth](https://render.com/docs/websocket), [Blueprint fields](https://render.com/docs/blueprint-spec).

## Scope and alternatives

Do not upload original pasted prompts, planning archives, local credentials, or `.git` history as deployment assets. Runtime public serving is restricted to the built index and assets, not source files. The deployable repository needs source, package files, build/test configuration, tests, and `tools/ts-loader.mjs`; it does not need the original planning pack or local screenshots.

Vercel supports WebSockets, but new connections can reach different function instances and connections end at the function duration limit. This game's in-memory authority requires an adaptation or a separate game server for reliable Vercel-only deployment. That migration is outside the selected Render submission path. Vercel Hobby has free usage caps; paid Spend Management is delayed and does not cap every separate charge. See [WebSocket state](https://vercel.com/docs/functions/websockets) and [Spend Management](https://vercel.com/docs/spend-management).

No paid deployment, public URL, or successful public load test should be claimed until observed and recorded in TASKS.md.
