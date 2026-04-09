import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

from api.config import get_config

_db_path: Optional[Path] = None


def _get_db_path() -> Path:
    global _db_path
    if _db_path is None:
        cfg = get_config()
        _db_path = Path(cfg["paths"]["chat_db"])
    return _db_path


async def init_db():
    """Create tables if they don't exist."""
    async with aiosqlite.connect(_get_db_path()) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session
            ON chat_messages(session_id)
        """)
        await db.commit()


async def create_session(title: str) -> dict:
    """Create a new chat session. Returns the session dict."""
    session_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc).isoformat()
    async with aiosqlite.connect(_get_db_path()) as db:
        await db.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, title, now, now),
        )
        await db.commit()
    return {"id": session_id, "title": title, "created_at": now, "updated_at": now, "message_count": 0}


async def add_message(session_id: str, role: str, content: str) -> dict:
    """Add a message to a session. Returns the message dict."""
    message_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc).isoformat()
    async with aiosqlite.connect(_get_db_path()) as db:
        # Verify session exists
        cursor = await db.execute("SELECT id FROM chat_sessions WHERE id = ?", (session_id,))
        if not await cursor.fetchone():
            raise ValueError(f"Session '{session_id}' not found")
        await db.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (message_id, session_id, role, content, now),
        )
        # Update session timestamp
        await db.execute(
            "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        await db.commit()
    return {"id": message_id, "session_id": session_id, "role": role, "content": content, "created_at": now}


async def get_sessions() -> list[dict]:
    """Get all sessions with message counts, ordered by most recent."""
    async with aiosqlite.connect(_get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT s.id, s.title, s.created_at, s.updated_at,
                   COUNT(m.id) as message_count
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON m.session_id = s.id
            GROUP BY s.id
            ORDER BY s.updated_at DESC
        """)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_session_messages(session_id: str) -> list[dict]:
    """Get all messages for a session, ordered by creation time."""
    async with aiosqlite.connect(_get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, session_id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def delete_session(session_id: str):
    """Delete a session and all its messages."""
    async with aiosqlite.connect(_get_db_path()) as db:
        # Enable foreign keys so CASCADE works
        await db.execute("PRAGMA foreign_keys = ON")
        cursor = await db.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        if cursor.rowcount == 0:
            raise ValueError(f"Session '{session_id}' not found")
        await db.commit()


async def update_session_title(session_id: str, title: str) -> dict:
    """Update a session's title."""
    now = datetime.now(tz=timezone.utc).isoformat()
    async with aiosqlite.connect(_get_db_path()) as db:
        cursor = await db.execute(
            "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        if cursor.rowcount == 0:
            raise ValueError(f"Session '{session_id}' not found")
        await db.commit()
    return {"id": session_id, "title": title, "updated_at": now}


async def export_session(session_id: str, fmt: str = "txt") -> str:
    """Export a session in the given format. Returns content as string."""
    async with aiosqlite.connect(_get_db_path()) as db:
        db.row_factory = aiosqlite.Row

        # Get session info
        cursor = await db.execute("SELECT id, title, created_at FROM chat_sessions WHERE id = ?", (session_id,))
        session = await cursor.fetchone()
        if not session:
            raise ValueError(f"Session '{session_id}' not found")
        session = dict(session)

        # Get messages
        cursor = await db.execute(
            "SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        messages = [dict(row) for row in await cursor.fetchall()]

    if fmt == "txt":
        lines = [f"Chat: {session['title']}", f"Date: {session['created_at']}", ""]
        for msg in messages:
            label = "You" if msg["role"] == "user" else "AI"
            lines.append(f"[{label}]")
            lines.append(msg["content"])
            lines.append("")
        return "\n".join(lines)

    elif fmt == "jsonl":
        lines = []
        for msg in messages:
            lines.append(json.dumps({"role": msg["role"], "content": msg["content"]}))
        return "\n".join(lines)

    elif fmt == "pdf":
        # Return structured data — PDF generation handled by caller or frontend
        return json.dumps({
            "title": session["title"],
            "created_at": session["created_at"],
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
        })

    else:
        raise ValueError(f"Unsupported format: {fmt}")
