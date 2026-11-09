# cloneBattlegrounds — Engineering Handover

Prepared on 9 November 2026, Asia/Singapore. This document describes the inspected local implementation and records the next development priorities. The repository root on the current machine is `/Users/cyrusyin/codebase/cloneBattlegrounds`.

## 1. Product objective and current delivery

The project is a personal, local Hearthstone Battlegrounds recreation. The intended product has matching cards, heroes, and in-match rules, simplified visuals with convincing depth, offline play against AI, and eventual LAN and Internet multiplayer. Registration, commerce, and account-level match statistics are deferred. Browser and desktop delivery remain acceptable options.

The delivered POC runs an eight-seat game with one human at seat 0 and seven engine-controlled opponents. A Python service owns game state. A TypeScript browser client submits semantic actions and plays the resulting combat records. The current engine targets Hearthstone client **36.6.3.253932**, with rules version **36.6.3**.

Full parity with the official game remains a product target. The pinned engine, its catalog, and the exercised scenarios establish the current implementation scope. Catalog membership, the `reachable` flag, and downloaded artwork each measure different things. None alone establishes that every official mechanic has been validated.

The card renderer is **Three.js** (WebGL). Shop, warband and hand cards are persistent scene objects keyed by zone and entity ID, picked by raycasting, and moved by springs or timed poses. Minion combat and the refresh, freeze and upgrade effects play on the table. The HUD, tooltips, choices, targeting arrow, damage numbers and hero panels remain an HTML/SVG overlay on the same 1440 × 810 board coordinates. Card faces follow the Claude Design canvas “酒館戰棋 UI 原型”: a large illustration window cropped from the local official print (`three/art.ts`: the minion oval or the spell window, never the printed text or numbers), tier as gold stars on a dark pill (shop only), a plain-number price on shop spells only, and attack and health as plain numbers (warm gold and coral inside a heavy dark outline) over a dark bottom fade. Faces carry no name; the hover tooltip shows name and text. Cards without local art fall back to a tinted emblem. The HUD roster shows each player's hero portrait with armor and health, and the tavern tier appears as stars above the phase label. The former HTML/CSS card renderer was removed on 9 November 2026 and is not maintained; it remains in Git history up to commit `4ae870b`.

The accepted visual direction uses the wooden tavern from concept A (the WebGL table is a procedural wood surface with a leather mat; `tavern.png` is no longer drawn), targeted spell interaction from concept B, and automatic combat playback from concept C. The separate stat-change illustration such as “1/1 → 3/3” and the combat timeline were explicitly removed from the design direction. The earlier standalone asset inspection page was also rolled back. Preserve these decisions during future UI work.

## 2. Ownership of state and execution

The normal action path is as follows.

1. The browser chooses an object from the current `legal_actions` list.
2. It submits the action with a request ID and snapshot version.
3. `GameSession` locks that game and validates the request against the latest legal list.
4. The service copies the native game, applies the human action, and advances bots as necessary.
5. It projects the candidate into a player-facing snapshot.
6. On success, the candidate, snapshot, legal-action mapping, and version become authoritative together.
7. The browser plays any new combat, renders the confirmed state, and plays the relevant hero/shop effects.

Rules, costs, target legality, card effects, random outcomes, and combat settlement belong to TavernGym. The adapter translates between stable client identifiers and the engine's encoded action indices. The browser owns presentation and input handling.

Games, locks, request history, and snapshots live in one Python process. A server restart removes active sessions. The current deployment requires one worker so that every request reaches the same session dictionary. Refreshing the browser creates a new game through the page's startup flow. Although the API can read an existing session, the UI does not persist and resume its game ID across page reloads.

## 3. Files and implementation map

All paths below are relative to the repository root. `work/`, dependencies, generated builds, and downloaded card art are ignored by Git.

