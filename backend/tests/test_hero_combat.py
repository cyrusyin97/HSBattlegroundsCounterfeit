"""Hero settlement must preserve exact engine values, including protection and old saves."""
import json

import pytest
import taverngym

from backend.scenarios import make_scenario


@pytest.mark.parametrize("win,armor,health,protected", [
    (False, 8, 30, False),  # Armor absorbs the full hit.
    (False, 1, 1, False),   # Lethal damage.
    (False, 0, 1, True),    # Ice Block prevents lethal damage.
    (True, 1, 30, False),   # The opposing hero is the recipient.
])
def test_hero_settlement(win, armor, health, protected):
    game = make_scenario("hero_damage")
    state = json.loads(game.state_json())
    opponent = json.loads(game.view(0))["me"]["next_opponent"]
    loser = opponent if win else 0
    if win:
        state["players"][0]["board"], state["players"][opponent]["board"] = (
            state["players"][opponent]["board"], state["players"][0]["board"])
    state["players"][loser]["armor"] = armor
    state["players"][loser]["health"] = health
    if protected:
        state["players"][loser]["secrets"] = [next(c["cid"] for c in json.loads(taverngym.catalog_json()) if c["id"] == "TB_Bacon_Secrets_12")]
    game = taverngym.Game.from_json(json.dumps(state))
    game.set_record_log(True)
    game.step(0, 0)
    record = next(r for r in json.loads(game.view(0))["combats"] if 0 in (r["a"], r["b"]))
    losing_side = int(record["a"] != loser)
    before, after = record["heroes_before"][losing_side], record["heroes_after"][losing_side]
    assert (before["armor"], before["health"]) == (armor, health)
    damage = 0 if protected else record["damage"]
    assert (after["armor"], after["health"]) == (
        max(0, armor - damage), health - max(0, damage - armor))
    assert record["heroes_before"][1-losing_side] == record["heroes_after"][1-losing_side]
    assert record["winner"] == 1-losing_side


def test_tie_and_old_save_compatibility():
    game = make_scenario("collision")
    game.set_record_log(True)
    game.step(0, 0)
    state = json.loads(game.state_json())
    record = next(r for r in state["last_combats"] if 0 in (r["a"], r["b"]))
    assert record["winner"] == 2 and record["damage"] == 0
    assert record["heroes_before"] == record["heroes_after"]
    for r in state["last_combats"]:
        r.pop("heroes_before")
        r.pop("heroes_after")
    restored = taverngym.Game.from_json(json.dumps(state))
    assert restored.health() == game.health()
