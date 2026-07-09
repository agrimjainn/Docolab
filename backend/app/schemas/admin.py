import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr

# Backend role names accepted by the admin endpoints. The UI labels map:
#   Owner -> owner, Manager -> approver, Collaborator -> editor, Viewer -> viewer
VALID_ROLE_NAMES = ("owner", "approver", "editor", "viewer")
DEFAULT_ASSIGN_ROLE = "editor"   # UI "Collaborator" — the requirement's default


# --- auth ---------------------------------------------------------------------

class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


# --- users / presence ---------------------------------------------------------

class AdminUserItem(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    avatar_color: Optional[str] = None
    status: str                      # "active" | "disabled" (membership state)
    online: bool                     # derived from last_seen_at
    last_seen_at: Optional[datetime] = None
    created_at: datetime


class AdminUserListResponse(BaseModel):
    users: list[AdminUserItem]


class MembershipUpdateRequest(BaseModel):
    # True = list (active member), False = delist (disabled — cannot log in).
    active: bool


class AdminUserCreate(BaseModel):
    # Admin-created org member. Like signup, the new user joins the admin's org
    # with NO org-wide role (per-user isolation) — access to documents comes only
    # from explicit assignments.
    email: EmailStr
    display_name: str
    password: str
    avatar_color: Optional[str] = None


# --- documents ----------------------------------------------------------------

class AdminDocItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    folder_id: Optional[uuid.UUID] = None
    ai_model: str
    trashed: bool
    created_by: uuid.UUID
    creator_email: Optional[str] = None
    creator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # The target user's role on this doc — only populated by the per-user
    # documents endpoint (None in the org-wide list, where "role" is per-user).
    role_name: Optional[str] = None


class AdminDocListResponse(BaseModel):
    documents: list[AdminDocItem]


# --- per-document access (roles) ---------------------------------------------

class DocAccessEntry(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role_id: Optional[uuid.UUID] = None
    role_name: Optional[str] = None
    is_creator: bool


class DocAccessListResponse(BaseModel):
    document_id: uuid.UUID
    entries: list[DocAccessEntry]


class DocAccessUpsertRequest(BaseModel):
    user_id: uuid.UUID
    role: str = DEFAULT_ASSIGN_ROLE


# --- multi-folder placement ---------------------------------------------------

class FolderCheckItem(BaseModel):
    folder_id: uuid.UUID
    name: str
    checked: bool
    is_primary: bool


class DocFoldersResponse(BaseModel):
    document_id: uuid.UUID
    primary_folder_id: Optional[uuid.UUID] = None
    folders: list[FolderCheckItem]


class SetDocFoldersRequest(BaseModel):
    # Full desired set of folder ids the document should appear in. The primary
    # (documents.folder_id) is always implied and never removed here.
    folder_ids: list[uuid.UUID]


# --- AI model -----------------------------------------------------------------

class SetAiModelRequest(BaseModel):
    ai_model: str


class AiModelResponse(BaseModel):
    document_id: uuid.UUID
    ai_model: str


# --- assign document to user (from the Users section) ------------------------

class AssignDocumentRequest(BaseModel):
    document_id: uuid.UUID
    role: str = DEFAULT_ASSIGN_ROLE


class OkResponse(BaseModel):
    success: bool = True
    message: str = "ok"


# --- AI model catalog (requirement 11, governed) ------------------------------

class AiModelItem(BaseModel):
    id: uuid.UUID
    vendor: str
    model_key: str
    display_name: str
    enabled: bool
    is_default: bool

    class Config:
        from_attributes = True


class AiModelListResponse(BaseModel):
    models: list[AiModelItem]


class AiModelCreate(BaseModel):
    vendor: str
    model_key: str
    display_name: str
    enabled: bool = True
    is_default: bool = False


class AiModelPatch(BaseModel):
    display_name: Optional[str] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None


# --- AI usage metering (Admin "Model Usage" section) --------------------------
# Tokens-only for now (no pricing). `unit` tells the frontend how to label the
# "cost" windows; cost fields are reserved for when per-token pricing is added.

class UsageByModelItem(BaseModel):
    vendor: str
    model_key: str
    display_name: Optional[str] = None     # None if the model left the catalog
    input_tokens: int
    output_tokens: int
    total_tokens: int
    call_count: int
    pct: float                             # share of total tokens (0..100) — the pie


class UsageByModelResponse(BaseModel):
    unit: str = "tokens"
    total_tokens: int
    models: list[UsageByModelItem]


class UsageByDocumentItem(BaseModel):
    document_id: Optional[uuid.UUID] = None   # None = orphaned (doc deleted)
    title: Optional[str] = None
    total_tokens: int
    input_tokens: int
    output_tokens: int
    call_count: int


class UsageByDocumentResponse(BaseModel):
    unit: str = "tokens"
    documents: list[UsageByDocumentItem]
