"""Bot seats: a replaceable decision policy per seat, with validation and a safe fallback.

See docs/BOTS.md. A policy sees only the seat's public projection (backend.projection), never
the Game object, and any failure falls back to the engine's built-in heuristic.
"""
import logging
import random
import time
from collections import Counter
from dataclasses import dataclass, field
from functools import cached_property
from typing import Callable, Protocol

import json

from backend.projection import seat_view, semantic_actions

logger = logging.getLogger(__name__)

# A decision slower than this falls back. Python cannot interrupt a running call, so remote
# policies should also set their own request timeout below it.
DEADLINE_SECONDS = 10.0
STEP_GUARD = 200_000


@dataclass(frozen=True)
class Decision:
    action: dict | None = None
    """One of DecisionContext.actions, returned unchanged."""
    confidence: float | None = None
    reason: str | None = None


class DecisionContext:
    """One decision for one seat. Each field is computed on first use."""

    def __init__(self, game, seat):
        self._game = game
        self.seat = seat

    @cached_property
    def _raw(self):
        return json.loads(self._game.public_view(self.seat))

    @cached_property
    def _legal(self) -> dict[int, dict]:
        return semantic_actions(self._raw)

    @cached_property
    def state(self) -> dict:
        """The seat's own view, projected exactly like the player's snapshot. Building it reads
        every opponent's hero power, so policies that only need the actions skip it."""
        return seat_view(self._game, self.seat, self._raw)[1]

    @property
    def actions(self) -> list[dict]:
        """The legal actions in client form, such as {"kind": "buy", "shop_id": 3}."""
        return list(self._legal.values())

    @property
    def turn(self) -> int:
        return self._game.turn

    @property
    def phase(self) -> str:
        return self.state["phase"]

    def builtin_action(self) -> dict:
        """The engine heuristic's choice, as a fallback or a hint."""
        return self._legal[self._game.bot_action(self.seat)]

    def index_of(self, action) -> int | None:
        return next((index for index, legal in self._legal.items() if legal == action), None)


class Policy(Protocol):
    name: str

    def choose(self, context: DecisionContext) -> Decision: ...


class BuiltinPolicy:
    """The engine's scripted heuristic. The runner steps it directly, without building a view."""
    name = "builtin"

    def choose(self, context: DecisionContext) -> Decision:
        return Decision(context.builtin_action())


class RandomPolicy:
    """A uniformly random legal action. The evaluation must rank it clearly below builtin."""
    name = "random"

    def __init__(self, seed: int = 0):
        self.rng = random.Random(seed)

    def choose(self, context: DecisionContext) -> Decision:
        return Decision(self.rng.choice(context.actions))


BUILTIN = BuiltinPolicy()
POLICIES: dict[str, Callable[[int], Policy]] = {
    "builtin": lambda seed: BUILTIN,
    "random": RandomPolicy,
}


def make_policy(name: str, seed: int = 0) -> Policy:
    if name not in POLICIES:
        raise KeyError(f"Unknown policy {name!r}; choose from {', '.join(POLICIES)}")
    return POLICIES[name](seed)


@dataclass
class SeatStats:
    decisions: int = 0
    fallbacks: Counter = field(default_factory=Counter)
    """Fallbacks by cause: error, timeout or illegal."""
    latencies: list[float] = field(default_factory=list)
    """Seconds per decision, for policies other than builtin."""


def decide(game, seat, policy: Policy, stats: dict[int, SeatStats] | None = None,
           deadline=DEADLINE_SECONDS) -> int:
    """The engine action index for this seat's next step, guarded by validation and fallback."""
    record = stats.setdefault(seat, SeatStats()) if stats is not None else None
    if record is not None:
        record.decisions += 1
    if isinstance(policy, BuiltinPolicy):
        return game.bot_action(seat)
    context = DecisionContext(game, seat)
    start = time.perf_counter()
    try:
        decision = policy.choose(context)
        cause = None
    except Exception:
        logger.exception("Policy %s failed for seat %s", policy.name, seat)
        decision, cause = None, "error"
    elapsed = time.perf_counter() - start
    if record is not None:
        record.latencies.append(elapsed)
    if cause is None:
        index = context.index_of(decision.action if decision else None)
        cause = "timeout" if elapsed > deadline else "illegal" if index is None else None
        if cause is None:
            return index
    if record is not None:
        record.fallbacks[cause] += 1
    return game.bot_action(seat)


def advance_bots(game, policies: dict[int, Policy] | None = None, stats: dict[int, SeatStats] | None = None):
    """Drive seats 1–7 until seat 0 has a decision, is eliminated, or the game ends."""
    policies = policies or {}
    steps = 0
    # Stop at the next human decision, including an extra choice opened by a trigger.
    while not game.is_over() and not game.needs_action(0) and not game.placements()[0]:
        before = steps
        for seat in range(1, game.num_players):
            if game.needs_action(seat):
                game.step(seat, decide(game, seat, policies.get(seat, BUILTIN), stats))
                steps += 1
            if game.needs_action(0) or game.is_over() or game.placements()[0]:
                return
        if steps == before or steps > 40000:
            raise RuntimeError("Bot seats failed to reach a player decision")


def play_to_end(game, policies: dict[int, Policy] | None = None, stats: dict[int, SeatStats] | None = None):
    """Play every seat as a bot until the game is over. Used by the evaluation."""
    policies = policies or {}
    steps = 0
    while not game.is_over():
        before = steps
        for seat in range(game.num_players):
            if game.needs_action(seat):
                game.step(seat, decide(game, seat, policies.get(seat, BUILTIN), stats))
                steps += 1
        if steps == before or steps > STEP_GUARD:
            raise RuntimeError("Bots failed to finish the game")
