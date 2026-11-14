"""A single local player and seven TavernGym opponents, with atomic client commands."""
import json
import logging
import time
from threading import Lock
from uuid import uuid4

import taverngym
from pydantic import BaseModel, ConfigDict, Field

from backend.bots import advance_bots
# race_counts stays importable from here for existing callers.
from backend.projection import race_counts, seat_view, select, targeted_spells, visible_cards  # noqa: F401
from backend.store import Save, SaveStore


logger = logging.getLogger(__name__)


class ActionRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=0)
    action: dict[str, str | int]


def player_snapshot(game, game_id, version, with_combat=False):
    """The player's snapshot. Only the response that finishes a combat carries its replay.

    The engine keeps the last combat in the seat's view through the whole next recruit phase,
    but the client plays a replay once, so later snapshots read the view without combats.
    """
    raw = json.loads(game.public_view(0) if with_combat else game.public_view_without_combats(0))
    raw, state, legal = seat_view(game, 0, raw)
    combat = next((r for r in raw["combats"] if 0 in (r["a"], r["b"])), None) if with_combat else None
    if combat is not None:
        # Text debug logs are not a player-facing protocol. Attacks identify both entities.
        combat["frames"] = [select(frame, "boards attacks impacts") for frame in combat["frames"]]
        combat = visible_cards(combat)
    aimed = targeted_spells(game, legal)
    for card in state["me"]["hand"]:
        if card.get("type") == "spell":
            card["targeted"] = card["hid"] in aimed
    return ({"game_id": game_id, "version": version, "state": state,
             "legal_actions": list(legal.values()), "combat": combat}, legal)


def hero_sides(state, combat):
    """The heroes of a combat's two sides as `state` shows them, or None for a ghost."""
    def hero(seat):
        if seat is None:
            return None
        player = state["me"] if seat == state["seat"] else next((p for p in state["opponents"] if p["id"] == seat), None)
        return player and {key: player[key] for key in ("hero", "health", "armor", "tier")}
    return [hero(combat["a"]), hero(combat["b"])]


def finished(game):
    """The game is over for the player: it ended, or seat 0 was eliminated and only bots remain."""
    return bool(game.is_over() or game.placements()[0])


class GameSession:
    def __init__(self, game: taverngym.Game, game_id: str | None = None, version: int = 0,
                 applied: dict[str, int] | None = None, store: SaveStore | None = None):
        """Wrap a new game, or a restored one when `game_id` and `version` come from its save."""
        self.id = game_id or uuid4().hex
        self.lock = Lock()
        self.game = game
        self.store = store
        self.closed = False
        """Set when the session leaves memory; a request still holding it must load it again."""
        self.touched = time.time()
        game.set_record_log(True)
        self.snapshot, self.legal = player_snapshot(game, self.id, version)
        self.applied = dict(applied or {})  # Successful request IDs and their committed versions.
        if store is not None and game_id is None:
            store.write(self.id, self.save(game, version, self.applied))

    @classmethod
    def restore(cls, game_id: str, save: Save, store: SaveStore | None = None):
        return cls(taverngym.Game.from_json(save.state), game_id, save.version, save.applied, store)

    @staticmethod
    def save(game, version, applied):
        return Save(version, game.state_json(), applied, finished(game))

    @property
    def over(self):
        return finished(self.game)

    def read(self):
        with self.lock:
            self.touched = time.time()
            return self.snapshot

    def submit(self, request: ActionRequest, timings: dict[str, float] | None = None):
        """The status and response body, or None when this session already left memory.

        Pass `timings` to receive milliseconds spent in the engine, the snapshot and the save.
        """
        timings = {} if timings is None else timings
        clock = time.perf_counter
        with self.lock:
            if self.closed:
                return None
            self.touched = time.time()

            def reject(status, code, **extra):
                return status, {**self.snapshot, "ok": False, "request_id": request.request_id,
                                "error": {"code": code, **extra}}

            if request.request_id in self.applied:
                return reject(409, "duplicate_request", applied_version=self.applied[request.request_id])
            if request.version != self.snapshot["version"]:
                return reject(409, "stale_version")
            index = next((i for i, action in self.legal.items() if action == request.action), None)
            if index is None:
                return reject(422, "illegal_action")

            # A failed step, bot turn or projection must not mutate the published game.
            started = clock()
            candidate = self.game.copy()
            try:
                candidate.step(0, index)
            except ValueError:
                return reject(422, "illegal_action")
            version = request.version + 1
            try:
                advance_bots(candidate)
                timings["engine"] = (clock() - started) * 1000
                started = clock()
                # A combat ends the turn, so the turn advances, or ends the player's game.
                fought = candidate.turn != self.game.turn or finished(candidate)
                snapshot, legal = player_snapshot(candidate, self.id, version, with_combat=fought)
                if snapshot["combat"] is not None:
                    # The client places playback on this clock, and shows the heroes as they
                    # were before the action, also after a reload in the middle of the combat.
                    snapshot["combat"]["started_at"] = round(time.time() * 1000)
                    snapshot["combat"]["heroes_start"] = hero_sides(self.snapshot["state"], snapshot["combat"])
                timings["snapshot"] = (clock() - started) * 1000
            except Exception:
                logger.exception("Unable to finish request %s in game %s", request.request_id, self.id)
                return reject(500, "engine_error")
            applied = {**self.applied, request.request_id: version}
            if self.store is not None:
                # Save before answering: a response the player sees is never lost by a restart.
                try:
                    started = clock()
                    self.store.write(self.id, self.save(candidate, version, applied))
                    timings["save"] = (clock() - started) * 1000
                except Exception:
                    logger.exception("Unable to save game %s at version %s", self.id, version)
                    return reject(500, "save_error")
            self.game, self.snapshot, self.legal, self.applied = candidate, snapshot, legal, applied
            return 200, {**snapshot, "ok": True, "request_id": request.request_id}
