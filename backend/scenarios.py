"""Deterministic first-turn setups for the local animation POC."""
import json

import taverngym


SCENARIOS = {
    "recruit": "购买南海卖艺者，打出到愤怒编织者旁边，再交换站位。",
    "target": "打出香蕉果盘，选择场上的无害的骨颅，观察 +2/+2。",
    "triple": "购买商店中的愤怒编织者完成三连，打出金色随从并使用三连奖励。",
    "deathrattle": "结束回合，观察无害的骨颅撞破圣盾、召唤两个骷髅，以及爆裂飓风的风怒攻击。",
    "collision": "结束回合，观察 58 与 100 点伤害同时命中，以及双方剩余血量。",
    "reborn": "结束回合，观察复活的骑兵死亡后以 1 点生命值复生。",
    "hero_damage": "结束回合，观察敌方英雄攻击，己方 1 点护甲破碎并损失 1 点生命值。",
}


def make_scenario(key: str):
    if key not in SCENARIOS:
        raise KeyError(key)
    game = taverngym.Game(seed=17)
    for seat in range(game.num_players):
        game.step(seat, json.loads(game.view(seat))["actions"]["CHOOSE"])
    opponent = json.loads(game.view(0))["me"]["next_opponent"]

    def minion(card, seat=0, **stats):
        game.debug(json.dumps(dict(cmd="add_minion", p=seat, zone="board", card=card, **stats)))

    if key in ("recruit", "triple"):
        minion("BGS_004")
        if key == "triple":
            minion("BGS_004")
    elif key == "target":
        minion("BG28_300")
        game.debug(json.dumps(dict(cmd="add_spell", p=0, zone="hand", card="BG28_897")))
    elif key == "deathrattle":
        minion("BG28_300", atk=1, hp=1)
        minion("BGS_004", atk=1, hp=1)
        minion("BGS_119", opponent, atk=3, hp=8)
    elif key == "collision":
        minion("BG26_135", atk=58, hp=154)
        minion("BGS_004", opponent, atk=100, hp=106)
    elif key == "reborn":
        minion("BG25_001")
        minion("BGS_119", opponent, atk=3, hp=8)
    elif key == "hero_damage":
        minion("BGS_004", atk=1, hp=1)
        minion("BGS_119", opponent, atk=3, hp=8)
        state = json.loads(game.state_json())
        state["players"][0]["armor"] = 1
        game = taverngym.Game.from_json(json.dumps(state))

    # Lock only the opening opponents. Normal bots resume on the following turn.
    for seat in range(1, game.num_players):
        game.step(seat, 0)
    return game
