# Local training plan

Status: plan only, not started. Bot work has been on hold since 2026-11-10 (see `docs/BOTS.md`). This document records what a trained bot policy would take if the work resumes.

The goal is stronger offline opponents for the human player than the engine's built-in heuristic, with the option of a difficulty ladder. Beating real players on a live ladder is out of scope.

## Where things stand

Every bot policy tried so far is written by hand, and none beats the built-in heuristic. Placements are on fixed seeds against the heuristic in the same seat; lower is better.

| Policy | Who decides | Paired difference vs built-in |
| --- | --- | --- |
| `builtin` | Engine heuristic (`bot.rs` in the engine) | 0.00 (mean placement 4.45 over 200 seeds) |
| `jev` | Jev judgments, hand-written rules | +1.68 ± 0.75 (40 seeds) |
| `hybrid` | DeepSeek plans, Jev judgments, rules | +1.00 ± 0.70 / +1.05 ± 1.04 (40 seeds) |

`jev` and `hybrid` live on the local branch `jev-policy`, with their design and results in `docs/JEV.md` on that branch.

## Bottlenecks

1. **Nothing learns from outcomes.** Every policy is either rules or prompts. A hand-reviewed hybrid game (seed 7, in `docs/JEV.md` on `jev-policy`) lost on judgment, not format. It miscounted gold, declined a cheap upgrade, kept switching tribes and sold minions it had just bought. Trading gold, current strength and tavern tier against each other over many turns is what a learned value estimate does. Rules and prompts approximate it badly, and each fix costs a hand-run experiment.
2. **The only opponent is the scripted bot.** In the AutoTavern paper (arXiv 2610.33845v1, Table 3), the engine's scripted bot averages 7.54 of 8 against opponents calibrated to real games. Beating it is a low bar. A policy trained only against it will learn to exploit it rather than to play well.
3. **No human data.** The paper's human data was not per-decision logs for imitation. It was aggregate statistics of top players and recorded games, used to build opponents. The statistics were tribe shares, upgrade curves, purchase rates and warband strength by turn (Appendix C, "Opponent libraries"). Its first model, TA-1 (day 4), came before opponents were fitted to human statistics (TA-3, day 6, Table 6). It placed 3.40 against the calibrated opponents, while the scripted bot placed 7.54. Human data therefore matters for calibration (step 5 below), not for getting started.
4. **Compute.** The development Mac is an M3 with 8 cores and 16 GB of memory, and PyTorch is not installed. The paper trained on eight H200 GPUs: about 1,900 GPU-hours for its 23 delivered stages and about 20,000 in all (Appendix F). We cannot reproduce its scale. The question is how far a small model gets overnight on the Mac.
5. **Evaluation width.** At 40 seeds the interval is about ±0.7 places, too wide to separate close policies. A network policy decides in microseconds, so 1,000 seeds (about ±0.15 at the same spread) become affordable.

## What already exists

- **Batched environment** (`taverngym.BatchEnv`, from the pinned engine wheel), with these parts:
  - **Seats and opponents:** many eight-player games stepped together. `controlled` picks the learner's seats and scripted bots play the rest; `controlled=range(8)` is self-play.
  - **Observation:** 3,227 floats and 124 card indices per seat, covering only what that player sees. Each step also gives a mask over the 245 actions.
  - **Reward:** the placement at the end of the game (+1 for first, −1 for last).
  - **Save and load:** games can be saved and restored exactly.
  - **Speed:** measured at about 46,000 decisions per second on the M3, environment only, with no network.
- **Policy interface and evaluation** (`backend/bots.py`, `backend/evaluate.py`, on main):
  - **Plug-in:** a trained policy plugs in as one more `Policy`.
  - **Fallback:** `decide()` falls back to the built-in bot on errors, illegal actions or timeouts.
  - **Evaluation:** `python -m backend.evaluate --policy <name>` runs the paired fixed-seed comparison.
  - **Same input as training:** `Game.observe(seat)` and `Game.legal_mask(seat)` return the same observation and mask the environment trains on.
- **TavernBench states:** our engine's `Game.from_json` loads 280 of the benchmark's 288 evaluation states. The labels map each option to an engine action index, which gives an offline check of individual decisions. We would write our own scorer and not run upstream code.

