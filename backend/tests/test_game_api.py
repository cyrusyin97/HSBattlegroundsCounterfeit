from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
import taverngym

from backend import main
from backend.game_session import ActionRequest, GameSession

client = TestClient(main.app)


@pytest.fixture
def game(monkeypatch):
    engine = taverngym.Game(seed=17)
    for seat in range(8):
        engine.step(seat, 30)
    for command in (
        dict(cmd="set_player", p=0, gold=10),
        dict(cmd="add_spell", p=0, zone="hand", card="BG_TB_006"),
        dict(cmd="add_minion", p=0, zone="board", card="BG28_300"),
    ):
        engine.debug(json.dumps(command))
    session = GameSession(engine)
    monkeypatch.setitem(main.sessions, session.id, session)
    return session


def message(session, action):
    return dict(version=session.read()["version"], request_id=uuid4().hex, action=action)


def post(session, payload):
    return client.post(f"/api/games/{session.id}/actions", json=payload)


def option(snapshot, kind):
    return next(a for a in snapshot["legal_actions"] if a["kind"] == kind)


@pytest.mark.parametrize(("seed", "extra_discover"), [(17, False), (26, True)])
def test_new_game_select_and_resume(monkeypatch, seed, extra_discover):
    monkeypatch.setattr(main.secrets, "randbits", lambda bits: seed)
    response = client.post("/api/games")
    assert response.status_code == 201
    initial = response.json()
    game_id = initial["game_id"]
    try:
        assert initial["state"]["phase"] == "hero_select"
        assert "seed" not in initial["state"]
        result = client.post(f"/api/games/{game_id}/actions", json={
            "version": 0, "request_id": "pick", "action": option(initial, "choose"),
        }).json()
        assert result["ok"]
        if extra_discover:
            assert result["state"]["me"]["pending"]["kind"] == "discover"
            result = client.post(f"/api/games/{game_id}/actions", json={
                "version": result["version"], "request_id": "discover", "action": option(result, "choose"),
            }).json()
        assert result["ok"] and result["state"]["turn"] == 1
        assert client.get(f"/api/games/{game_id}").json()["version"] == result["version"]
    finally:
        main.sessions.pop(game_id)


def test_purchase_retries_and_stale_entities(game):
    initial = game.read()
    buy = next(a for a in initial["legal_actions"] if a["kind"] == "buy"
               and a["shop_id"] == initial["state"]["me"]["shop"][0]["sid"])
    payload = message(game, buy)
    result = post(game, payload).json()
    before, after = initial["state"]["me"], result["state"]["me"]
    assert result["ok"] and result["version"] == 1
    assert before["gold"] - after["gold"] == before["shop"][0]["price"]
    assert len(after["hand"]) == len(before["hand"]) + 1
    assert buy["shop_id"] not in [card["sid"] for card in after["shop"]]
    full_state = game.game.state_json()
    for req, status, code in (
        (payload, 409, "duplicate_request"),
        ({**payload, "request_id": "late"}, 409, "stale_version"),
        (message(game, buy), 422, "illegal_action"),
        (message(game, {"kind": "sell", "entity_id": -1}), 422, "illegal_action"),
    ):
        response = post(game, req)
        assert response.status_code == status and response.json()["error"]["code"] == code
        assert response.json()["version"] == 1
        assert game.game.state_json() == full_state


def test_simultaneous_requests_commit_once(game):
    barrier = Barrier(2)
    action = option(game.read(), "buy")
    payloads = [message(game, action), message(game, action)]

    def submit(payload):
        barrier.wait(timeout=5)
        return post(game, payload).status_code

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(submit, payloads)) == [200, 409]
    assert game.read()["version"] == 1


def test_spell_target_and_cross_transport_dedup(game):
    original = game.read()["state"]["me"]["board"][0]
    cast = message(game, option(game.read(), "cast"))
    with client.websocket_connect(f"/ws/games/{game.id}") as ws:
        assert ws.receive_json()["version"] == 0
        ws.send_json(cast)
        choosing = ws.receive_json()
        assert choosing["ok"] and choosing["state"]["me"]["pending"]["kind"] == "target"
        assert post(game, cast).json()["error"]["code"] == "duplicate_request"
        checkpoint = game.game.state_json()
        ws.send_json(message(game, {"kind": "target", "target_id": -1}))
        assert ws.receive_json()["error"]["code"] == "illegal_action"
        assert game.game.state_json() == checkpoint
        target = {"kind": "target", "target_id": original["eid"]}
        assert target in choosing["legal_actions"]
        ws.send_json(message(game, target))
        resolved = ws.receive_json()
        assert resolved["ok"] and resolved["state"]["me"]["pending"] is None
        boosted = resolved["state"]["me"]["board"][0]
        assert (boosted["atk"], boosted["hp"]) == (original["atk"] + 2, original["hp"] + 2)


def test_live_replay_and_player_privacy(game):
    for _ in range(2):
        result = post(game, message(game, {"kind": "end_turn"})).json()
        assert result["ok"] and result["combat"]["frames"]
        assert 0 in (result["combat"]["a"], result["combat"]["b"])
        assert result["combat"]["turn"] + 1 == result["state"]["turn"]
        for opponent in result["state"]["opponents"]:
            assert {"hand", "shop", "board", "last_board"}.isdisjoint(opponent)
        assert {"seed", "mask", "combats", "config"}.isdisjoint(result["state"])


def test_step_failure_rolls_back_bot_and_player_actions(game, monkeypatch):
    before = game.game.state_json()

    def fail(candidate):
        raise RuntimeError("simulated driver failure")

    monkeypatch.setattr("backend.game_session.advance_bots", fail)
    request = ActionRequest(**message(game, option(game.read(), "buy")))
    status, result = game.submit(request)
    assert status == 500 and result["error"]["code"] == "engine_error"
    assert game.game.state_json() == before and game.read()["version"] == 0
    assert request.request_id not in game.applied


def test_drag_from_shop_to_hand_to_board_and_sell(game):
    owned = game.read()["state"]["me"]["board"][0]["eid"]

    def apply(action):
        result = post(game, message(game, action)).json()
        assert result["ok"]
        return result

    bought = apply(option(game.read(), "buy"))
    played = apply(option(bought, "play"))
    board = played["state"]["me"]["board"]
    assert [m["eid"] for m in board][1] == owned
    moved = apply({"kind": "move", "entity_id": owned, "position": 0})
    assert moved["state"]["me"]["board"][0]["eid"] == owned
    sold = apply({"kind": "sell", "entity_id": owned})
    assert owned not in [m["eid"] for m in sold["state"]["me"]["board"]]
    assert sold["state"]["me"]["gold"] == moved["state"]["me"]["gold"] + 1


def test_action_response_is_compressed_and_timed(game):
    response = client.post(f"/api/games/{game.id}/actions", headers={"Accept-Encoding": "gzip"},
                           json=message(game, {"kind": "freeze"}))
    assert response.status_code == 200 and response.json()["ok"]
    assert response.headers["content-encoding"] == "gzip"
    names = [part.split(";")[0] for part in response.headers["server-timing"].split(", ")]
    assert names == ["engine", "snapshot", "json", "total"]


def test_non_api_responses_are_not_compressed():
    response = client.get("/docs", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert "content-encoding" not in response.headers
