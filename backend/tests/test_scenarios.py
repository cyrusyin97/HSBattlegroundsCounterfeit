from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend import main
from backend.game_session import race_counts
from backend.scenarios import SCENARIOS

client = TestClient(main.app)


@pytest.fixture
def start(monkeypatch):
    monkeypatch.setattr(main, "sessions", {})

    def create(key):
        response = client.post("/api/games", params={"scenario": key})
        assert response.status_code == 201
        return response.json()
    return create


def step(snapshot, kind, **params):
    action = next(a for a in snapshot["legal_actions"]
                  if a["kind"] == kind and params.items() <= a.items())
    response = client.post(f"/api/games/{snapshot['game_id']}/actions", json={
        "version": snapshot["version"], "request_id": uuid4().hex, "action": action,
    })
    assert response.status_code == 200
    return response.json()


def buy(snapshot, card):
    slot = next(c for c in snapshot["state"]["me"]["shop"] if c["id"] == card)
    return step(snapshot, "buy", shop_id=slot["sid"])


@pytest.mark.parametrize("key", SCENARIOS)
def test_scenario_restarts_at_identical_player_decision(start, key):
    first, second = start(key), start(key)
    assert first.pop("game_id") != second.pop("game_id")
    assert first == second
    assert first["version"] == 0 and first["state"]["phase"] == "recruit"


def test_scenario_directory():
    assert {s["id"] for s in client.get("/api/scenarios").json()} == set(SCENARIOS)
    assert client.post("/api/games?scenario=invalid").status_code == 404


def test_recruit(start):
    bought = buy(start("recruit"), "BG26_135")
    assert bought["state"]["me"]["gold"] == 0
    played = step(bought, "play", position=1)
    ally, busker = played["state"]["me"]["board"]
    moved = step(played, "move", entity_id=busker["eid"], position=0)
    assert [c["eid"] for c in moved["state"]["me"]["board"]] == [busker["eid"], ally["eid"]]


def test_target(start):
    snapshot = start("target")
    bone, = snapshot["state"]["me"]["board"]
    spell, = snapshot["state"]["me"]["hand"]
    assert spell["targeted"] is True
    choosing = step(snapshot, "cast")
    assert choosing["state"]["me"]["pending"]["kind"] == "target"
    resolved = step(choosing, "target", target_id=bone["eid"])
    buffed, = resolved["state"]["me"]["board"]
    assert (buffed["atk"], buffed["hp"]) == (bone["atk"] + 2, bone["hp"] + 2)


def test_triple(start):
    bought = buy(start("triple"), "BGS_004")
    golden, = bought["state"]["me"]["hand"]
    assert golden["id"] == "TB_BaconUps_079"
    played = step(bought, "play")
    reward = next(c for c in played["state"]["me"]["hand"] if c["type"] == "spell")
    assert reward["targeted"] is False  # It opens a discover, not a target.
    choosing = step(played, "cast")
    pending = choosing["state"]["me"]["pending"]
    assert pending["kind"] == "discover" and len(pending["options"]) == 3
    resolved = step(choosing, "choose", option=0)
    assert resolved["state"]["me"]["hand"][0]["id"] == pending["options"][0]["id"]


@pytest.mark.parametrize("key", ["deathrattle", "reborn"])
def test_combat(start, key):
    replay = step(start(key), "end_turn")["combat"]
    side = int(replay["a"] != 0)
    frames = replay["frames"]
    before, after = (frame["boards"][side] for frame in frames[1:3])
    if key == "deathrattle":
        assert before[0]["id"] == "BG28_300"
        assert [m["id"] for m in after[:2]] == ["BG_ICC_026t"] * 2
        assert len(frames) == 5 and len(frames[3]["attacks"]) == 2
        assert [f["boards"][1-side][0]["shield_hits"] for f in frames[1:3]] == [1, 0]
    else:
        assert before[0]["id"] == after[0]["id"] == "BG25_001"
        assert before[0]["eid"] != after[0]["eid"] and after[0]["hp"] == 1
        assert "REBORN" in before[0]["keywords"] and "REBORN" not in after[0]["keywords"]


def test_collision_reports_simultaneous_damage_and_exact_post_hit_hp(start):
    replay = step(start("collision"), "end_turn")["combat"]
    impacts = [i for frame in replay["frames"] for i in frame["impacts"]]
    first, second = impacts
    assert {hit["target"] for hit in first["hits"]} == {first["from"], first["to"]}
    assert sorted((h["damage"], h["hp"], h["lethal"]) for h in first["hits"]) == [
        (58, 48, False), (100, 54, False)]
    assert sorted((h["damage"], h["hp"], h["lethal"]) for h in second["hits"]) == [
        (58, -10, True), (100, -46, True)]


