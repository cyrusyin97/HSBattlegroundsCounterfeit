# Combat timeline and turn timer plan

Status (2026-11-13): phase 1, real-time combat playback, is built; see "Phase 1 as built" below. The turn timer (phase 2) is not started. Sound is out of scope; the last section notes how it can use the same timeline later.

This plan has two goals:

1. **Combat playback runs on real time.** Today it runs on rendered frames, so it stops in a background tab.
2. **The recruit phase gets a time limit.** The server is authoritative for it.

The turn timer follows the game's rule: every player is timed separately, but each round has a fixed length that covers combat and the next recruit phase. A player whose combat is short has more recruit time; a player whose combat is long has less. The server therefore never needs to know how long a combat lasts to set a deadline.

The combat schedule still has to be deterministic, for a different reason: the client must be able to draw the correct state at any time `t`, including after a background tab or a reload.

## The problem today

Playback advances only while frames are drawn:

- `three/stage.ts` drives every update from `renderer.setAnimationLoop`, which is `requestAnimationFrame`. A background tab gets no frames, so time stops.
- The frame step is clamped with `Math.min(0.05, …)`. After 10 s in the background, the first frame back advances 0.05 s, so the combat resumes where it stopped instead of catching up.
- `three/motion.ts` `Clock.tween` and `Clock.wait` accumulate that frame `dt`. `three/combat.ts` `playCombat` is a sequential async script of tweens and waits.
- Outside the clock:
  - `combat.ts` shows the result, then waits on `setTimeout(850)`. Background tabs throttle timers to once a second, and to once a minute after several minutes.
  - `hero-effects.ts` (`finishHeroCombat`) and the damage labels in `three/fx.ts` use the Web Animations API (`el.animate`) and await `finished`. So one combat runs on three different clocks.

The end states are already authoritative, which makes jumping in time safe:

- `settle(step)` sets both rows from the server's resolved boards.
- `hit()` sets each target's health from the replay's `hp`.
- Nothing is computed during playback that a jump would skip.

## Design

### 1. A combat is a schedule

Before playback, the replay is compiled into a schedule. Each event has a kind, a start time in milliseconds from the combat start, a duration, and the entity IDs it refers to. Three rules keep it deterministic:

1. **Durations are named constants in one module.** The schedule is a pure function of the replay, the player's pre-combat snapshot and those constants. Rendering only samples it.
2. **No branch reads render state.**
   - Today an attack only waits 780 ms when its attacker or defender object is missing or `removing` (`three/combat.ts`). That becomes a rule on replay data: was the minion already dead, or absent, before this step?
   - Reduced motion changes how the schedule is drawn, never the schedule. Today `Clock.tween` jumps to the end under reduced motion while `Clock.wait` still waits; with a schedule, every event keeps its duration and reduced motion draws end poses.
3. **Nothing holds the schedule back.** Texture loading, image decoding and shader compilation can make a frame late, but `t` comes from the clock, so a late frame shows a later point instead of delaying the combat.

The current choreography gives the timing constants, unchanged:

| Event | Duration (ms) | Notes |
|---|---|---|
| Attack, both minions shown | 1240 | Lunge 450, contact at 450, recoil of the defender 310 from 450, pause 80, return 330, pause 380 |
| Attack, a minion missing | 780 | Hits apply at the start |
| Deaths after a step's attacks | 230 | Only when a minion dies |
| Settle the resolved boards | 520 / 290 / 0, then 280 | 520 for the first step (the enemy warband drops in), 290 when a later step summons, else 0 |
| Hero vitals before the hit | 850 | Only when `heroes_before` differs from the pre-combat values |
| Hero attack | 400 + 600 + 950 | Damage badge, lunge, contact effects (the longest of burst 950, recoil 420, return 500, vitals 850) |
| Hero defeated | 400 | Only when the loser's health reaches 0 |
| Result hold | 850 | The result text stays before the recruit table returns |

The schedule is compiled on the client, in a renderer-independent module that runs under Node (`core/combat-timeline.ts`). The server does not need it for deadlines. It would need the same rules only if it enforced a cap on combat length (see the turn timer below). In that case, move the constants to a JSON file that both sides read, and compile in Python too, with a test that both give the same durations for the same replays.

### 2. Rendering samples the schedule at time t

The playback position is `t = now − start`, where `now` is `performance.now()`, which keeps running in a background tab. It is never an accumulated frame `dt`.

