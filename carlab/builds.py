"""Saved builds: a name, the build itself (the page's JSON, see static/js/lib/build.js) and a small picture of it,
kept in one SQLite file on this computer. Nothing about the person is stored: no accounts, no addresses."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

MAX_BUILD_BYTES = 200_000
MAX_THUMBNAIL_BYTES = 400_000
THUMBNAIL = re.compile(r"\Adata:image/(jpeg|png);base64,[A-Za-z0-9+/=]+\Z")


class BuildError(ValueError):
    pass


def clean(payload) -> dict:
    """Checks what the page sent to save; raises BuildError with what's wrong."""
    if not isinstance(payload, dict):
        raise BuildError("Send a build as a JSON object.")
    build = payload.get("build")
    if not isinstance(build, dict):
        raise BuildError("There's no build to save.")
    text = json.dumps(build, separators=(",", ":"))
    if len(text.encode()) > MAX_BUILD_BYTES:
        raise BuildError("That build is too big to save.")
    name = str(payload.get("name") or build.get("name") or "").strip()[:80] or "Untitled build"
    thumbnail = payload.get("thumbnail") or None
    if thumbnail is not None:
        if not isinstance(thumbnail, str) or not THUMBNAIL.match(thumbnail):
            raise BuildError("The picture should be a JPEG or PNG data URL.")
        if len(thumbnail) > MAX_THUMBNAIL_BYTES:
            raise BuildError("The picture is too big.")
    return {"name": name, "build": text, "thumbnail": thumbnail}


class Store:
    def __init__(self, path: str | Path = ":memory:"):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS builds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, build TEXT NOT NULL,"
                " thumbnail TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    @staticmethod
    def _row(row, full=True) -> dict:
        out = {"id": row["id"], "name": row["name"], "thumbnail": row["thumbnail"], "created_at": row["created_at"], "updated_at": row["updated_at"]}
        if full:
            out["build"] = json.loads(row["build"])
        return out

    def all(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT * FROM builds ORDER BY updated_at DESC, id DESC").fetchall()
        return [self._row(r, full=False) for r in rows]

    def get(self, build_id: int) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        return self._row(row) if row else None

    def create(self, payload) -> dict:
        data = clean(payload)
        now = self._now()
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT INTO builds (name, build, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (data["name"], data["build"], data["thumbnail"], now, now),
            )
            build_id = cur.lastrowid
        return self.get(build_id)

    def update(self, build_id: int, payload) -> dict | None:
        data = clean(payload)
        with self.lock, self.db:
            cur = self.db.execute(
                "UPDATE builds SET name = ?, build = ?, thumbnail = COALESCE(?, thumbnail), updated_at = ? WHERE id = ?",
                (data["name"], data["build"], data["thumbnail"], self._now(), build_id),
            )
        return self.get(build_id) if cur.rowcount else None

    def delete(self, build_id: int) -> bool:
        with self.lock, self.db:
            cur = self.db.execute("DELETE FROM builds WHERE id = ?", (build_id,))
        return cur.rowcount > 0
