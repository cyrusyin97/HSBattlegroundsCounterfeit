# Durable Objects deployment design

Status: design only, not started (2026-11-12). Nothing here is built yet. Limits and prices in this document were read from Cloudflare's docs on that date and need checking again before work starts.

The goal is to put the game online for several players at once. Each game is one Cloudflare Durable Object that runs the engine compiled to WebAssembly, and the frontend is served from the same Worker.

## Requirements

1. All requests of one game reach the same running copy of that game.
2. The service may sleep when idle, but a game in progress must not be lost when it does.
3. A finished game can be discarded, or written once to a database.
4. Many players can play their own games at the same time.
5. LLM bot players may be added later.
6. Accounts may be added later, or games may be saved in the player's browser.

## Why Durable Objects

| Where a live game lives | Example | 1. Same copy | 2. Idle sleep | 4. Many games | Keeps Python |
| --- | --- | --- | --- | --- | --- |
| Memory of one server, requests routed to it | Fly.io with `fly-replay` | Our own routing | Needs a heartbeat; a lost machine loses its games | Add machines and route | Yes |
| Nowhere: a save is loaded and stored around every action | Any serverless host with Redis | Not needed | Safe | Free scaling | Yes |
| **One Durable Object per game** | Cloudflare | **Built in** | **Safe**: the object reloads from its own storage | **Built in** | No |
| The player's browser | Static hosting | Built in | Ends when the tab closes | Free | No |

A Durable Object is a small stateful instance with a name. Cloudflare keeps at most one instance per name and sends every request for that name to it. It handles events one at a time. It has its own SQLite storage on the same machine, so a write does not cross the network. When idle it is evicted from memory, and the next request recreates it from storage.

Unlike the server-routing option, the game stays in memory between actions, so the hot path never loads a save. Unlike the save-every-action option, the save is a local write, not a round trip to a shared database. Routing, scaling, sleeping and waking are the platform's job.

The cost is the runtime. A Durable Object runs JavaScript or WebAssembly, not our Python backend or the CPython engine wheel. So the engine moves to WebAssembly and the Python layer moves to TypeScript. Both pieces are also exactly what running the game in the browser would need, so that option stays open.

Measurements behind this choice, native engine on the development Mac:

| Turn | Save (`state_json`) | Compressed (zlib 6) | Compress | Decompress and restore |
| --- | --- | --- | --- | --- |
| 5 | 358 KB | 15 KB | 1.4 ms | 1.2 ms |
| 8 | 680 KB | 33 KB | 3.1 ms | 1.6 ms |
| 11 | 712 KB | 41 KB | 3.7 ms | 1.6 ms |

An action through the current backend takes 15–22 ms mid-game, with public views. The backend process uses about 100 MB.

## Architecture

```
Browser (Three.js frontend, built without official art)
   │  REST now, WebSocket once bots run in the background
   ▼
Worker: static assets and /api router
   │  stub = env.GAME.get(idFromName(gameId))
   ▼
GameRoom Durable Object, one per game
   ├─ engine (WebAssembly) and game session (TypeScript)
   ├─ SQLite: the compressed save, request ids
   └─ alarms: background bot turns, cleanup of abandoned games
   │
   ├─▶ D1: finished games, later accounts
   └─▶ LLM providers over fetch (later)
```

## Components

### 1. The engine as WebAssembly

A new crate, `taverngym-wasm`, sits next to `taverngym-py` in the patched engine tree and exposes the same game API with `wasm-bindgen`. The Python binding has these methods today:

- **Kept:** `new`, `turn`, `num_players`, `is_over`, `needs_action`, `legal_mask`, `step`, `bot_action`, `bot_play`, `placements`, `health`, `state_json`, `from_json`, `copy`, `public_view`, `public_view_without_combats`, `debug`, `set_record_log`.
- **Left out:** `observe` and the batched environment. They exist for training, which stays native.

Engine changes, all small:

- **Threads:** `batch.rs` and `workers.rs` use OS threads, so they compile only off `wasm32`.
- **Crash dumps:** `guard.rs` writes a file named by the system clock. On `wasm32` it logs instead, because there is no file system and no clock.
- **Card table:** it is embedded with `include_str!` (`data/cards.json`, 1.75 MB), so the module is self-contained. The Worker bundle limit is now 64 MiB uncompressed, so size is not a blocker, but the spike measures it.

Determinism: the engine has its own SplitMix RNG (`rng.rs`), and the rules use integers. Floats appear only in `obs.rs` (training observations) and in debug combat previews. The same seed and actions should give the same state as the native build, and the spike checks this step by step.

Build and provenance follow the wheel's practice:

- **Patch:** pinned upstream commit `fb61201`, with the new crate added to the patch file.
- **Build:** `wasm-pack` or `wasm-bindgen`.
- **Record:** the source fingerprint and the hash of the `.wasm` go into `vendor/taverngym/build-manifest.json`.
- **Storage:** the built module is vendored like the wheels, so deploying needs no Rust toolchain.

### 2. The game module in TypeScript

The Python backend (710 lines) is ported to a platform-free TypeScript package. It uses no Cloudflare APIs, so the same code runs in the Durable Object, in Node for tests, and in a browser later.

| Python | TypeScript | Notes |
| --- | --- | --- |
| `game_session.py` (81) | `session.ts` | Version check, duplicate request ids, copy-step-commit |
| `projection.py` (155) | `projection.ts` | Public views to client snapshot: legal actions, card fields, opponents, warbands, targeted spells |
| `bots.py` (180) | `bots.ts` | `advanceBots`, the `Policy` interface, `decide` with fallback to the built-in bot |
| `scenarios.py` (89) | `scenarios.ts` | Fixed scenarios built with debug commands |
| `main.py` (69) | the Worker | Routes, see below |
| `evaluate.py` (136) | stays Python | Offline evaluation and training use the native wheel |

**Parity first.** Python stays the reference until the port matches it. A golden test runs both implementations over every scenario and 20 full seeded games with scripted actions, and compares each snapshot exactly. After that, TypeScript is the only implementation behind the web game, and the Python backend remains for local development and offline work.

**Traditional Chinese.** The backend converts card names and texts with OpenCC (`s2twp`). Static card text can be converted at build time into a lookup table. Live texts, which carry current numbers, have to be converted at run time. The proposal is to do this in the browser with a JavaScript OpenCC port, loaded only when zh-TW is active, which keeps the object small. This is an open question below.

### 3. The Worker

It serves the frontend as static assets and routes the API. Phase 1 keeps today's REST contract, so the frontend code is unchanged except for build flags.

| Route | Handling |
| --- | --- |
| `GET /api/scenarios` | Static list |
| `POST /api/games?scenario=` | New random game id; the object creates the game |
| `GET /api/games/:id` | Forwarded to the object |
| `POST /api/games/:id/actions` | Forwarded to the object |
| `GET /ws/games/:id` (phase 3) | WebSocket upgrade, forwarded to the object |

Official art: the deployed frontend is built in CI from a Git checkout, which never contains `frontend/public/assets/official/`, with a new build flag, `VITE_NO_ART=1`. The flag makes `?noart` the default and stops requests for the art. A local `frontend/dist` contains the art, because Vite copies `public/`, and is never uploaded. The deployment sits behind Cloudflare Access during the proof of concept.

### 4. The GameRoom object

**In memory:** the engine `Game`, the last snapshot and legal actions, the version, recent request ids and the last activity time.

**In SQLite storage:**

- `save`: one row with the version, the zlib-compressed `state_json`, and the update time.
- `applied`: request id and version, kept to the last few hundred entries.

**Lifecycle:**

1. **Create:** build the game from the seed or scenario, then write the first save.
2. **Wake:** the constructor runs again after an eviction. It loads the save inside `blockConcurrencyWhile` and restores it with `Game.fromJson` before any request runs.
3. **Action:**
   1. Check the version and the request id.
   2. Copy the game, step it, run the built-in bots, and build the snapshot.
   3. Commit in memory, then write the save.
   - The output gate holds the response until the local write completes, so a client never sees an action that was not saved.
4. **Finish:** write a summary row to D1, then `deleteAll()` the object's storage.
5. **Abandon:** every action moves an alarm to 24 hours later. If it fires, the game was left unfinished and its storage is deleted.

**Write cost:** start by writing after every action, a compressed save of 15–41 KB written locally. If measurements show a cost, write at the end of each recruit phase and before combat instead, accepting that an eviction mid-turn loses at most that turn's recruit actions.

**Concurrency:** the object handles one event at a time, and input gates protect storage operations. An `await` on `fetch` (an LLM call) lets other requests interleave, so the version check stays mandatory and bot steps go through the same commit path as player actions.

### 5. Bots

**Phase 1:** built-in bots run synchronously inside the player's action through the engine's `bot_action`, as today. They take under a millisecond per step.

**Phase 3**, required before any LLM bot: bots run in the background.

