"""Single-process, loopback POC API. HTTP and WebSocket commands share a game lock."""
import secrets
import json

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import ValidationError
import taverngym

from .game_session import ActionRequest, GameSession
from .scenarios import SCENARIOS, make_scenario

app = FastAPI(title="Local Battlegrounds")
sessions: dict[str, GameSession] = {}


def get_session(game_id: str) -> GameSession:
    session = sessions.get(game_id)
    if session is None:
        raise HTTPException(404, "unknown_game")
    return session


@app.get("/api/scenarios")
def list_scenarios():
    return [{"id": key, "instructions": value} for key, value in SCENARIOS.items()]


@app.post("/api/games", status_code=201)
def create_game(scenario: str | None = None):
    if scenario is not None and scenario not in SCENARIOS:
        raise HTTPException(404, "unknown_scenario")
    engine = make_scenario(scenario) if scenario is not None else taverngym.Game(seed=secrets.randbits(63))
    session = GameSession(engine)
    sessions[session.id] = session
    return session.read()


@app.get("/api/games/{game_id}")
def read_game(game_id: str):
    return get_session(game_id).read()


@app.post("/api/games/{game_id}/actions")
def submit_action(game_id: str, request: ActionRequest):
    status, result = get_session(game_id).submit(request)
    return JSONResponse(result, status_code=status)


@app.websocket("/ws/games/{game_id}")
async def game_socket(ws: WebSocket, game_id: str):
    session = sessions.get(game_id)
    if session is None:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        await ws.send_json(await run_in_threadpool(session.read))
        while True:
            try:
                request = ActionRequest.model_validate(await ws.receive_json())
            except (ValidationError, json.JSONDecodeError):
                await ws.send_json({"ok": False, "error": {"code": "invalid_request"}})
                continue
            _, result = await run_in_threadpool(session.submit, request)
            await ws.send_json(result)
    except WebSocketDisconnect:
        return
