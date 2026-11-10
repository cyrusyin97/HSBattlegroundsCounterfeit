"""A single local player and seven TavernGym opponents, with atomic client commands."""
import logging
from threading import Lock
from uuid import uuid4

import taverngym
from pydantic import BaseModel, ConfigDict, Field

from backend.bots import advance_bots
# race_counts stays importable from here for existing callers.
from backend.projection import race_counts, seat_view, select, targeted_spells, visible_cards  # noqa: F401


logger = logging.getLogger(__name__)


class ActionRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=0)
    action: dict[str, str | int]


def player_snapshot(game, game_id, version):
    raw, state, legal = seat_view(game, 0)
    combat = next((r for r in raw["combats"] if 0 in (r["a"], r["b"])), None)
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


class GameSession:
    def __init__(self, game: taverngym.Game):
        self.id = uuid4().hex
        self.lock = Lock()
        self.game = game
        game.set_record_log(True)
        self.snapshot, self.legal = player_snapshot(game, self.id, 0)
        self.applied = {}  # Successful request IDs and their committed versions.

    def read(self):
        with self.lock:
            return self.snapshot

    def submit(self, request: ActionRequest):
        with self.lock:
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
            candidate = self.game.copy()
            try:
                candidate.step(0, index)
            except ValueError:
                return reject(422, "illegal_action")
            version = request.version + 1
            try:
                advance_bots(candidate)
                snapshot, legal = player_snapshot(candidate, self.id, version)
            except Exception:
                logger.exception("Unable to finish request %s in game %s", request.request_id, self.id)
                return reject(500, "engine_error")
            self.game, self.snapshot, self.legal = candidate, snapshot, legal
            self.applied[request.request_id] = version
            return 200, {**snapshot, "ok": True, "request_id": request.request_id}
