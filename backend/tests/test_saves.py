from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend import main
from backend.store import SaveStore

client = TestClient(main.app)


@pytest.fixture
def saves(monkeypatch, tmp_path):
    """A fresh process state that saves to a file in tmp_path."""
    path = tmp_path / "games.sqlite3"
    monkeypatch.setattr(main, "store", SaveStore(path))
    monkeypatch.setattr(main, "sessions", {})
    return path


def restart(monkeypatch, path):
    """Forget every game in memory and reopen the save file, as a new process would."""
    main.store.close()
    monkeypatch.setattr(main, "store", SaveStore(path))
    monkeypatch.setattr(main, "sessions", {})


def act(snapshot, request_id=None):
    action = next(a for a in snapshot["legal_actions"] if a["kind"] != "end_turn")
    payload = dict(version=snapshot["version"], request_id=request_id or uuid4().hex, action=action)
    return client.post(f"/api/games/{snapshot['game_id']}/actions", json=payload)


def end_turn(snapshot):
    payload = dict(version=snapshot["version"], request_id=uuid4().hex, action={"kind": "end_turn"})
    return client.post(f"/api/games/{snapshot['game_id']}/actions", json=payload)


def test_game_resumes_after_restart(saves, monkeypatch):
    snapshot = client.post("/api/games?scenario=showcase").json()
    for _ in range(3):
        snapshot = act(snapshot).json()
    snapshot = end_turn(snapshot).json()
    assert snapshot["ok"]

    restart(monkeypatch, saves)
    resumed = client.get(f"/api/games/{snapshot['game_id']}").json()
    assert resumed["version"] == snapshot["version"]
    assert resumed["state"] == snapshot["state"]
    assert resumed["legal_actions"] == snapshot["legal_actions"]

    after = act(resumed)
    assert after.status_code == 200
    assert after.json()["version"] == snapshot["version"] + 1


def test_duplicate_request_is_recognized_after_restart(saves, monkeypatch):
    snapshot = client.post("/api/games?scenario=showcase").json()
    request_id = uuid4().hex
    assert act(snapshot, request_id).status_code == 200

    restart(monkeypatch, saves)
    retry = act(snapshot, request_id)
    assert retry.status_code == 409
    assert retry.json()["error"] == {"code": "duplicate_request", "applied_version": 1}


def test_unknown_game_is_still_404_with_saves(saves):
    assert client.get("/api/games/" + uuid4().hex).status_code == 404


def test_failed_save_leaves_the_game_unchanged(saves, monkeypatch):
    snapshot = client.post("/api/games?scenario=showcase").json()

    def fail(*_args):
        raise OSError("disk full")
    monkeypatch.setattr(main.store, "write", fail)
    response = act(snapshot)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "save_error"
    assert client.get(f"/api/games/{snapshot['game_id']}").json()["version"] == 0


def test_idle_game_leaves_memory_and_reloads(saves):
    snapshot = client.post("/api/games?scenario=showcase").json()
    game_id = snapshot["game_id"]
    session = main.sessions[game_id]
    main.sweep(now=session.touched + main.MEMORY_IDLE_SECONDS + 1)
    assert game_id not in main.sessions
    assert session.closed

    response = act(snapshot)
    assert response.status_code == 200
    assert main.sessions[game_id] is not session


def test_request_holding_an_evicted_session_reloads_it(saves):
    snapshot = client.post("/api/games?scenario=showcase").json()
    session = main.sessions[snapshot["game_id"]]
    # The sweep closed it after this request looked it up but before it took the lock.
    session.closed = True
    main.sessions.pop(snapshot["game_id"])
    assert act(snapshot).status_code == 200


def test_old_saves_are_deleted(saves):
    finished = client.post("/api/games?scenario=showcase").json()["game_id"]
    idle = client.post("/api/games?scenario=showcase").json()["game_id"]
    fresh = client.post("/api/games?scenario=showcase").json()["game_id"]
    save = main.store.read(finished)
    main.store.write(finished, replace(save, over=True))

    now = main.time.time()
    deleted = main.store.delete_older(now + 1, now - 1)
    assert deleted == 1
    assert main.store.read(finished) is None
    assert main.store.read(idle) is not None
    deleted = main.store.delete_older(now - main.FINISHED_KEEP_SECONDS, now + 1)
    assert deleted == 2
    assert main.store.read(fresh) is None


def test_without_saves_only_old_games_leave_memory(monkeypatch):
    monkeypatch.setattr(main, "store", None)
    monkeypatch.setattr(main, "sessions", {})
    game_id = client.post("/api/games?scenario=showcase").json()["game_id"]
    touched = main.sessions[game_id].touched
    main.sweep(now=touched + main.MEMORY_IDLE_SECONDS + 1)
    assert game_id in main.sessions
    main.sweep(now=touched + main.IDLE_KEEP_SECONDS + 1)
    assert game_id not in main.sessions
