"""What one seat may see of a TavernGym game, and its legal actions in client form.

Both the player's snapshot and bot policies read the game through this projection, so a
bot never sees more than a human in the same seat would.
"""
import json
from collections import Counter
from functools import lru_cache

import opencc


# Simplified to Traditional with Taiwan phrasing; the engine has no zhTW card strings.
TAIWAN = opencc.OpenCC("s2twp")


@lru_cache(maxsize=8192)
def taiwan(text):
    return TAIWAN.convert(text)


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
        for field in ("name", "text"):
            if value.get(field + "_zh"):
                value[field + "_tw"] = taiwan(value[field + "_zh"])
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
        pending = json.loads(trial.public_view_without_combats(0))["me"].get("pending")
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


def last_warband(summary):
    """An opponent's warband in its last combat, from the engine's summary, in `race_counts` form.

    The leaderboard shows what that combat revealed, not the board the opponent holds now.
    """
    if not summary:
        return {"size": 0, "races": {}}
    return {"size": summary["size"], "races": {c["race"]: c["count"] for c in summary["counts"]}}


def seat_view(game, seat, raw=None):
    """The engine's raw view of `seat`, its public projection, and its legal actions by mask index.

    Pass `raw` when the caller already parsed the seat's view.
    """
    # The public view leaves out other seats' boards and combats this seat did not fight.
    raw = raw or json.loads(game.public_view(seat))
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
        # opponent's own seat, without combat replays. Their warband is reduced to tribe counts.
        op["hero_powers"] = json.loads(game.public_view_without_combats(op["id"]))["me"]["hero_powers"]
        op["warband"] = last_warband(seen["last_warband"])
    state["me"]["dark_gift"] = select(state["me"]["dark_gift"], "available uses max_uses cost unlock_turn")
    return raw, visible_cards(state), legal
