import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

class DocumentCreate(BaseModel):
    folder_id: str
    title: str

class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None
    starred: Optional[bool] = None
    trashed: Optional[bool] = None

class DocumentResponse(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID
    title: str
    status: str
    current_version_no: int
    yjs_doc_key: str
    starred: bool
    trashed: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DocumentListItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    current_version_no: int
    starred: bool
    trashed: bool
    created_by: uuid.UUID

    class Config:
        from_attributes = True

class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]

class AuthorizeCheckResponse(BaseModel):
    allowed: bool
    resolved_role: str | None
    via_scope: str | None
