"""Fixed-seed replay probe. Run directly to export the verified live combat as JSON."""
import json

import taverngym


def make_game():
    game = taverngym.Game(seed=17)
    for seat in range(game.num_players):
        view = json.loads(game.view(seat))
        game.step(seat, view["actions"]["CHOOSE"])  # First offered hero.

    opponent = json.loads(game.view(0))["me"]["next_opponent"]
    # A second friendly body gives the Bonehead the first attack. Override stats
    # to exercise shield break, death, two summons and Windfury in one combat.
    for seat, card, atk, hp in (
        (0, "BG28_300", 1, 1),
        (0, "BGS_004", 1, 1),
        (opponent, "BGS_119", 3, 8),
    ):
        command = dict(cmd="add_minion", p=seat, zone="board", card=card, atk=atk, hp=hp)
        game.debug(json.dumps(command))
    return game, opponent


def finish_round(game):
    turn = game.turn
    for seat in range(game.num_players):
        game.step(seat, 0)  # End turn.
    assert game.turn == turn + 1
    combats = json.loads(game.view(0))["combats"]
    return next(record for record in combats if 0 in (record["a"], record["b"]))


def verify_frames(record, opponent):
    assert {record["a"], record["b"]} == {0, opponent}
    friendly = 0 if record["a"] == 0 else 1
    enemy = 1 - friendly
    assert record["winner"] == enemy and record["damage"] == 2
    assert not record["truncated"]
    frames = record["frames"]
    # For this setup, start-of-combat has no visible effect.
    assert len(frames) == 5
    assert frames[0]["boards"] == frames[1]["boards"]
    bone, ally = frames[1]["boards"][friendly]
    cyclone, = frames[1]["boards"][enemy]
    assert [bone["id"], ally["id"], cyclone["id"]] == ["BG28_300", "BGS_004", "BGS_119"]
    assert cyclone["shield_hits"] == 1 and "DIVINE_SHIELD" in cyclone["keywords"]

    impact = frames[2]
    assert impact["attacks"] == [[bone["eid"], cyclone["eid"]]]
    after_hit, = impact["boards"][enemy]
    assert after_hit["eid"] == cyclone["eid"] and after_hit["hp"] == cyclone["hp"]
    assert after_hit["shield_hits"] == 0 and "DIVINE_SHIELD" not in after_hit["keywords"]
    first, second, survivor = impact["boards"][friendly]
    assert first["id"] == second["id"] == "BG_ICC_026t"
    assert survivor["eid"] == ally["eid"]
    assert len({bone["eid"], ally["eid"], cyclone["eid"], first["eid"], second["eid"]}) == 5

    windfury = frames[3]
    assert len(windfury["attacks"]) == 2
    assert all(attacker == cyclone["eid"] for attacker, _ in windfury["attacks"])
    previous_targets = {m["eid"] for m in impact["boards"][friendly]}
    targets_hit = {target for _, target in windfury["attacks"]}
    last_ally, = windfury["boards"][friendly]
    assert len(targets_hit) == 2 and previous_targets - targets_hit == {last_ally["eid"]}
    assert windfury["boards"][enemy][0]["hp"] == 6

    final = frames[4]
    assert final["attacks"] == [[last_ally["eid"], cyclone["eid"]]]
    assert final["boards"][friendly] == []
    assert final["boards"][enemy][0]["hp"] == 5


def capture_verified_round():
    game, opponent = make_game()
    game.set_record_log(True)
    before = game.state_json()
    preview = json.loads(game.debug(json.dumps(
        dict(cmd="combat_preview", a=0, b=opponent, n=1)
    )))["sample"]
    assert game.state_json() == before
    verify_frames(preview, opponent)
    live = finish_round(game)
    verify_frames(live, opponent)
    return live


def test_preview_and_live_combat_supply_animation_frames():
    capture_verified_round()


def test_live_frames_require_recording():
    game, _ = make_game()
    game.set_record_log(False)
    assert finish_round(game)["frames"] == []


if __name__ == "__main__":
    print(json.dumps(capture_verified_round(), ensure_ascii=False, indent=2))
