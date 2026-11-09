from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend import main
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
    choosing = step(snapshot, "cast")
    assert choosing["state"]["me"]["pending"]["kind"] == "target"
    resolved = step(choosing, "target", target_id=bone["eid"])
    buffed, = resolved["state"]["me"]["board"]
    assert (buffed["atk"], buffed["hp"]) == (bone["atk"] + 2, bone["hp"] + 2)


def test_triple(start):
    bought = buy(start("triple"), "BGS_004")
    golden, = bought["state"]["me"]["hand"]
    assert golden["id"] == "TB_BaconUps_079"
    choosing = step(step(bought, "play"), "cast")
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
    # A later shop action must retain this historical settlement, not overwrite it.
    assert step(resolved, "freeze")["combat"] == replay
