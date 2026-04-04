import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import get_current_user
from app.models.record_template import RecordTemplate
from app.models.user import User
from app.schemas.record_template import (
    RecordTemplateCreate,
    RecordTemplateResponse,
    RecordTemplateUpdate,
)
from app.utils.response import success_response

router = APIRouter(prefix="/record-templates", tags=["record-templates"])


def _can_manage_template(user: User, template: RecordTemplate) -> bool:
    if user.role == "admin":
        return True
    return template.created_by_id == user.id and not template.is_system


def _serialize_template(user: User, template: RecordTemplate) -> RecordTemplateResponse:
    can_manage = _can_manage_template(user, template)
    return RecordTemplateResponse(
        id=template.id,
        name=template.name,
        description=template.description,
        recordType=template.record_type,
        roleScope=template.role_scope,
        content=template.content,
        isSystem=template.is_system,
        isActive=template.is_active,
        sortOrder=template.sort_order,
        createdById=template.created_by_id,
        createdByName=template.created_by_name,
        updatedById=template.updated_by_id,
        updatedByName=template.updated_by_name,
        createdAt=template.created_at,
        updatedAt=template.updated_at,
        canEdit=can_manage,
        canDelete=can_manage,
    )


def _visible_templates_query(user: User, record_type: str, include_inactive: bool):
    conditions = [
        RecordTemplate.record_type == record_type,
        or_(
            RecordTemplate.created_by_id == user.id,
            and_(
                RecordTemplate.is_system == True,
                or_(
                    RecordTemplate.role_scope == user.role,
                    RecordTemplate.role_scope == "all",
                ),
            ),
        ),
    ]
    if user.role == "admin":
        conditions = [RecordTemplate.record_type == record_type]
    if not include_inactive:
        conditions.append(RecordTemplate.is_active == True)
    return select(RecordTemplate).where(*conditions)


@router.get("")
async def list_record_templates(
    record_type: str = Query(..., alias="recordType"),
    include_inactive: bool = Query(False, alias="includeInactive"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _visible_templates_query(user, record_type, include_inactive).order_by(
            RecordTemplate.is_system.desc(),
            RecordTemplate.sort_order.asc(),
            RecordTemplate.created_at.asc(),
        )
    )
    templates = result.scalars().all()
    return success_response(data={"templates": [_serialize_template(user, t).model_dump() for t in templates]})


@router.post("")
async def create_record_template(
    body: RecordTemplateCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role_scope = body.role_scope
    is_system = body.is_system
    if user.role != "admin":
        if role_scope != user.role:
            raise HTTPException(status_code=403, detail="只能建立自己角色的模板")
        if is_system:
            raise HTTPException(status_code=403, detail="只有管理者可以建立系統模板")
    template = RecordTemplate(
        id=f"rtpl_{uuid.uuid4().hex[:10]}",
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        record_type=body.record_type,
        role_scope=role_scope,
        content=body.content.strip(),
        is_system=is_system,
        is_active=True,
        sort_order=body.sort_order,
        created_by_id=user.id,
        created_by_name=user.name,
        updated_by_id=user.id,
        updated_by_name=user.name,
    )
    db.add(template)
    await db.flush()

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="建立記錄模板",
        target=template.id,
        status="success",
        ip=request.client.host if request.client else None,
        details={
            "record_type": template.record_type,
            "role_scope": template.role_scope,
            "is_system": template.is_system,
        },
    )
    return success_response(
        data=_serialize_template(user, template).model_dump(),
        message="模板已建立",
    )


@router.patch("/{template_id}")
async def update_record_template(
    template_id: str,
    body: RecordTemplateUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(RecordTemplate).where(RecordTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not _can_manage_template(user, template):
        raise HTTPException(status_code=403, detail="無權限修改此模板")

    if body.name is not None:
        template.name = body.name.strip()
    if body.description is not None:
        template.description = body.description.strip() or None
    if body.content is not None:
        template.content = body.content.strip()
    if body.sort_order is not None:
        template.sort_order = body.sort_order
    if body.is_active is not None:
        template.is_active = body.is_active
    if body.role_scope is not None:
        if user.role != "admin" and body.role_scope != user.role:
            raise HTTPException(status_code=403, detail="只能將模板設為自己角色")
        template.role_scope = body.role_scope
    if body.is_system is not None:
        if user.role != "admin":
            raise HTTPException(status_code=403, detail="只有管理者可以調整系統模板")
        template.is_system = body.is_system

    template.updated_by_id = user.id
    template.updated_by_name = user.name
    await db.flush()

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="更新記錄模板",
        target=template.id,
        status="success",
        ip=request.client.host if request.client else None,
        details={"record_type": template.record_type},
    )
    return success_response(
        data=_serialize_template(user, template).model_dump(),
        message="模板已更新",
    )


@router.delete("/{template_id}")
async def delete_record_template(
    template_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(RecordTemplate).where(RecordTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not _can_manage_template(user, template):
        raise HTTPException(status_code=403, detail="無權限刪除此模板")

    await db.delete(template)
    await db.flush()

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="刪除記錄模板",
        target=template_id,
        status="success",
        ip=request.client.host if request.client else None,
        details={"record_type": template.record_type},
    )
    return success_response(message="模板已刪除")
