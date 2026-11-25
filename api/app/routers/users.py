from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..auth import PROFILE_COLS, require_admin
from ..common import parse_uuid

router = APIRouter(tags=["users"])


class UserUpdate(BaseModel):
    role: Literal["admin", "reviewer", "contributor"] | None = None
    status: Literal["active", "suspended"] | None = None


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    return await db.fetch_all(
        """select p.id, p.email, p.full_name, p.avatar_url, p.role, p.status, p.created_at,
                  coalesce(j.n, 0)::int as judgments_count, j.last_active_at
             from profiles p
             left join (select user_id, count(*) as n, max(created_at) as last_active_at
                          from judgments group by user_id) j on j.user_id = p.id
            order by p.created_at asc"""
    )


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin: dict = Depends(require_admin)):
    uid = parse_uuid(user_id, "User")
    if body.role is None and body.status is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if uid == admin["id"]:
        if body.role is not None and body.role != "admin":
            raise HTTPException(status_code=400, detail="You cannot demote yourself")
        if body.status == "suspended":
            raise HTTPException(status_code=400, detail="You cannot suspend yourself")
    row = await db.fetch_one(
        f"""update profiles set role = coalesce(%s, role), status = coalesce(%s, status)
             where id = %s returning {PROFILE_COLS}""",
        (body.role, body.status, uid),
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row
