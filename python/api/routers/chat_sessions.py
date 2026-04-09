from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional

from api.services.chat_storage import (
    create_session,
    get_sessions,
    get_session_messages,
    delete_session,
    update_session_title,
    export_session,
    add_message,
)

router = APIRouter()


class CreateSessionRequest(BaseModel):
    title: str = "New Chat"


class UpdateTitleRequest(BaseModel):
    title: str


class AddMessageRequest(BaseModel):
    role: str
    content: str


@router.get("/sessions")
async def list_sessions():
    """List all chat sessions with message counts."""
    sessions = await get_sessions()
    return sessions


@router.post("/sessions")
async def new_session(req: CreateSessionRequest):
    """Create a new chat session."""
    session = await create_session(req.title)
    return session


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    """Get all messages for a session."""
    messages = await get_session_messages(session_id)
    return messages


@router.post("/sessions/{session_id}/messages")
async def post_message(session_id: str, req: AddMessageRequest):
    """Add a message to a session (used to persist chat messages)."""
    if req.role not in ("user", "assistant", "system"):
        raise HTTPException(status_code=400, detail="Role must be 'user', 'assistant', or 'system'")
    try:
        message = await add_message(session_id, req.role, req.content)
        return message
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/sessions/{session_id}")
async def update_title(session_id: str, req: UpdateTitleRequest):
    """Update a session's title."""
    try:
        result = await update_session_title(session_id, req.title)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/sessions/{session_id}")
async def remove_session(session_id: str):
    """Delete a session and all its messages."""
    try:
        await delete_session(session_id)
        return {"deleted": session_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/sessions/{session_id}/export")
async def export(session_id: str, format: str = Query("txt", pattern="^(txt|jsonl|pdf)$")):
    """Export a session as TXT, JSONL, or PDF data."""
    try:
        content = await export_session(session_id, format)
        if format == "txt":
            return PlainTextResponse(content, headers={
                "Content-Disposition": f"attachment; filename=chat-{session_id[:8]}.txt"
            })
        elif format == "jsonl":
            return PlainTextResponse(content, media_type="application/jsonl", headers={
                "Content-Disposition": f"attachment; filename=chat-{session_id[:8]}.jsonl"
            })
        else:  # pdf — return JSON data for frontend to render
            return PlainTextResponse(content, media_type="application/json")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
