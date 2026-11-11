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
    "mechanics": "第 3 回合、10 金币：把催眠机器人拖到拔线机上磁力吸附，使用黑暗之赐，施放联盟旗帜做出抉择，或发动重伤的强盗弃掉一张手牌。",
    "late": "第 10 回合的中盘对局：滑过左侧玩家列表查看各家排名、酒馆等级、英雄技能和饰品。",
    "showcase": "每个随从展示一种效果：嘲讽、圣盾、潜行、复生、风怒、剧毒和金色亡语随从；结束回合观察战斗。",
}


def make_scenario(key: str):
    if key not in SCENARIOS:
        raise KeyError(key)
    if key == "late":
        # Scripted bots play every seat, the local one included, up to turn 10.
        game = taverngym.Game(seed=6)
        while json.loads(game.view(0))["turn"] < 10:
            for seat in range(game.num_players):
                if game.needs_action(seat):
                    game.bot_play(seat)
        return game
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
    elif key == "mechanics":
        minion("BG29_611")
        minion("BG28_582")
        game.debug(json.dumps(dict(cmd="add_minion", p=0, zone="hand", card="BG26_146")))
        game.debug(json.dumps(dict(cmd="add_spell", p=0, zone="hand", card="BG31_880")))
        # Dark Gifts unlock on turn 3 and cost 3 gold.
        state = json.loads(game.state_json())
        state["turn"] = 3
        state["players"][0]["gold"] = 10
        game = taverngym.Game.from_json(json.dumps(state))
    elif key == "showcase":
        # One effect per card, so a single board shows everything the table draws.
        for index, (card, keywords) in enumerate((
                ("BG25_001", ["TAUNT"]), ("BGS_119", ["DIVINE_SHIELD"]), ("BGS_004", ["STEALTH"]),
                ("BG25_001", ["REBORN"]), ("BGS_119", ["WINDFURY"]), ("BGS_131", ["VENOMOUS"]))):
            minion(card)
            game.debug(json.dumps(dict(cmd="edit_minion", p=0, zone="board", index=index, keywords=keywords)))
        minion("BG28_300", golden=True)
        game.debug(json.dumps(dict(cmd="add_spell", p=0, zone="hand", card="BG28_897")))
        game.debug(json.dumps(dict(cmd="add_minion", p=0, zone="hand", card="BG26_135")))
        minion("BGS_119", opponent, atk=3, hp=8)
        minion("BGS_004", opponent, atk=2, hp=9)
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