def test_shield_and_windfury_are_recorded_at_each_contact(start):
    replay = step(start("deathrattle"), "end_turn")["combat"]
    shield, windfury = replay["frames"][2:4]
    absorbed, counter = shield["impacts"][0]["hits"]
    assert (absorbed["damage"], absorbed["hp"], absorbed["absorbed"], absorbed["shield_hits"]) == (0, 8, True, 0)
    assert (counter["damage"], counter["hp"], counter["lethal"]) == (3, -2, True)
    assert [(i["from"], i["to"]) for i in windfury["impacts"]] == [tuple(a) for a in windfury["attacks"]]
    assert [i["hits"][1]["hp"] for i in windfury["impacts"]] == [7, 6]


def test_hero_damage_replay_preserves_pre_damage_state(start):
    snapshot = start("hero_damage")
    resolved = step(snapshot, "end_turn")
    replay = resolved["combat"]
    friendly = int(replay["a"] != 0)
    before = replay["heroes_before"][friendly]
    after = replay["heroes_after"][friendly]
    assert replay["winner"] == 1 - friendly and replay["damage"] == 2
    assert (before["armor"], before["health"]) == (1, 30)
    assert (after["armor"], after["health"]) == (0, 29)
    assert after["hero"]["id"] == snapshot["state"]["me"]["hero"]["id"]
    assert (resolved["state"]["me"]["armor"], resolved["state"]["me"]["health"]) == (0, 29)
    # Only the response that finished the combat carries it; a reload right after still gets it.
    assert client.get(f"/api/games/{resolved['game_id']}").json()["combat"] == replay
    assert step(resolved, "freeze")["combat"] is None


def test_mechanics(start):
    snapshot = start("mechanics")
    mech = next(c for c in snapshot["state"]["me"]["board"] if c["id"] == "BG29_611")
    magnet = next(c for c in snapshot["state"]["me"]["hand"] if c["id"] == "BG26_146")
    attached = step(snapshot, "magnetize", hand_id=magnet["hid"], target_id=mech["eid"])
    merged = next(c for c in attached["state"]["me"]["board"] if c["eid"] == mech["eid"])
    assert merged["atk"] > mech["atk"] and merged["hp"] > mech["hp"]

    # Each mechanic starts from a fresh copy of the scenario.
    gift = step(start("mechanics"), "dark_gift")
    pending = gift["state"]["me"]["pending"]
    assert pending["kind"] == "discover" and all(o["attached"] for o in pending["options"])

    choose = step(start("mechanics"), "cast")
    assert choose["state"]["me"]["pending"]["kind"] == "choose_one"
    assert "；或者" in choose["state"]["me"]["pending"]["source"]["text_zh"]

    # Activating the discarder targets hand cards; the chosen one leaves the hand.
    snapshot = start("mechanics")
    bandit = next(c for c in snapshot["state"]["me"]["board"] if c["id"] == "BG28_582")
    aiming = step(snapshot, "activate", entity_id=bandit["eid"])
    hand = {c["hid"] for c in aiming["state"]["me"]["hand"]}
    targets = aiming["state"]["me"]["pending"]["targets"]
    assert targets and set(targets) <= hand
    discarded = step(aiming, "target", target_id=targets[0])
    assert targets[0] not in {c["hid"] for c in discarded["state"]["me"]["hand"]}


def test_late_shows_opponent_powers_and_trinkets(start):
    opponents = start("late")["state"]["opponents"]
    assert all(op["hero_powers"][0]["kind"] == "hero_power" for op in opponents)
    # Seat 1 is 塞纳留斯 in this game; the power comes from that seat, not the catalog default.
    assert opponents[0]["hero_powers"][0]["name_zh"] == "古树的智慧"
    assert opponents[0]["warband"] == {"size": 7, "races": {"ELEMENTAL": 2, "MURLOC": 4, "ABERRATION": 1}}
    assert "board" not in opponents[0]
    assert any(op["trinkets"] for op in opponents)
    assert all("win_streak" in op for op in opponents)


def test_all_tribe_minions_count_for_every_lobby_tribe():
    board = [{"races": ["MURLOC"]}, {"races": ["ALL"]}, {"races": []}, {"races": ["MECHANICAL", "MURLOC"]}]
    assert race_counts(board, ["MURLOC", "DEMON"]) == {"MURLOC": 3, "DEMON": 1, "MECHANICAL": 1}


def test_cards_carry_taiwan_text(start):
    me = start("mechanics")["state"]["me"]
    bandit = next(c for c in me["board"] if c["id"] == "BG28_582")
    assert bandit["name_tw"] == "重傷的強盜"
    assert bandit["text_tw"].startswith("發動（0）：棄掉一張牌")
    assert all(c["name_tw"] for c in me["hand"])
