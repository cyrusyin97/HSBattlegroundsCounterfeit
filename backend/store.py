"""Game saves in one SQLite file, so a restart, crash or redeploy does not lose games in progress.

Games live in memory between actions; this file is written after every action and read only
when a game is not in memory, such as the first request after a restart. See docs/DEPLOY.md.
"""
import json
import sqlite3
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from threading import Lock


@dataclass(frozen=True)
class Save:
    version: int
    state: str
    """The engine's `state_json`."""
    applied: dict[str, int]
    """Successful request IDs and their committed versions."""
    over: bool


class SaveStore:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # FastAPI runs sync endpoints on a thread pool; one connection behind a lock is enough
        # for a single process, and each write is a few milliseconds.
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._lock = Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=NORMAL")
            self._db.execute("""CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                state BLOB NOT NULL,
                applied TEXT NOT NULL,
                over INTEGER NOT NULL,
                updated REAL NOT NULL)""")

    def write(self, game_id: str, save: Save):
        row = (game_id, save.version, zlib.compress(save.state.encode(), 6),
               json.dumps(save.applied), int(save.over), time.time())
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO games VALUES (?, ?, ?, ?, ?, ?)", row)

    def read(self, game_id: str) -> Save | None:
        with self._lock:
            row = self._db.execute("SELECT version, state, applied, over FROM games WHERE id = ?",
                                   (game_id,)).fetchone()
        if row is None:
            return None
        version, state, applied, over = row
        return Save(version, zlib.decompress(state).decode(), json.loads(applied), bool(over))

    def delete_older(self, finished_before: float, idle_before: float) -> int:
        """Delete finished games last saved before one time and any game idle since another."""
        with self._lock:
            cursor = self._db.execute(
                "DELETE FROM games WHERE (over AND updated < ?) OR updated < ?",
                (finished_before, idle_before))
        return cursor.rowcount

    def close(self):
        with self._lock:
            self._db.close()