| Path | Responsibility |
| --- | --- |
| `backend/main.py` | FastAPI routes, in-memory session registry, HTTP and WebSocket command transport |
| `backend/game_session.py` | Semantic actions, player projection, locking, request deduplication, copy-on-write commits, bot advancement |
| `backend/scenarios.py` | Deterministic demonstration setups |
| `backend/tests/` | API, scenario, combat-contact, hero-settlement, and compatibility tests |
| `backend/requirements.in` | Direct Python dependencies and local wheel reference |
| `backend/requirements.txt` | Locked Python dependencies and local wheel reference |
| `frontend/index.html` | Board regions, scenario selector, hero panels, targeting SVG |
| `frontend/src/board.ts` | Controller: snapshot lifecycle, commits, input lock, HUD controls, choices, tooltip, targeting arrow |
| `frontend/src/view.ts` | Contract between the controller and the card renderer |
| `frontend/src/core/` | Renderer-independent rules: gesture → legal action (`intents.ts`), command submission (`session.ts`), combat side and replay identity (`replay.ts`), replay → ordered playback steps (`combat-script.ts`) |
| `frontend/src/three/` | WebGL renderer: stage and table (`stage.ts`), slot layout (`layout.ts`), snapshot reconciliation (`reconciler.ts`), card objects and faces (`entities.ts`), stage clock and timed poses (`motion.ts`), particles and pinned labels (`fx.ts`), minion combat (`combat.ts`), tavern effects (`effects.ts`), `?stats` panel (`stats.ts`), input and wiring (`view.ts`) |
| `frontend/test/` | Node tests for `core/` and the pure renderer modules (`npm run test:frontend`) |
| `frontend/src/game-api.ts` | TypeScript protocol types and HTTP helpers |
| `frontend/src/pieces.ts` | DOM badge helper, board scale and coordinate conversion |
| `frontend/src/combat.ts` | Combat presentation around the table: hero panels, phase and result text |
| `frontend/src/hero-effects.ts` | Hero panels, resource changes, hero attacks, armor fracture, defeat feedback |
| `frontend/src/board.css` | HUD layout, controls, damage starburst, hero presentation, overlay layers |
| `frontend/src/demo-art.ts` | Visible-card image loading and missing-art fallback |
| `frontend/src/demo-art.json` | Artwork provenance, card mapping, dimensions, and pinned SHA-256 values |
| `frontend/public/assets/tavern.png` | Former wooden board background, unused by the WebGL renderer |
| `frontend/public/assets/unknown-card.svg` | Local placeholder |
| `frontend/public/assets/official/` | Downloaded official PNGs, named by engine card ID |
| `scripts/restore_demo_art.py` | Repeatable restoration of artwork already listed in the manifest |
| `vendor/wheels/` | Original and patched native Python wheels |
| `vendor/taverngym/attack-impact.patch` | Combined replay patch against the pinned upstream commit |
| `vendor/taverngym/build-manifest.json` | Upstream identity, original checks, patched build fingerprint and wheel digest |
| `vendor/taverngym/LICENSE`, `NOTICE` | Engine licensing and third-party game-content notice |
| `work/combat-engine/` | Local patched Rust/Python source checkout |
| `work/combat-build/` | Local build helper, compiler cache, logs, wheel output, and static-serving helper |
| `work/art/full/` | Discovery scripts, cached official metadata, verification script, missing-art CSV |

The Git repository has commits on `main`, starting from the baseline `e3c80ec`, with no remote configured. Ignored files (`work/`, downloaded art, the vendored build environment) still live only in the working directory.

## 4. Installation and operation

The previously validated native environment was macOS 15.7.3 on Apple Silicon, Python 3.11.15, Node.js 25.6.1, npm 11.9.0, and Rust 1.98.1. `.python-version` and `.node-version` record the Python and Node versions. `.npmrc` enables exact dependency saves. Frontend dependencies currently pin Three.js 0.187.0, TypeScript 7.0.2, and Vite 8.3.5, together with their type packages in the lockfile.

Run the following from a checkout with the vendored wheel present.

```sh
cd /Users/cyrusyin/codebase/cloneBattlegrounds
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
.venv/bin/python scripts/restore_demo_art.py
```

The bundled patched wheel is `taverngym-1.0.0+impact2-cp310-abi3-macosx_11_0_arm64.whl`. Other operating systems and Intel Macs require a corresponding native build and an updated dependency path. Once installed, importing `taverngym` does not require the engine checkout to sit inside the application directory. The source tree is needed for rebuilding and investigating engine behavior.

Once dependencies and artwork are installed, normal local play uses the local service and cached assets. Artwork restoration and dependency installation require network access when their files are unavailable locally.

