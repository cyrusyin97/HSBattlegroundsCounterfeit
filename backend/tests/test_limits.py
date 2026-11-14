"""Limits for a publicly reachable server: a cap on games in memory and a per-address rate."""
from fastapi.testclient import TestClient
import pytest

from backend import main
from backend.store import SaveStore

client = TestClient(main.app)
NEW = "/api/games?scenario=showcase"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(main, "store", None)
    monkeypatch.setattr(main, "sessions", {})
    monkeypatch.setattr(main, "created", {})


def test_no_limits_by_default():
    assert main.MAX_GAMES == 0 and main.CREATE_LIMIT == 0
    assert all(client.post(NEW).status_code == 201 for _ in range(3))


def test_new_games_are_refused_while_the_server_is_full(monkeypatch):
    monkeypatch.setattr(main, "MAX_GAMES", 2)
    first = client.post(NEW).json()["game_id"]
    assert client.post(NEW).status_code == 201
    refused = client.post(NEW)
    assert refused.status_code == 503
    assert refused.json() == {"detail": "server_full"}
    assert refused.headers["retry-after"] == "60"
    assert len(main.sessions) == 2
    # A game that leaves memory makes room.
    main.sessions.pop(first)
    assert client.post(NEW).status_code == 201


def test_a_full_server_still_serves_and_reloads_existing_games(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "store", SaveStore(tmp_path / "games.sqlite3"))
    monkeypatch.setattr(main, "MAX_GAMES", 1)
    evicted = client.post(NEW).json()["game_id"]
    main.sessions.pop(evicted)
    playing = client.post(NEW).json()["game_id"]
    assert client.post(NEW).status_code == 503
    assert client.get(f"/api/games/{playing}").status_code == 200
    assert client.get(f"/api/games/{evicted}").status_code == 200
    assert set(main.sessions) == {playing, evicted}


def test_a_refused_game_does_not_count_against_the_visitor(monkeypatch):
    monkeypatch.setattr(main, "MAX_GAMES", 1)
    monkeypatch.setattr(main, "CREATE_LIMIT", 2)
    client.post(NEW)
    assert client.post(NEW).status_code == 503
    assert [len(times) for times in main.created.values()] == [1]


def test_one_address_starts_a_limited_number_of_games_per_window(monkeypatch):
    monkeypatch.setattr(main, "CREATE_LIMIT", 2)
    assert main.allow_create("203.0.113.9", now=1000) == 0
    assert main.allow_create("203.0.113.9", now=1010) == 0
    assert main.allow_create("203.0.113.9", now=1020) == main.CREATE_WINDOW_SECONDS - 20
    # Another address has its own allowance, and the first one gets a slot back as time passes.
    assert main.allow_create("203.0.113.10", now=1020) == 0
    assert main.allow_create("203.0.113.9", now=1000 + main.CREATE_WINDOW_SECONDS) == 0


def test_rate_limited_request_is_told_when_to_retry(monkeypatch):
    monkeypatch.setattr(main, "CREATE_LIMIT", 1)
    assert client.post(NEW).status_code == 201
    refused = client.post(NEW)
    assert refused.status_code == 429
    assert refused.json() == {"detail": "too_many_games"}
    assert 0 < int(refused.headers["retry-after"]) <= main.CREATE_WINDOW_SECONDS + 1
    assert len(main.sessions) == 1


def test_direct_connections_are_not_rate_limited(monkeypatch):
    monkeypatch.setattr(main, "CREATE_LIMIT", 1)
    assert [main.allow_create("127.0.0.1", now=1000) for _ in range(5)] == [0] * 5
    assert main.created == {}


def test_sweep_forgets_addresses_with_no_recent_games(monkeypatch):
    monkeypatch.setattr(main, "CREATE_LIMIT", 5)
    main.allow_create("203.0.113.9", now=1000)
    main.allow_create("203.0.113.10", now=2000)
    main.sweep(now=1000 + main.CREATE_WINDOW_SECONDS)
    assert list(main.created) == ["203.0.113.10"]
