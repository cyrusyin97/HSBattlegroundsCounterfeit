# Bot decisions and evaluation

Bot seats choose their actions through a replaceable policy. The engine's built-in heuristic is the default policy and the baseline. A fixed-seed evaluation compares any other policy against it. Later policies (an LLM, a decision model such as Jev, a trained network) plug into the same interface.

## Decision interface

`backend/bots.py`:

```python
class Policy(Protocol):
    name: str
    def choose(self, context: DecisionContext) -> Decision: ...

@dataclass(frozen=True)
class Decision:
    action: dict | None = None      # one of context.actions, unchanged
    confidence: float | None = None # optional, 0 to 1
    reason: str | None = None       # optional, for logs and the UI
```

`DecisionContext` describes one decision for one seat. Each field is computed only when a policy reads it.

| Field | What it holds |
| --- | --- |
| `seat`, `turn`, `phase` | Who is deciding and when |
| `actions` | The legal actions, in the same semantic form the player's client receives (`buy` with `shop_id`, `play` with `hand_id` and `position`, and so on) |
| `state` | The seat's own view, projected exactly like the player's snapshot: own board, hand, shop, gold and pending choice; opponents' public facts only (health, armor, tier, hero power, trinkets, warband tribe counts) |
| `builtin_action()` | The engine heuristic's choice for this decision, for policies that want a fallback or a hint |

**Fairness rule:** a policy sees what a human in that seat would see. The engine's debug view carries every seat's private data, so `state` goes through the same projection as the player snapshot, and policies never receive the `Game` object.

## Running a policy

`advance_bots(game, policies)` drives seats 1–7 (or any seats in an evaluation). `policies` maps a seat to a policy; missing seats use the built-in policy.

Every external decision goes through a guard:

- **Validation:** the returned action must equal one of `context.actions`. Anything else counts as illegal.
- **Fallback:** an exception, an illegal action or a decision slower than the deadline falls back to the built-in choice, so a game never stalls.
- **Statistics:** decisions, fallbacks by cause, and per-decision latency.

The built-in policy steps the engine directly, without building `state`, so baseline games stay fast (about 10 ms for a full eight-bot game).

## Policies included now

| Name | Behavior | Purpose |
| --- | --- | --- |
| `builtin` | The engine's heuristic (`bot_action`) | Default and baseline |
| `random` | A uniformly random legal action, seeded | Sanity check: the evaluation must show it clearly worse |

## Evaluation

```sh
.venv/bin/python -m backend.evaluate --policy random --games 200 --jobs 4
```

For each seed, the runner plays two games with all eight seats as bots:

1. **Baseline:** every seat uses `builtin`.
2. **Challenger:** one seat uses the challenger and the rest use `builtin`. The challenger's seat rotates with the seed (`seed % 8`), so no seat position is favored.

The paired difference compares the challenger's placement with the baseline placement of the same seat on the same seed. Same seed means same heroes offered and same opening shops, which removes much of the luck from the comparison.

Report fields:

- Mean placement of the challenger, and of the baseline in the same seats.
- Mean paired difference with a 95% confidence interval. Negative is better.
- Top-four and first-place rates.
- Decisions, fallbacks by cause, and latency p50 / p95 per decision.
- Engine guards: truncated combats, games ended by the turn limit, and errors.

`--out report.json` writes the full report; the terminal shows a summary table.

## Reference results

200 seeds (0–199), four worker processes, on the development Mac:

| Policy | Mean placement | Built-in, same seats | Paired difference | Top 4 | Time |
| --- | --- | --- | --- | --- | --- |
| `builtin` | 4.45 | 4.45 | 0.00 | 52% | 0.5 s |
| `random` | 7.94 | 4.45 | +3.50 ± 0.32 | 0% | 10 s |

`builtin` against itself shows exactly zero, so the pairing adds no bias. `random` is clearly worse, so the evaluation separates a weak policy from the baseline. A random decision takes about 2.5 ms, mostly parsing the seat's view; policies that read `state` also pay for the opponents' hero powers (about 20 ms).

## Adding a policy later

Implement `choose`, register a factory in `backend/bots.py`, and run the evaluation. For a remote model:

- Keep network calls inside `choose` and respect the deadline.
- Seat decisions within one recruit phase are independent, so a later step can run seats in parallel.
- Keep secrets in environment variables on the backend.