- **Each frame:** an event in progress at `t` sets its minion's pose by sampling its keyframes at `(t − event.start) / event.duration`. The keyframes are the existing `samplePose` lists. A minion with no active event follows its spring as today.
- **State changes when `t` passes them:** health from hits, shields, removals, settled boards. These are applied in order. A jump over several events applies all of them.
- **Short-lived effects:** damage labels, particle bursts, the card flash. They play when `t` crosses their start during normal frames. After a gap (the first frame after a background tab, or any frame more than about 250 ms after the previous one), effects whose time has already passed are skipped. An effect still in progress is shown at its current point.
- **Springs:** after a gap, every card snaps to its goal pose (a new `snap()` on `CardObject`) instead of easing from where it stopped.
- **Web Animations:** the hero phase and the labels create their animations paused, and each frame sets `animation.currentTime = t − event.start`. Jumps come for free, and the whole combat has one clock. The `setTimeout(850)` becomes the "Result hold" event.
- **A background tab draws nothing,** and nothing is needed. The first visible frame shows the state at the current `t`. A combat that ended while hidden shows the recruit table directly.

### 3. The server gives the start time

The response that finishes a combat carries when it started, and every response carries the server's clock:

```json
"combat": { "…replay fields…": "", "started_at": 1763000000000 },
"server_now": 1763000000042
```

- **Reload mid-combat works.** `started_at` is in epoch milliseconds. A client that reloads during a combat compiles the schedule and starts at `t = server now − started_at`. If the combat is already over, it shows the recruit table.
- **Clock offset.** The client keeps `offset = server_now − Date.now()`, using the response midpoint as an estimate, and converts server times to `performance.now()` once per response.

### 4. Turn timer, server-authoritative

The engine has no notion of time. `RulesConfig.turn_action_caps` caps the number of actions, not seconds, and stays as it is. The deadline lives in the backend.

**The deadline.** Each round has a fixed length `T(n)` that covers its combat and the next recruit phase:

```
recruit deadline of turn n+1 = combat start of turn n + T(n)
```

- The combat starts when the player ends the turn, or when the deadline expires. Today one human player plays, so the combat starts at that player's end of turn. With several human players later, a combat starts when every player in the lobby has ended the turn or the deadline passes, and all of them get the same next deadline.
- The combat's length only splits `T(n)` between watching the combat and recruiting. A long combat leaves less recruit time; it never moves the deadline.
- The first turn has no combat before it: its deadline is the moment the hero is chosen plus the first recruit time.
- `T(n)` is a table by turn, set in `backend/` and overridable by an environment variable for testing. Its values are an open question.

**A combat longer than the round.** A very long combat could leave little or no recruit time. There are two ways to guarantee a minimum recruit time, and they differ in who needs the combat's length:

- **The client fits playback to the time available** (no server change). If the schedule would end later than `deadline − minimum recruit time`, the client speeds the playback up or skips to the result. The deadline stays fixed.
- **The server extends the deadline.** It computes the combat's length from the replay and sets `deadline = max(start + T(n), start + duration + minimum)`. This needs the schedule rules on the server too (see section 1).

The client-side option keeps the server independent of animation timing, and is recommended unless the deadline must account for the full combat.

The snapshot carries `state.deadline` (epoch milliseconds). The client only shows a countdown.

**Expiry is applied lazily.** There is no timer thread. Before handling any request for a game (`read`, `submit`, the WebSocket), the session checks `now ≥ deadline`. If so, it ends the turn on the player's behalf:
1. Any open choice (discover, target, choose one) is resolved with a default. The same default the bots use (`game.bot_action(0)`) is the simplest.
2. Then End Turn is played.
3. Bots advance. The combat gets `started_at = deadline`, not the time of the request, and the next deadline is `deadline + T(n)`.

Then the request itself is handled. An action that arrives after the deadline therefore finds a newer version and gets `stale_version` with the new snapshot, which carries the combat. That is the normal resync path in `core/session.ts`.

When the countdown reaches zero, the client sends `GET /api/games/{id}`, which applies the expiry and returns the combat. The client also drops any drag or targeting in progress.

**Locking and versions.** Expiry runs inside the session lock, like `submit`. It builds the candidate on a copy and saves before publishing. It bumps the version, and records no request ID.

