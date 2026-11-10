"""A single local player and seven TavernGym opponents, with atomic client commands."""
import json
import logging
from collections import Counter
from threading import Lock
from uuid import uuid4

import taverngym
from pydantic import BaseModel, ConfigDict, Field


logger = logging.getLogger(__name__)


class ActionRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    version: int = Field(ge=0)
    action: dict[str, str | int]


def select(data, fields):
    return {key: data[key] for key in fields.split() if key in data}


def visible_cards(value):
    """Keep presentation fields on card objects, including nested choices and attachments."""
    if isinstance(value, list):
        return [visible_cards(item) for item in value]
    if not isinstance(value, dict):
        return value
    if isinstance(value.get("id"), str) and "name" in value:
        value = select(value, "id name name_zh text text_zh kind type tier races cost atk hp max_hp "
                       "armor eid hid sid keywords golden shield_hits attached frozen kept price "
                       "costs_health ticket owned triple_need locked temporary golden_text hero_power "
                       "hero_power_id slot usable passive uses_turn uses_game activate_cost activations "
                       "counter chronum_cost reward goal play_cost")
    return {key: visible_cards(item) for key, item in value.items()}


def semantic_actions(view):
    """Translate only set bits in the engine mask; never price or validate a card here."""
    base = view["actions"]
    me = view["me"]
    board, hand, shop = me["board"], me["hand"], me["shop"]
    result = {}
    for index, allowed in enumerate(view["mask"]):
        if not allowed:
            continue
        if index < base["HERO_POWER"]:
            action = {"kind": ("end_turn", "refresh", "freeze", "upgrade")[index]}
        elif index < base["DARK_GIFT"]:
            action = {"kind": "hero_power", "slot": index - base["HERO_POWER"]}
        elif index == base["DARK_GIFT"]:
            action = {"kind": "dark_gift"}
        elif index == base["CANCEL"]:
            action = {"kind": "cancel"}
        elif index < base["SELL"]:
            action = {"kind": "buy", "shop_id": shop[index - base["BUY"]]["sid"]}
        elif index < base["ACTIVATE"]:
            action = {"kind": "sell", "entity_id": board[index - base["SELL"]]["eid"]}
        elif index < base["CHOOSE"]:
            action = {"kind": "activate", "entity_id": board[index - base["ACTIVATE"]]["eid"]}
        elif index < base["PLAY"]:
            option = index - base["CHOOSE"]
            pending = me["pending"]
            if pending["kind"] == "target":
                action = {"kind": "target", "target_id": pending["targets"][option]}
            else:
                action = {"kind": "choose", "option": option}
        elif index < base["MAGNETIZE"]:
            slot, pos = divmod(index - base["PLAY"], base["N_POS"])
            card = hand[slot]
            if card["type"] == "spell":
                action = {"kind": "cast", "hand_id": card["hid"]}
            else:
                action = {"kind": "play", "hand_id": card["hid"], "position": pos}
        elif index < base["MOVE"]:
            slot, target = divmod(index - base["MAGNETIZE"], base["N_BOARD"])
            action = {"kind": "magnetize", "hand_id": hand[slot]["hid"], "target_id": board[target]["eid"]}
        else:
            slot, pos = divmod(index - base["MOVE"], base["N_BOARD"])
            action = {"kind": "move", "entity_id": board[slot]["eid"], "position": pos}
        result[index] = action
    return result


def targeted_spells(game, legal):
    """Hand IDs whose cast opens a target choice, found by casting on a throwaway copy.

    The engine has no static targeting flag, so the client cannot know in advance whether
    dragging a spell should turn into a targeting arrow.
    """
    found = set()
    for index, action in legal.items():
        if action["kind"] != "cast":
            continue
        trial = game.copy()
        try:
            trial.step(0, index)
        except ValueError:
            continue
        pending = json.loads(trial.view(0))["me"].get("pending")
        if pending and pending.get("kind") == "target":
            found.add(action["hand_id"])
    return found


def race_counts(board, lobby):
    """Minions per tribe on a warband. An all-tribe minion counts once for every lobby tribe."""
    counts = Counter()
    for minion in board:
        races = minion.get("races") or []
        counts.update(lobby if "ALL" in races else races)
    return dict(counts)


def player_snapshot(game, game_id, version):
    raw = json.loads(game.view(0))  # Debug view also contains private data of the other seats.
    legal = semantic_actions(raw)
    state = select(raw, "seat turn phase version lobby_races deity paradox alive")
    state["me"] = select(raw["me"], "hero hero_powers health armor alive placement tier gold max_gold "
                         "win_streak upgrade_price refresh_price minion_price frozen ended_turn board hand shop "
                         "pending casting cancellable trinkets quests rewards secrets next_opponent "
                         "last_opponent next_is_ghost effects buddy_button dark_gift deity chronum_balance")
    state["opponents"] = [select(op, "id hero health armor tier alive placement last_damage win_streak "
                                    "trinkets last_warband seen_board seen_turn is_next_opponent")
                          for op in raw["opponents"]]
    lobby = raw.get("lobby_races") or []
    state["me"]["warband"] = {"size": len(raw["me"]["board"]), "races": race_counts(raw["me"]["board"], lobby)}
    for op, seen in zip(state["opponents"], raw["opponents"]):
        # Hero powers are public at the table but absent from this seat's view, so read each
        # opponent's own seat. Their warband is reduced to tribe counts; the minions stay hidden.
        op["hero_powers"] = json.loads(game.view(op["id"]))["me"]["hero_powers"]
        op["warband"] = {"size": len(seen["board"]), "races": race_counts(seen["board"], lobby)}
    combat = next((r for r in raw["combats"] if 0 in (r["a"], r["b"])), None)
    if combat is not None:
        # Text debug logs are not a player-facing protocol. Attacks identify both entities.
        combat["frames"] = [select(frame, "boards attacks impacts") for frame in combat["frames"]]
        combat = visible_cards(combat)
    state["me"]["dark_gift"] = select(state["me"]["dark_gift"], "available uses max_uses cost unlock_turn")
    state = visible_cards(state)
    aimed = targeted_spells(game, legal)
    for card in state["me"]["hand"]:
        if card.get("type") == "spell":
            card["targeted"] = card["hid"] in aimed
    return ({"game_id": game_id, "version": version, "state": state,
             "legal_actions": list(legal.values()), "combat": combat}, legal)


def advance_bots(game):
    # Stop at the next human decision, including an extra choice opened by a trigger.
    steps = 0
    while not game.is_over() and not game.needs_action(0) and not game.placements()[0]:
        before = steps
        for seat in range(1, game.num_players):
            if game.needs_action(seat):
                game.step(seat, game.bot_action(seat))
                steps += 1
            if game.needs_action(0) or game.is_over() or game.placements()[0]:
                return
        if steps == before or steps > 40000:
            raise RuntimeError("Bot seats failed to reach a player decision")


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
