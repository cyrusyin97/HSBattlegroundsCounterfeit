# HSBattlegroundsCounterfeit

**English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

A personal, local-only Hearthstone Battlegrounds–style auto-battler. You play seat 0 in an eight-player lobby against seven scripted bots. A local Python service runs the game rules through the TavernGym engine, and a Three.js board in the browser shows recruiting, combat replays and effects.

> **Unofficial fan project.** It is not affiliated with, endorsed by or sponsored by Blizzard Entertainment. Hearthstone and all card names, card text and artwork belong to Blizzard. **This repository contains no official card art.** Artwork can be restored into a Git-ignored folder for personal local testing only. See [Artwork](#artwork).

## Features

- **Rules engine:** TavernGym 1.0.0 (rules 36.6.3), with a small local patch that records attack impacts and hero health before and after combat.
- **3D board:** Three.js renders the shop, warband and hand as persistent card objects. You drag cards to buy, play, reorder and sell them.
- **Card faces:** procedural frames with the illustration, tier stars and attack/health as plain numbers. Hovering a card shows its name, text and attached cards (such as Dark Gifts).
- **Keyword visuals:**
  - Taunt: a steel shield behind the card.
  - Divine Shield: a golden bubble.
  - Stealth: dark smoke.
  - Windfury: wind streaks.
  - Reborn: a cracked silver shell.
  - Deathrattle and Venomous: badges on the card.
  - Golden minions: bright frame, crown and light sweep, readable without relying on color.
- **Interactions:**
  - Targeted spells turn into an aiming arrow when dragged out of the hand. The arrow starts at whatever opened the choice: a hand card, a minion or a hero power.
  - Magnetic minions attach to mechs.
  - Discard effects let you pick a hand card.
  - Choose One and Discover panels can be folded away.
  - Right-click or Esc cancels.
- **Combat playback:** the engine's combat log is replayed on the table, with lunges, damage bursts, shield breaks, deaths, summons and the final hero attack. The hand stays visible, and hovering still explains cards.
- **Opponent info:** the roster ranks players by health plus armor. Each portrait shows the tribe of that player's current warband. Hovering a portrait shows the player's rank, tavern tier, win streak, hero power and trinkets.
- **Fixed scenarios:** reproducible lobbies that demonstrate specific mechanics (see below).

## Requirements

Tested on macOS (Apple Silicon) with Python 3.11.15, Node.js 25.6.1 and npm 11.9.0.

The bundled engine wheel in `vendor/wheels/` is built for **macOS arm64** only. Other platforms need their own build of the engine (see [Engine](#engine)).

## Install

From the repository root:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
```

## Run

Start the backend and the frontend in two terminals from the repository root:

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev --workspace frontend
```

Open <http://127.0.0.1:5173/>. The scenario menu in the top-left starts a fixed scenario or a random game. API documentation is at <http://127.0.0.1:8000/docs>.

### Controls

| Action | Gesture |
| --- | --- |
| Buy | Drag a shop card into the hand, or click it |
| Play a minion | Drag it from the hand onto the warband; its position follows the pointer |
| Magnetize | Drop a Magnetic minion on the middle of a highlighted mech |
| Reorder | Drag a minion within the warband |
| Sell | Drag a minion back to the shop |
| Cast a targeted spell | Drag it out of the hand, then release on a highlighted target |
| Activate a minion or hero power | Click it; pick a target if asked |
| Cancel | Right-click, Esc, or the Cancel button |
| Inspect | Hover a card or a roster portrait |

### Scenarios

| Scenario | What it shows |
| --- | --- |
| `target` | Targeted spell: cast Banana Bunch on a minion |
| `recruit` | Buy, play and reorder minions |
| `triple` | Triple into a golden minion and use the triple reward (Discover) |
| `collision` | Two big minions hit each other at the same time |
| `deathrattle` | Divine Shield break, Deathrattle summons and Windfury |
| `reborn` | A Reborn minion returns with 1 health |
| `hero_damage` | The enemy hero breaks your armor and deals damage |
| `mechanics` | Turn 3 with 10 gold: Magnetic, Dark Gift, Choose One and a discard activation |
| `late` | Turn 10 of a bot-played game, for opponent ranks, hero powers and trinkets |

You can also create one through the API: `POST /api/games?scenario=deathrattle`.

## Checks

```sh
.venv/bin/python -m pytest -q
npm run check:frontend
npm run test:frontend
npm run build --workspace frontend
```

## Project layout

```text
backend/            FastAPI service, game sessions, scenarios and tests
frontend/src/       Board controller, HUD and API client
frontend/src/core/  Pure game-to-UI logic (intents, combat script, traits), unit tested
frontend/src/three/ Three.js renderer: stage, cards, combat, effects, textures
frontend/test/      Frontend unit tests (node --test)
scripts/            Artwork restore script
vendor/             Engine wheels, local engine patch, license and notice
docs/HANDOVER.md    Detailed design and engineering notes
```

## Local API

The service keeps games in memory; restarting it starts over. HTTP and WebSocket share sessions and versions.

| Purpose | Endpoint |
| --- | --- |
| List scenarios | `GET /api/scenarios` |
| Create a game | `POST /api/games` (optional `?scenario=`) |
| Read a snapshot | `GET /api/games/{game_id}` |
| Submit an action | `POST /api/games/{game_id}/actions` |
| WebSocket | `/ws/games/{game_id}` |

The client must send an action copied from the latest snapshot's `legal_actions`, together with that snapshot's `version` and a fresh `request_id`. Errors use these codes:

- `stale_version`: the snapshot's `version` is out of date.
- `duplicate_request`: the `request_id` was already used.
- `illegal_action`: the action is not in `legal_actions`.

Every error response includes the current snapshot. `frontend/src/game-api.ts` is the TypeScript client.

## Artwork

Card faces work without artwork and fall back to a tinted emblem. `frontend/src/demo-art.json` maps engine card IDs to official image sources and pinned SHA-256 hashes. To restore the images into the Git-ignored `frontend/public/assets/official/` for **personal local testing**:

```sh
.venv/bin/python scripts/restore_demo_art.py
```

Do not commit or redistribute these images.

## Engine

The rules come from [MCG-NJU/AutoTavern](https://github.com/MCG-NJU/AutoTavern) (TavernGym), pinned at commit `fb61201a557ddd36a411cf44aac51ce4d9b606ce`.

- **Bundled wheel:** the patched `1.0.0+impact2` build.
- **Engine patch:** `vendor/taverngym/attack-impact.patch`.
- **Build record:** `vendor/taverngym/build-manifest.json`.

To build for another platform, apply the patch to that commit, follow the upstream build steps, and point `backend/requirements.txt` at the new wheel. The engine is MIT-licensed. Its game content is covered separately by `vendor/taverngym/NOTICE`.

## Status

This is a proof of concept for personal use. There are no accounts, matchmaking or network play. Some engine systems (quests, buddies, secrets and others) only have generic UI so far. See `docs/HANDOVER.md` for the full picture and the roadmap.