**Saves.**
- `Save` gets a `deadline` field. `SaveStore` adds a `deadline` column, with `ALTER TABLE … ADD COLUMN` when an older file lacks it. A save with no deadline gets one on load (now + the turn's recruit time).
- The deadline is absolute, so it survives a restart. If the server was down past a deadline, the next request expires the turn as usual. Whether downtime should instead extend the deadline is an open question.

**A player away for a long time.** With lazy expiry, nothing happens while no request arrives. The next request would owe several turns. The rule needs deciding (open question):
- (a) catch up turn by turn, ending each one, which can eliminate an absent player; or
- (b) expire at most one turn per request; or
- (c) pause the deadline while no client is connected (the WebSocket or a recent request).

For a single-player game, (b) or (c) is friendlier. (a) matches a real lobby.

### 5. Sound (later)

Not in this plan. The event schedule is what sound needs. Web Audio can schedule each event's sound at `audioContext.currentTime + (event.start − t) / 1000` when playback starts or resumes, so sound and picture share one timeline without frame callbacks.

## Changes by file

**Frontend**
- `core/combat-timing.ts` (new): the duration constants, named by event.
- `core/combat-timeline.ts` (new, renderer-independent, runs under Node):
  - Compiles a replay and the pre-combat snapshot into the schedule, from `core/combat-script.ts` steps.
  - Decides missing minions from replay data.
  - Provides `activeAt(t)`, the events crossed between two times, the gap rule, and fitting the schedule into a time budget (if the client-side cap is chosen).
- `three/combat.ts`: from an async script to a `CombatPlayback` with `render(t)`. It keeps the keyframe construction (`hover`, `hitPose`, `back`, `lift`), now keyed by event, and drops the `removing` check.
- `three/motion.ts`: absolute-time sampling next to `Clock` (`drive` takes a start time and samples). `Clock` stays for recruit-phase effects in `three/effects.ts`, which are out of scope.
- `three/stage.ts`: pass the frame's `now` to callbacks with the clamped `dt`, and report a gap.
- `three/entities.ts`: `snap()` to the goal pose.
- `three/fx.ts`: labels take a start time and are driven through `currentTime`; skipped when already past.
- `hero-effects.ts`: the hero phase as paused animations driven by the timeline, instead of an awaited sequence.
- `combat.ts`: start playback at `started_at`; no `setTimeout`.
- `board.ts`:
  - Keep the busy lock until `t ≥ duration`.
  - Resume a combat in progress after a reload.
  - Add the countdown, and send the `GET` at zero.
- `game-api.ts`: types for `started_at`, `deadline`, `server_now`.
- `i18n` and styles: the countdown.

**Backend**
- `backend/game_session.py`:
  - Record `started_at` when a combat happens and attach it to the combat in `player_snapshot`.
  - Keep `deadline` on the session and in the snapshot.
  - Add `expire_if_due()`, called under the lock at the start of `read` and `submit`.
  - Store the deadline in the save.
- `backend/store.py`: the `deadline` field and column, with the migration for older files.
- `backend/main.py`: `server_now` in every game response; the `T(n)` table and its environment override; the WebSocket path calls the same expiry.
- `backend/tests/test_turn_timer.py` (new):
  - The deadline is in the snapshot and equals the combat start plus `T(n)`, whatever the combat's length.
  - Expiry on read; `started_at` equals the old deadline.
  - An action after the deadline gets `stale_version` and the combat.
  - A pending choice is resolved.
  - The deadline survives a restart.

**Docs:** `HANDOVER.md` (combat animation behaviour and the snapshot fields), and `DEPLOY.md` if `T(n)` gets an environment override.

## Phases

1. **Real-time combat playback.** This fixes the reported background-tab bug, with no timer yet.
   - Client: compiles the schedule, renders it at `t`, puts the hero phase and labels on the same clock, and resumes a combat after a reload.
   - Server: only `started_at` and `server_now`.
2. **Turn timer.** The deadline, lazy expiry, default choices, the save field, the countdown and the zero-time `GET`. Ship it behind a setting (no deadline when unset) until `T(n)` is tuned. Includes the combat-length cap once that rule is chosen.
3. **Polish.** The warning style near zero, and what an ended turn looks like when the client was away. Expiry while a request is in flight is covered by the stale-version path, but needs a test with a slow network.

## Phase 1 as built

- As planned: the schedule (`core/combat-timeline.ts`, constants in `core/combat-timing.ts`), the `Timeline` (`core/timeline.ts`), minion combat as cues and a pose function (`three/combat.ts`), the hero phase on the same timeline (`hero-effects.ts`), `started_at` and `server_now` from the server, and resuming a combat after a reload.
- Added: `combat.heroes_start`, the heroes as they were before the action, so a reload in the middle of a combat shows and schedules the hero phase like the first playback.
- Changed from the plan: hero panels and damage labels are not driven frame by frame. They are ordinary browser animations, which already run on real time; a cue that runs late starts its animation part-way. Driving them from script every frame moved filter animations off the compositor.
- Found while measuring: the old async script ran each state change after the frame had been drawn, so a redrawn card face was uploaded a frame later. Running state changes before the draw makes every face upload wait for the canvas to finish drawing (about 10 ms per card, 650-820 ms per combat). Two stopgaps (CPU canvases, uploading a frame later) brought frames back to the old level, as measured below, but were reverted. A separate change then drew the numbers from a shared glyph atlas and shared face pictures between cards (`three/numbers.ts`, `FaceCache` in `three/entities.ts`), so a number change uploads nothing: 17 face uploads per combat instead of 58, and none at contact.

Measured on the `late` scenario (a 20.7 s combat, three runs each, headless Chrome on this Mac), with the stopgaps in place (later replaced by the atlas):

| | Before | After |
|---|---|---|
| CPU per frame, mean / p95 / max | 0.84-0.99 / 1.5-1.7 / 20-27 ms | 1.04-1.12 / 1.7-1.8 / 10-19 ms |
| Long tasks (over 50 ms), without art | 1-2, up to 84 ms | 0-1, up to 79 ms |
| Long tasks, with art (image decoding) | 1-3, up to 140 ms | 2, up to 145 ms |
| Longest gap between frames | 167-183 ms, when the recruit table returns | 150-167 ms, same place |
| Hidden 3-11 s into the combat | the combat resumes where it stopped | input unlocks at 20.70 s, as without hiding |
| Reloaded 5 s into the combat | the combat is skipped | it resumes; the result shows at 19.87 s (19.83 s without reloading) |

## How to verify

- **Deterministic schedules** (Node, `frontend/test/combat.test.ts`):
  - Fixed replays (from the scenarios: `late`, a combat with deaths and summons, a hero kill, a ghost) give fixed event lists and total durations. Compiling twice gives the same result.
  - A minion that died in an earlier step gets the short attack.
  - The schedule is the same with reduced motion.
- **Timeline sampling** (Node):
  - `activeAt` and crossed events at the boundaries.
  - A jump from 0 to the end applies every state change and no short-lived effect.
  - A jump into the middle of an attack shows the attack at its current point.
- **Background tab** (headless Chrome, like the earlier frame-timing scripts):
  1. Start a combat.
  2. Bring another tab to the front for longer than the combat.
  3. Switch back.
  4. The first frame shows the recruit table with the resolved boards, and the combat took no longer than its scheduled duration on the wall clock.
  Repeat with a switch back in the middle, and check the playback position against `now − started_at`.
- **Slow frames:** throttle the CPU in developer tools during a combat. The combat still ends at its scheduled time; frames are fewer, not later.
- **Reload mid-combat:** reload halfway through. Playback resumes at the server's position, not from the start.
- **Turn timer**, with a short `T(n)` from the environment override:
  - The turn ends on its own at zero.
  - A short and a long combat in the same turn number give the same deadline.
  - An action sent after zero gets the new snapshot.
  - A restart past the deadline expires the turn on the next request.
  - An open discover is resolved.
- **Regression:** the existing backend and frontend suites, the screenshots in `docs/screenshots` with `?noart`, and the server timing of an action.

## Open questions

1. **`T(n)`:** one fixed round length, or one that grows with the turn number? Does a pending choice get extra time?
2. **Combat longer than the round:** what minimum recruit time, and is it kept by the client speeding up or skipping playback (recommended), or by the server extending the deadline? The second needs the schedule rules on the server.
3. **A player away for a long time:** catch up every turn, one turn per request, or pause while disconnected?
4. **Downtime:** does a server restart past a deadline expire the turn, or extend it?
5. **Default for an open choice at expiry:** the bot's choice, the first option, or cancel where cancellable?
6. **Grace window:** a short allowance (for example 300 ms) for an action sent just before zero that arrives just after?
7. **Playback speed:** a player-chosen speed would only change how the round's time is split, as long as the client-side cap keeps the minimum recruit time. Wanted later?