- **Timing:** recruit is simultaneous in Battlegrounds, so bots decide while the player recruits.
- **Steps:** an alarm drives the bot seats. Each decision projects that seat's public view, asks its policy within a deadline, validates the answer, falls back to `bot_action` if needed, and steps under the version check.
- **End of turn:** ending the turn no longer forces the bots to finish. The object answers "waiting for opponents", resolves combat when every seat has ended its turn, and pushes the result.
- **Push:** WebSocket with the Hibernation API, so an open connection does not keep the object in memory. Polling `GET` is the fallback.
- **Frontend:** it gains a waiting state and must accept a combat that arrives after the action that ended the turn.
- **Retries:** alarms run at least once, so bot steps must be idempotent. The version check covers that.
- **LLM calls:** provider keys are Worker secrets. Each game and account gets a budget and a rate limit, and decisions are logged to D1 for review. Waiting on `fetch` does not count as CPU time.

### 6. Finished games, accounts and local saves (later)

- **D1:**
  - `games`: id, scenario or seed, hero, placement, turns, start and finish time, account.
  - `users`, once accounts exist.
- **Accounts:** first an invite list through Cloudflare Access, later real accounts. Game ids stay random, and D1 indexes games by account.
- **Browser saves:** an export endpoint returns the compressed save, which is small enough for `localStorage` or IndexedDB, signed with an HMAC from a Worker secret. Import checks the signature and creates a new object from it. If the game later runs fully in the browser, the save is local by nature.

## Limits and costs

| Item | Value | Effect |
| --- | --- | --- |
| CPU time per request | Free 10 ms; paid 30 s default, up to 5 min | An action takes 15–22 ms natively, and WebAssembly may be slower, so the **paid plan is required** |
| Memory | 128 MB per isolate | One game uses a few MB |
| SQLite value size | 2 MB per key and value | The compressed save is at most about 41 KB |
| Storage per object | 1 GB free, 10 GB paid | One save |
| Worker bundle | 64 MiB uncompressed (changelog, September 2026) | The engine with its card table fits |
| Price | Workers Paid from US$5 a month, which includes Durable Objects usage; then per request, active duration and storage | Expected to stay near the minimum at this scale |

Whether the free plan includes Durable Objects at all was not confirmed.

## Plan

Each step ends in a gate. If a step misses its gate, stop and reassess.

### 0. Spike (2–3 days)

- Build `taverngym-wasm` and play full bot games in Node and in `wrangler dev`.
- Compare `state_json` after every step with the native wheel on the same seeds and actions.
- Measure the module size, time per action and memory.

**Gate:** identical states over 20 seeded games, and an action under 50 ms at p95 inside a local Durable Object.

### 1. Port the game module (about 1–2 weeks)

- Write `session.ts`, `projection.ts`, `bots.ts` and `scenarios.ts`.
- Port the backend tests to `node:test`.
- Add the golden parity test against Python.

**Gate:** exact snapshot parity on every scenario and the 20 seeds, and all ported tests passing.

### 2. Worker and object with today's API (about 1 week)

- Worker, GameRoom, SQLite save, abandon alarm, D1 summary at game end.
- No-art static build in CI, Cloudflare Access, deploy to `workers.dev`.

**Gate:**

- A full game plays through on the deployed URL.
- A redeploy in the middle of a game does not lose it. A redeploy restarts objects, so this exercises the save and restore path.
- Several games run at once.

### 3. Background bots (about 1 week)

- Alarm-driven bot turns, WebSocket push, waiting state in the frontend.

**Gate:** with built-in bots, background play gives the same games as synchronous play on fixed seeds. Only then does an LLM policy go in, behind a flag.

### 4. History, accounts, local saves (when needed)

## Risks

- **WebAssembly speed or determinism.** The spike answers both before any port work.
- **Two implementations drifting.** After step 2, TypeScript is the only implementation behind the web game. Python keeps offline evaluation and training, and the parity test stays in CI while both exist.
- **Engine upgrades.** Each upgrade rebuilds the wheel and the WebAssembly module from the same patch, and parity tests catch drift between them.
- **Platform lock-in.** Cloudflare-specific code stays in the Worker and the object. The game module is platform-free, so the same code can move to the browser or a Node server.
- **Rights.** The game uses Blizzard's card names and texts (see `vendor/taverngym/NOTICE`). The deployment ships no official art and stays behind Access while it is a proof of concept.

## Out of scope

- Several humans in one lobby.
- Rankings and anti-cheat.
- Mobile layouts.

## Open questions

- Convert Traditional Chinese live texts in the browser (proposed) or in the object?
- Serve the frontend from the Worker (proposed, one origin) or keep it on Vercel with a rewrite to the Worker?
- Vendor the built `.wasm` (proposed, like the wheels) or build it in CI?
- Write a save after every action (proposed to start) or at phase boundaries?
- Retire the Python game backend after step 2, or keep it for local play?

## References

- [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) (input and output gates, write coalescing)
- [Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) (Hibernation API)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Larger Workers, up to 64 MiB](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
