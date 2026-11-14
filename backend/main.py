"""Single-process POC API. HTTP and WebSocket commands share a game lock.

Games stay in this process's memory between actions. When BG_SAVE_PATH names a SQLite file,
every action is also saved there, so games survive a restart; see docs/DEPLOY.md.
"""
import asyncio
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
import taverngym

from .game_session import ActionRequest, GameSession
from .scenarios import SCENARIOS, make_scenario
from .store import SaveStore

logger = logging.getLogger(__name__)

SWEEP_SECONDS = 300
MEMORY_IDLE_SECONDS = 30 * 60
"""With saves, a game idle this long leaves memory and reloads from its save on the next request."""
FINISHED_KEEP_SECONDS = 60 * 60
"""A finished game is deleted this long after its last action."""
IDLE_KEEP_SECONDS = float(os.environ.get("BG_IDLE_DAYS", "7")) * 86400
"""An unfinished game is deleted after this long without an action."""

store = SaveStore(os.environ["BG_SAVE_PATH"]) if os.environ.get("BG_SAVE_PATH") else None
sessions: dict[str, GameSession] = {}
sessions_lock = Lock()


def find_session(game_id: str) -> GameSession | None:
    """The game in memory, or loaded from its save after a restart or an idle eviction."""
    session = sessions.get(game_id)
    if session is not None or store is None:
        return session
    with sessions_lock:
        # Another request may have loaded it while this one waited.
        if game_id in sessions:
            return sessions[game_id]
        save = store.read(game_id)
        if save is None:
            return None
        session = sessions[game_id] = GameSession.restore(game_id, save, store)
        return session


def get_session(game_id: str) -> GameSession:
    session = find_session(game_id)
    if session is None:
        raise HTTPException(404, "unknown_game")
    return session


def submit(game_id: str, request: ActionRequest, timings: dict[str, float] | None = None):
    # A session evicted while this request waited for its lock is loaded again from the save.
    for _ in range(3):
        result = get_session(game_id).submit(request, timings)
        if result is not None:
            return result
    raise HTTPException(503, "busy")


def sweep(now: float | None = None):
    """Drop idle and finished games from memory, and delete old saves."""
    now = time.time() if now is None else now
    for game_id, session in list(sessions.items()):
        idle = now - session.touched
        if store is not None:
            leave = idle > MEMORY_IDLE_SECONDS
        else:
            # Without saves, leaving memory deletes the game.
            leave = idle > (FINISHED_KEEP_SECONDS if session.over else IDLE_KEEP_SECONDS)
        # Skip a session that is serving a request; the next sweep tries again.
        if leave and session.lock.acquire(blocking=False):
            try:
                session.closed = True
                with sessions_lock:
                    sessions.pop(game_id, None)
            finally:
                session.lock.release()
    if store is not None:
        deleted = store.delete_older(now - FINISHED_KEEP_SECONDS, now - IDLE_KEEP_SECONDS)
        if deleted:
            logger.info("Deleted %s old saves", deleted)


async def sweep_forever():
    while True:
        await asyncio.sleep(SWEEP_SECONDS)
        try:
            await run_in_threadpool(sweep)
        except Exception:
            logger.exception("Sweep failed")


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(sweep_forever())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Local Battlegrounds", lifespan=lifespan)


class CompressApi:
    """Gzip API responses, which are JSON of up to a few hundred KB. Static files are left alone:
    card art is already compressed, and compressing it again would only cost the server CPU."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=1024, compresslevel=6)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


app.add_middleware(CompressApi)


def server_timing(timings: dict[str, float], started: float) -> dict[str, str]:
    """A Server-Timing header, which browser developer tools show under the request's Timing tab."""
    parts = [f"{name};dur={ms:.1f}" for name, ms in timings.items()]
    parts.append(f"total;dur={(time.perf_counter() - started) * 1000:.1f}")
    return {"Server-Timing": ", ".join(parts)}


def stamped(body: dict) -> dict:
    """A game response with the server's clock, which the client uses to place combat playback."""
    return {**body, "server_now": round(time.time() * 1000)}


@app.get("/api/scenarios")
def list_scenarios():
    return [{"id": key, "instructions": value} for key, value in SCENARIOS.items()]


@app.post("/api/games", status_code=201)
def create_game(scenario: str | None = None):
    if scenario is not None and scenario not in SCENARIOS:
        raise HTTPException(404, "unknown_scenario")
    engine = make_scenario(scenario) if scenario is not None else taverngym.Game(seed=secrets.randbits(63))
    session = GameSession(engine, store=store)
    sessions[session.id] = session
    return stamped(session.read())


@app.get("/api/games/{game_id}")
def read_game(game_id: str):
    return stamped(get_session(game_id).read())


@app.post("/api/games/{game_id}/actions")
def submit_action(game_id: str, request: ActionRequest):
    started, timings = time.perf_counter(), {}
    status, result = submit(game_id, request, timings)
    result = stamped(result)
    # Encoding the JSON body is part of the response cost, so it is timed too.
    encoding = time.perf_counter()
    body = JSONResponse(result, status_code=status).body
    timings["json"] = (time.perf_counter() - encoding) * 1000
    return Response(body, status_code=status, media_type="application/json",
                    headers=server_timing(timings, started))


@app.websocket("/ws/games/{game_id}")
async def game_socket(ws: WebSocket, game_id: str):
    session = await run_in_threadpool(find_session, game_id)
    if session is None:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        await ws.send_json(stamped(await run_in_threadpool(session.read)))
        while True:
            try:
                request = ActionRequest.model_validate(await ws.receive_json())
            except (ValidationError, json.JSONDecodeError):
                await ws.send_json({"ok": False, "error": {"code": "invalid_request"}})
                continue
            try:
                _, result = await run_in_threadpool(submit, game_id, request)
            except HTTPException as error:
                result = {"ok": False, "error": {"code": error.detail}}
            await ws.send_json(stamped(result))
    except WebSocketDisconnect:
        return


# On a server, the built frontend is served from the same process; see docs/DEPLOY.md.
# Mounted last so the API routes above take precedence.
if os.environ.get("BG_STATIC_DIR"):
    app.mount("/", StaticFiles(directory=Path(os.environ["BG_STATIC_DIR"]), html=True), name="static")