For normal development, start these in separate terminals from the repository root.

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev --workspace frontend
```

Open [the development board](http://127.0.0.1:5173/) and [the API documentation](http://127.0.0.1:8000/docs). Vite proxies `/api` and `/ws` to port 8000. Its host is loopback and its port is strict. With no scenario query, the page defaults to the targeted-spell demonstration. Select the random-game option to start ordinary hero selection.

The existing local preview uses a combined service on port 8001. Its helper exists only in ignored `work/`.

```sh
npm run build --workspace frontend
.venv/bin/python -m uvicorn work.combat-build.serve:app --host 127.0.0.1 --port 8001
```

The helper imports `backend.main:app` and mounts `frontend/dist` at `/`. Build before starting it, and rebuild after changing frontend code or restoring artwork. A fresh checkout needs this helper recreated or a maintained equivalent added to the application. The two-terminal development flow is available through the application files.

Existing browser tabs and server processes should be treated as temporary. Restart the Python process after replacing its native wheel. The native module already loaded by a running interpreter will otherwise remain active.

Use these checks when bringing up a new environment.

```sh
.venv/bin/python -m pip check
.venv/bin/python -c 'import taverngym; print(taverngym.game_version()); print(taverngym.build_info())'
.venv/bin/python -m pytest -q
npm run check:frontend
npm run test:frontend
npm run build --workspace frontend
```

Append `?stats` to the board URL for frame rate, CPU frame time and draw counts.

## 5. Client protocol and server guarantees

| Endpoint | Behavior |
| --- | --- |
| `GET /api/scenarios` | Lists scenario IDs and instructions |
| `POST /api/games` | Creates a random game, initially awaiting hero selection |
| `POST /api/games?scenario=hero_damage` | Creates a deterministic demonstration |
| `GET /api/games/{game_id}` | Reads the current projected snapshot |
| `POST /api/games/{game_id}/actions` | Submits one versioned semantic action |
| `/ws/games/{game_id}` | Sends a snapshot on connect, then returns a result for each submitted command |

The delivered browser uses HTTP. The WebSocket endpoint shares the same lock, version, and deduplication state, but does not broadcast all changes to every connected client. It is a command/response transport in the current implementation.

A snapshot contains `game_id`, top-level `version`, `state`, `legal_actions`, and `combat`. The adapter also selects an engine version field inside `state` where available. Use the **top-level session version** in requests.

The player's view includes the hero, powers, health, armor, gold, tier, prices, shop, hand, board, choices, casting state, and other engine-provided systems. Opponent projection includes public hero information and historical scouting fields. It excludes their current private hand, shop, and board. The response includes only the combat involving seat 0. Internal log text, action masks, random seed, and unrelated combats are excluded from the player protocol. This projection is a data boundary. It does not provide player authentication.

The request has this shape. Its action must be selected from the latest legal list.

```json
{
  "request_id": "a-new-unique-id",
  "version": 7,
  "action": { "kind": "buy", "shop_id": 123 }
}
```

| Action | Fields |
| --- | --- |
| `end_turn`, `refresh`, `freeze`, `upgrade`, `dark_gift`, `cancel` | `kind` only |
| `choose` | `option` |
| `target` | `target_id` |
| `hero_power` | `slot` |
| `buy` | `shop_id` |
| `activate`, `sell` | `entity_id` |
| `cast` | `hand_id` |
| `play` | `hand_id`, `position` |
| `move` | `entity_id`, `position` |
| `magnetize` | `hand_id`, `target_id` |

`sid` identifies a shop slot/entity, `hid` identifies a hand entry, and `eid` identifies a board entity. Card `id` identifies the card definition and artwork. Positions, power slots, and choice indices are zero-based. A reborn minion can retain its card ID while receiving a new entity ID.

A successful command increments the session version once and returns the new snapshot with `ok=true`. Reuse the original request ID, version, and action when retrying a command whose result is uncertain.

| Result | Status and behavior |
| --- | --- |
| Already applied request ID | HTTP 409, `duplicate_request`, original `applied_version`, current snapshot |
| Outdated version | HTTP 409, `stale_version`, current snapshot |
| Action outside the current legal list | HTTP 422, `illegal_action`, unchanged state |
| Bot advancement or snapshot projection fails | HTTP 500, `engine_error`, candidate discarded |
| Malformed request | HTTP validation 422, or WebSocket `invalid_request` |
| Unknown game | HTTP 404, or WebSocket closure |

The duplicate response contains the current snapshot rather than a cached original response. Deduplication records successful requests only and is scoped to one game. Locking makes concurrent submissions at the same version commit at most once. The service uses a copied game so a failed candidate does not partially charge gold or change cards in the published game.

The browser locks interaction while commands and playback run. On a request exception it reads the current game snapshot, then synchronizes the board. Its present recovery path performs a read rather than automatically resubmitting the original command. A future multi-connection client must explicitly reject older responses and preserve request identity across retries.

## 6. Recruit-phase interaction and presentation

The board uses a 1440 × 810 logical coordinate system, scaled to fit the viewport. Input coordinates are converted back into board coordinates. The layout is a desktop-oriented fixed board with a roster, shop, friendly warband, hand, hero controls, gold, status messages, choices, and tooltips.

Implemented interactions include the following.

- Buy by clicking a shop card or dragging it into the hand.
- Enlarge hand cards on hover and show the engine's Chinese card name and effect text in tooltips.
- Play a minion by clicking it or dropping it into a legal board position.
- Open a gap in the warband at the insertion point and highlight the valid drop zone during drag.
- Reorder friendly minions by dragging them along the board.
- Sell by dragging a friendly minion back into the shop row.
- Cast spells through the hand interaction, then select a legal target when the engine opens a targeting decision. Dragging a targeted spell out of the hand casts it at once and turns the drag into the targeting arrow: release on a legal target to apply it, release back over the hand to cancel, or release elsewhere and click a target. The snapshot marks hand spells `targeted` (the server casts each castable spell on a throwaway copy to find out, since the engine has no static targeting flag).
- Draw a curved SVG targeting arrow from the cast card and outline eligible card entities (green, gold under the pointer).
- Cancel a cancellable decision with the button, Escape, or a right-click on the table.
- Show keyword effects on cards: a riveted hammered-steel bulwark in a broad gilded rim behind Taunt minions, a round golden bubble (clear centre, gold rim) for Divine Shield, dense dark smoke over Stealth faces, white wind streaks sweeping across Windfury faces, a cracked silver-white shell for Reborn, and skull (Deathrattle) and poison-flask (Venomous/Poisonous) badges at the bottom centre of the card. Cleave has no mark. Runtime engine flags drive these, except Deathrattle, which is read from the printed `text` (`core/traits.ts`). Hand cards skip the frame and shells. The scene has a soft room environment map so metals reflect.
- Render hero-power controls, minion activation through card interaction, and the Dark Gift button when legal.
- Display generic hero-selection and discover/choice options from the engine's pending decision.
- Refresh, freeze/thaw, upgrade, and end the turn through engine-priced controls.
- Switch deterministic scenarios or restart with a fresh game.
- Display elimination and placement when the local player leaves the game.

Dragging captures the snapshot version. Valid drops submit a semantic action, and confirmed snapshots determine final placement. Invalid drops animate back. Prices and availability are read from the engine, including the shop's health-payment indicator where supplied.

The adapter and TypeScript action union expose `magnetize`, but the current drag/drop controller does not offer a dedicated magnetize gesture. Generic choices cover part of the engine's larger systems. Dedicated trinket, quest, reward, secret, buddy, scouting, and special-target interfaces need further coverage work. The TypeScript snapshot type also represents a narrower subset than the backend projection.

## 7. Tavern effects

These effects play after successful refresh, freeze, or upgrade responses. Rejected commands and network-resynchronization paths skip the shop success effect.

| Operation | Implemented feedback |
| --- | --- |
| Refresh | Departing card objects are detached from the shop and tumble toward the back of the table before shrinking away. New cards stay hidden, then flip in from the front right one by one. Retained slot IDs keep their objects and positions. |
| Freeze | Sweep a cold wave across the shop and grow a clear ice block on each card while it hops. The block persists according to each slot's `frozen` flag. |
| Thaw | Remove the block through the confirmed state update and shed ice shards from previously frozen slots. |
| Upgrade | Raise a gold crest sprite with the new tier over the shop, expand a ring on the table, emit gold shards, and hop the shop cards. |

Representative timing is roughly 260 ms for old-card departure, 460 ms for each new-card arrival, 440 ms for ice formation, and 980 ms for the upgrade crest. Effects remove their meshes and textures when they finish. The HUD button press stays a DOM animation. Under reduced motion, timed poses jump to their end and particles are skipped, while pauses between combat steps still hold so results stay readable.

## 8. Combat data and local engine modifications

The upstream project is **MCG-NJU/AutoTavern**. TavernGym is its native simulation package, exposed to Python. The application pins commit `fb61201a557ddd36a411cf44aac51ce4d9b606ce`. The patched package is **1.0.0+impact2**, with source fingerprint `ed272c64fc36aeea` and wheel SHA-256 `e3dadf8ffd2d82e04cbe4645de8683d9f8bdd1f7622803765c42657f6345efce`. The original upstream fingerprint is `c807e9aa1a6746ee`.

The combined patch changes `engine.rs`, `combat.rs`, `debug.rs`, and the Python package version. It adds presentation records around the existing engine damage operations.

**Minion contact records.** A combat frame includes ordered `attacks`, post-resolution `boards`, and optional `impacts`. Each impact identifies `from` and `to`, with a list of affected targets. A hit records actual returned `damage`, immediate `hp`, remaining `shield_hits`, `absorbed`, and `lethal`. The patch captures this data around direct attack damage, cleave neighbors, and retaliation, before deferred reactions and death processing erase the immediate state.

**Hero settlement records.** A combat record includes optional `heroes_before` and `heroes_after`, each a two-element array in combat-side order. Entries contain the hero card, health, armor, and tier. These are snapshots immediately around combat-result application and its reactions. `heroes_before` means before settlement damage, rather than the beginning of the minion fight. The ordinary debug-preview record initializes these new fields to null entries. Live settlement provides actual snapshots.

The added serialized fields have defaults so older saved engine states can still be loaded. Legacy frames without `impacts` retain attack movement but cannot provide precise contact damage badges. Legacy records without hero snapshots rely on final state synchronization for hero counters.

Combat sides require explicit mapping. `a` is a player seat, `b` is a player seat or null for a ghost. `winner=0` means side A won, `winner=1` means side B won, and `winner=2` means a tie. The friendly side is `0` when `a` matches the local seat, otherwise `1`. The final `damage` already includes the engine's damage cap. Keep this amount authoritative.

`GameSession` enables `set_record_log(True)`. Without recording, combat frames are empty. The latest combat may be returned in several successive snapshots. The current controller recognizes a new combat by turn within its active game. A persistent/reconnecting client should use `(game_id, combat.turn)` as its replay identity.

## 9. Combat animation behavior

For each frame, the client first plays its ordered impacts against the currently displayed bodies. It then removes dead entities, reconciles the next board snapshot, and animates newly appearing entities. Entity IDs connect contacts to visible pieces. Deathrattle summons and reborn replacements are represented through these frame changes.

`core/combat-script.ts` turns a replay into ordered steps (contacts, resolved boards, deaths, summons, shield breaks), local side first. On the table the hand sinks below the screen, the shop clears, and the opposing warband drops into the shop row as `enemy:eid` objects. The friendly warband keeps its recruit objects (`board:eid`), since combat uses the same entity IDs; minions that die in combat grow back when the recruit snapshot returns.

Minion attacks rise toward the camera and hold, lunge to contact, make the defender recoil and flash, and return on a raised arc. Each card's shadow stays on the table and grows softer as it lifts. The attack approach is approximately 450 ms, followed by an 80 ms contact hold and a 330 ms return.

At contact, both participants receive their own yellow damage starburst (a DOM label pinned to the card through recoil) and their face redraws with the immediate health. Shield absorption displays “抵挡” and sheds gold shards. Damage text remains visible before dead entities shrink away. Summoned entities grow into place. Ordered impacts preserve successive Windfury hits within one frame.

The hero panels appear at the top and bottom during combat, with separate armor and health counters over cropped official portraits. The enemy panel is hidden on return to recruitment. Ghost presentation hides ordinary health and armor counters. A winning player does not attack a defeated ghost hero.

Recruit actions that change the local hero's resources immediately produce counter pulses, colored floating deltas, and a portrait flash. Armor reaching zero creates metal fragments. Healing and resource gains use positive deltas.

After minion combat, the client reconciles accumulated hero changes to `heroes_before`. For a non-tied result with positive damage, the winning hero displays its attack amount, rises and pauses, then lunges toward the losing hero. Contact triggers recoil, a damage burst, resource changes, and armor fracture where applicable. The displayed hit amount uses the net loss of armor plus health across the engine's settlement snapshots. A zero net loss displays “抵挡”. Fatal settlement adds a darkened defeat effect. The final recruit/game-over snapshot then takes over.

Hero changes from end-of-turn or in-combat skills currently appear as a net update after the minion fight. The data does not preserve each such hero event and its original timestamp. Also, a settlement that deals damage and then heals or rewinds it can only be presented as its net change. Extending structured events is the next step toward exact trigger-by-trigger playback.

## 10. Deterministic demonstrations and verification

Scenarios use seed 17, select the first offered hero for each seat, inject demonstration cards or stats, and end the other seats' first turn. Normal bot behavior resumes on the following turn. Injected initial minions do not consume ordinary shared-pool copies, so these setups are animation and interaction fixtures.

| Scenario | Verification path |
| --- | --- |
| `recruit` | Buy Southsea Busker, play it beside Wrath Weaver, move it, or end turn to see a hero victory against an empty opponent |
| `target` | Cast Banana Bunch on Harmless Bonehead and confirm +2/+2 |
| `triple` | Buy the third Wrath Weaver, play the golden minion, cast the triple reward, and resolve the discover |
| `deathrattle` | End turn and observe shield loss, two Skeleton summons, and Windfury contacts across five frames |
| `collision` | First exchange deals 58 and 100 simultaneously, leaving 48 and 54 health on the respective recipients, then a second exchange kills both |
| `reborn` | Watch Risen Rider return with 1 health and a new entity ID |
| `hero_damage` | End turn, take 2 hero damage, break 1 armor, and change health from 30 to 29 |
| Random game | Select `random` in the UI, or omit the API scenario parameter, to exercise ordinary hero selection and bot play |

Example URLs use `?scenario=collision` or `?scenario=hero_damage` on either the development or combined-preview origin. Restarting a scenario creates a new independent session.

Fresh handover verification on 9 November 2026 passed **31 backend tests** and the TypeScript check. After the Three.js migration the same day, **14 frontend tests** passed and the browser checks covered drag buy, drag play, spell targeting, the `deathrattle`, `collision` and `hero_damage` combats, refresh, freeze, thaw and upgrade. All **3,273 pinned artwork files** exist and match their manifest hashes. The loaded native module fingerprint matches the patched build manifest.

The automated tests cover legal and illegal actions, stale and repeated requests, simultaneous commits, HTTP/WebSocket deduplication, rollback after bot failure, player-view privacy, selection follow-ups, buy/play/move/sell flows, deterministic scenarios, shield and Windfury contact details, deathrattle and reborn identity, simultaneous lethal damage, hero armor absorption and overflow, fatal hero damage, Ice Block, opponent damage on victory, preserved historical settlement, ties, and loading old states without hero snapshot fields.

Historical verification from the implementation sessions includes a successful production build, 15 native Rust library tests for the patched build, and browser checks of the recruit interactions, shop effects, both hero attack directions, recruit self-damage, and final resource values. The original upstream build manifest separately records 858 Rust tests, 46 Python tests, and 20 isolated games with zero truncated combats. Those original counts describe the earlier upstream validation, not a fresh full-suite run of every later patch.

There is no committed automated browser test suite or visual regression baseline. Existing screenshots and logs are useful examples, but do not replace systematic UI coverage.

## 11. AI opponents

Offline opponents use the pinned engine's built-in heuristic `bot_action(seat)`. The Python adapter has no custom learned policy or separate AI service. The upstream policy is cheap and deterministic given game state and RNG, which makes it useful for reproducible POC play.

Its rough minion value is attack plus health plus three times tier, with a golden bonus of 6 and a bonus of 3 for each of Divine Shield, Taunt, Reborn, Windfury, and Venomous. Spells receive a simple tier-based value. Shopping adds a bonus of 15 when another copy is already owned.

The policy resolves pending choices, plays available hand cards, magnetizes where legal, upgrades on a loose gold/turn curve, sells a weak minion when an affordable replacement is sufficiently better, buys high-value cards, uses available powers and Dark Gifts, activates minions, refreshes within bounds, and ends the turn. Hero and quest choices include RNG. Discover choices favor item value. Target choices favor the strongest friendly minion. Trinket selection picks the first affordable option.

`advance_bots()` drives seats 1–7 until seat 0 needs a decision, is eliminated, or the game ends. A no-progress check and a 40,000-step guard prevent the adapter from looping indefinitely. The upstream policy also has per-turn action limits. This is baseline opposition. Composition planning, strong positioning, tactical search, difficulty settings, and trained policies remain future work.

## 12. Artwork and provenance

The manifest was collected on 3 November 2026 and contains **3,983 engine card entries**. It has pinned official image sources for **3,273 entries**, leaving **710 without a source**. Among **1,163 entries marked reachable by the engine**, **1,141 have artwork**, or approximately **98.1%**, leaving **22 reachable entries missing**. “Reachable” includes more than shop-pool minions.

The official source cache contains roughly 680 MB of PNG data before filesystem accounting. Normal and golden cards use their own mappings where available. The discovery work queried the Chinese official tavern catalog by numeric DBF IDs, tried its constructed-card catalog for remaining entries, and used linked golden rendering fields. Official news articles supplied 19 additional images. The Dark Paradox variants were matched by tier/effect and ordinary/golden form. The per-card source URL and optional `source_page` preserve provenance.

The runtime loads only visible local images using the engine card ID. It decodes each requested image before use and caches failed IDs for the page lifetime. Missing art uses the local placeholder. The large provenance manifest stays out of the JavaScript bundle. Reload after restoring a file that was already recorded as unavailable in the current page.

`scripts/restore_demo_art.py` restores known sources with six workers, skips files whose hashes already match, retries selected temporary HTTP/network failures, verifies downloaded bytes against the pinned SHA-256, and installs files through temporary-file replacement. A changed upstream image fails the pinned hash check and requires an explicit provenance update. This script restores a fixed catalog. Automatic discovery of newly available artwork is still in ignored `work/art/full/` scripts.

Official card faces can contain text and numbers from a different patch. Board stat badges and tooltips use engine state. Full card images can still show their baked-in text. Keep this distinction visible during parity validation.

The reachable missing IDs at handover are listed below for continuity.

```text
BG26_813t                BG30_802
BG30_MagicItem_416t      BG31_893
BG35_910                BG35_911
BG35_MagicItem_733t      BG35_MagicItem_755t
BG36_MagicItem_372       BGFYM_000
BGFYM_000_G              BGFYM_002t
BGFYM_002t_G             BGFYM_011
BGFYM_011_G              BG_OldGod
EBG_Spell_014            TB_BaconShop_HP_036t
TB_BaconShop_HP_039t     TB_BaconShop_HP_065t2
TB_BaconShop_HP_085t     TB_Bacon_Secrets_12
```

The engine code is accompanied by MIT licensing. Its NOTICE separately identifies Blizzard game content. The user's approved asset use is personal local testing. Preserve provenance and revisit distribution rights when packaging or publishing the application.

## 13. Rebuilding the engine and preserving the handover

Use the upstream commit and apply the combined patch once. `attack-impact.patch` already includes both the minion contact and hero settlement additions. An example build sequence on a machine with the appropriate Rust/Python toolchains is below. Use a fresh source checkout if `work/combat-engine` already contains the patched tree.

```sh
cd /Users/cyrusyin/codebase/cloneBattlegrounds
git clone https://github.com/MCG-NJU/AutoTavern work/engine-rebuild
git -C work/engine-rebuild checkout fb61201a557ddd36a411cf44aac51ce4d9b606ce
git -C work/engine-rebuild apply /Users/cyrusyin/codebase/cloneBattlegrounds/vendor/taverngym/attack-impact.patch
.venv/bin/python -m pip install 'maturin>=1.15,<2'
cd work/engine-rebuild
../../.venv/bin/python -m maturin build --release -i ../../.venv/bin/python -o ../../vendor/wheels
```

Install the resulting platform-specific wheel, update both Python requirements files when its path changes, and update the patched build manifest with the new source fingerprint and wheel hash. Run the API/engine checks and restart the service. Future rule updates should pin a new upstream baseline, review action layouts and card IDs, reapply or revise the patch, and validate both mechanics and replay compatibility.

The local build helper currently references toolchains under `/Users/cyrusyin/Documents/Codex/2026-11-03/di/work/`. Those paths are machine-specific. Copying `work/combat-build/build.sh` alone does not recreate that environment.

Preserve the source files, lockfiles, wheel, combined patch, provenance manifest, selected board background, and tests together. The downloaded art can be restored from the manifest while sources remain available. If transferring the existing cache for local testing, retain its checksums and provenance. Ignored files worth retaining as optional evidence include `work/hero-impact.jpg`, `work/hero-victory.jpg`, `work/shop-upgrade.jpg`, `work/art/full/missing-card-art.csv`, and `work/combat-build/hero-rust-tests.log`.

## 14. Remaining work and recommended sequence

The following sequence proposes priorities and acceptance criteria for future development.

| Priority | Work | Completion criterion |
| --- | --- | --- |
| P0 | Establish the repository baseline and reproducible startup | A fresh checkout on the supported platform can install, restore assets, run tests, and launch the board without the original machine's ignored helpers |
| P0 | Complete the structured event model | Ordered records represent triggered damage, buffs, healing, summons, deaths, shield changes, and hero resource events at their actual point in combat. Playback can reconstruct intermediate states and finish at the authoritative snapshot |
| P0 | Audit rule and UI coverage | Every supported legal action has an accessible UI path, including magnetize and special targets. Track tested cards/heroes/mechanics against the pinned rules version and record discrepancies |
| P1 | Harden replay and client recovery | Handle interrupted/cancelled animation, read failures, duplicate combat delivery, stale responses, missing entities, and truncated combats while preserving server state and restoring usable input |
| P1 | Complete game-system panels | Add appropriate trinket, quest, reward, secret, buddy, Dark Gift, and scouting views, with explicit coverage for the systems enabled by the engine |
| P1 | Improve visual consistency | Check art crops across golden cards, tokens and odd layouts, keep the current text sizes, then refine golden frames, attachment indicators, audio, and battle transitions. Verify reduced motion and multiple viewport sizes in a foreground browser |
| P1 | Make artwork updates repeatable | Promote metadata discovery into a maintained command, report coverage by reachable content/type/version, fill missing official assets, and review changed hashes explicitly |
| P2 | Add persistence and actual multiplayer | Introduce room and seat ownership, multiple human decisions, a per-game action queue, turn timing, reconnect/resume, per-seat views, and pushed snapshots. Verify concurrent human clients in one LAN game before Internet deployment |
| P2 | Strengthen offline AI | Add composition and economy planning, target-aware evaluation, positioning, and difficulty policies. Evaluate against the current bot on fixed seeds using placement, latency, and illegal-action rates |
| P3 | Choose delivery and distribution | Profile the WebGL renderer in a foreground browser (GPU time, frame pacing), and evaluate browser versus a desktop wrapper with a local Python sidecar. Build and verify native wheels for each target platform |

LAN and Internet multiplayer are architectural work still to be implemented. Binding the present server to a network interface would expose the same seat-0 command service. Internet readiness additionally needs player identity/authorization, room isolation, transport security, lifecycle cleanup, and operational controls. A desktop build also needs a process lifecycle for the Python service, bundled assets and wheels, port management, and save locations.

The one-off comparison against the former CSS renderer (commit `4ae870b`, same scenarios, 1280 × 720 and 960 × 540) found the following. The WebGL renderer used about 0.1 ms of CPU per frame on average (2.4 ms worst, when a face redraws) with 21–25 draw calls and under 1,000 triangles, and the page keeps about 64 DOM elements. The CSS renderer reached 107 elements and 16 concurrent animations in the same combat, and both played the `deathrattle` combat in about 10 seconds. Compositor and GPU time could not be measured because the test browser was a throttled background pane. At that point the CSS version read better: the procedural faces' names and gems were hard to read at 960 × 540. The faces were then re-laid out (names on up to two lines, larger stat, tier and price gems) and the shop row is scaled to offset its distance, so at 960 × 540 a card is about 80 px wide with names near 11 px and stats near 15 px, comparable to or larger than the former DOM badges. Faces have since gained the cropped official illustrations.

The most useful next vertical slice is a combat with minion contact, a triggered effect, a deathrattle summon, hero resource changes, and final hero damage, all played from an ordered event stream. It should also survive interrupted playback and reconcile to the authoritative state.

## 15. Reference material

The local source, manifest, and tests are the basis for the implementation details in this handover. Upstream links below are pinned where possible. The official browser was reachable during handover preparation. The supplied wiki pages were inaccessible through the research tool and are retained as background references with no newly verified rules claims.

| Reference | Use |
| --- | --- |
| [AutoTavern repository](https://github.com/MCG-NJU/AutoTavern) | Upstream project, license, simulator and benchmarking context |
| [Pinned source tree](https://github.com/MCG-NJU/AutoTavern/tree/fb61201a557ddd36a411cf44aac51ce4d9b606ce) | Reproducible engine baseline |
| [TavernGym guide](https://github.com/MCG-NJU/AutoTavern/blob/fb61201a557ddd36a411cf44aac51ce4d9b606ce/docs/TAVERNGYM.md) | Engine interfaces and usage |
| [Pinned bot policy](https://github.com/MCG-NJU/AutoTavern/blob/fb61201a557ddd36a411cf44aac51ce4d9b606ce/crates/taverngym/src/bot.rs) | Current offline opponent behavior |
| [Pinned rules configuration](https://github.com/MCG-NJU/AutoTavern/blob/fb61201a557ddd36a411cf44aac51ce4d9b606ce/crates/taverngym/src/config.rs) | Rules and configuration defaults |
| [Chinese official Battlegrounds browser](https://hs.blizzard.cn/battlegrounds/?sort=tier%3Aasc) | Original product/card reference and artwork discovery entry point |
| [Official tavern catalog endpoint](https://webapi.blizzard.cn/hs-cards-api-server/api/web/cards/tavern) | Metadata endpoint used by the importer, queried with POST requests |
| [Official constructed catalog endpoint](https://webapi.blizzard.cn/hs-cards-api-server/api/web/cards/constructed) | Additional exact-ID lookup used during asset collection |
| [Official trinket announcement](https://hs.blizzard.cn/news/24143781/) | Supplemental artwork provenance |
| [Official 31.6 notes](https://hs.blizzard.cn/news/24179332/) | Supplemental artwork provenance |
| [Official Aberration announcement](https://hs.blizzard.cn/news/24302091/) | Dark Paradox form references and additional artwork |
| [Huiji Battlegrounds overview](https://hearthstone.huijiwiki.com/wiki/%E9%85%92%E9%A6%86%E6%88%98%E6%A3%8B) | User-supplied background reference |
| [Chinese Fandom Battlegrounds overview](https://hearthstone.fandom.com/zh/wiki/%E9%85%92%E9%A6%86%E6%88%98%E6%A3%8B?variant=zh-hans) | User-supplied background reference |

For the current machine, start with the [application README](/Users/cyrusyin/codebase/cloneBattlegrounds/README.md), [build manifest](/Users/cyrusyin/codebase/cloneBattlegrounds/vendor/taverngym/build-manifest.json), [combined replay patch](/Users/cyrusyin/codebase/cloneBattlegrounds/vendor/taverngym/attack-impact.patch), and [artwork manifest](/Users/cyrusyin/codebase/cloneBattlegrounds/frontend/src/demo-art.json). These absolute links are specific to this workspace. Repository-relative paths in the implementation map remain usable after moving the checkout.