## Plan

Each step ends in a gate. If a step misses its gate, stop and reassess before spending more time.

### 0. Setup and throughput (about 1 day)

- Install PyTorch with the Apple GPU backend (MPS) in `.venv`.
- Write a minimal PPO loop over `BatchEnv` with a small network: an MLP over the features plus a card embedding, about 1–3M parameters.
- Measure decisions per second for collecting games and for learning, on MPS and on CPU.

**Gate:** a measured rate that tells us how many decisions an overnight run covers. For scale, the paper's from-scratch size comparison used about 1.7 billion decisions per model (400 iterations × 4.2 million, Table 8). At 10,000 decisions per second that is about 47 hours.

### 1. Learn to beat the built-in bot (a few days)

- One learner seat against seven scripted bots (`controlled=(0,)`), terminal placement reward.
- **Starting hyperparameters:**
  - From the paper's final stage (Table 7): γ 1.0, λ 0.995, clip 0.2, entropy 0.002, value coefficient 0.5, gradient clip 1.0.
  - Not from the paper: its learning rate (6e-6) was for fine-tuning a trained model, so training from scratch starts higher, around 3e-4, tuned in step 0.
- Track the mean placement during training, and run `backend.evaluate` on held-out seeds at each checkpoint.

**Gate:** paired difference against the built-in bot clearly below zero on 1,000 seeds.

### 2. Self-play with past checkpoints (about a week)

- Fill opponent seats with a mix of the current policy, frozen earlier checkpoints and the scripted bot. This keeps the policy from overfitting to one opponent's habits.
- Seat sampling and the mix are design choices to settle with the step 1 results in hand.

**Gate:** each new checkpoint beats the previous ones and still beats the built-in bot.

### 3. Ship as a policy (1–2 days)

- **Wiring:** add `trained` to `POLICIES` in `backend/bots.py`. It loads a weights file and calls `Game.observe(seat)` and `Game.legal_mask(seat)`, with CPU inference and no network service.
- **Difficulty:** checkpoints from different points in training make natural difficulty levels.
- **Weights in git:** decide whether to commit them (a few MB at this size), and record their provenance.

**Gate:**
- no fallbacks in a 1,000-seed evaluation;
- per-decision latency in the low milliseconds, near the `random` policy's 2.5 ms in `docs/BOTS.md`, which is mostly parsing the seat's view;
- full games play in the UI.

### 4. Calibrated opponents (only with data)

- This step follows the paper's opponent libraries: opponents built from aggregate statistics of strong players, by turn. The statistics are tribe shares, tier curves, purchase rates and warband strength.
- This is the step that needs data. Per the paper, aggregate statistics are enough; per-decision logs are not required.

**Gate:** data first. Per Table 3, calibrated opponents raised first places from 20.9% to 27.2% with the same checkpoint and budget. The gain is real but smaller than the gains before it.

## Expected results

- **Steps 0–1:** a policy that clearly beats the built-in bot is likely, because the gap between a scripted bot and even an early trained model is wide (TA-1 3.40 against 7.54 for the scripted bot). The ceiling is far below TA-1, given about a thousandth of the compute and a smaller model.
- **Step 2:** play that does not depend on one opponent's habits, and checkpoints usable as difficulty levels.
- **Step 3:** stronger, cheaper offline opponents than any hand-written policy, with no API costs.
- **What it will not show:** how strong the policy is against people. Without step 4 or live games there is nothing to anchor that to.

## Risks

- **Throughput on the Mac** may be far below the estimate. Step 0 exists to find out. A rented GPU for a few nights is the fallback, at a cost to agree first.
- **Sparse, late reward:** one number after hundreds of decisions. The paper made it work with γ 1.0 and λ 0.995, but early training may stall without a curriculum. The paper started on a simplified rule set (Appendix C, "Training stages").
- **Overfitting to the scripted bot** in step 1, which is what step 2 is for.
- **Engine version:** the policy learns the pinned engine (patch 36.6.3 rules). An engine update can change card behavior, so retraining or fine-tuning follows an upgrade.

## Costs

- No API spending. The cost is machine time and engineering time: about two to three weeks for steps 0–3 if the gates pass.
- Optional cloud GPU time, only after step 0 shows the Mac is too slow.
