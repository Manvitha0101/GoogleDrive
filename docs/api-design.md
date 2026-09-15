# API Design

Base URL: `/api/v1`

All requests require `Authorization: Bearer <access_token>` unless marked **Public**.

---

## Authentication

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/auth/register` | Register a new user | Public |
| POST | `/auth/login` | Login, returns access + refresh token | Public |
| POST | `/auth/refresh` | Refresh access token | Public |
| POST | `/auth/logout` | Invalidate refresh token | Required |
| POST | `/auth/password-reset/request` | Send password reset email | Public |
| POST | `/auth/password-reset/confirm` | Set new password with token | Public |

### POST `/auth/register`
```json
// Request
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "display_name": "Jane Doe"
}

// Response 201
{
  "user_id": "uuid",
  "email": "user@example.com",
  "display_name": "Jane Doe",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### POST `/auth/login`
```json
// Response 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

---

## Files

| Method | Endpoint | Description |
|---|---|---|
| GET | `/files` | List files in a folder |
| POST | `/files/upload-url` | Get pre-signed upload URL |
| POST | `/files/upload-complete` | Confirm upload + save metadata |
| GET | `/files/{file_id}` | Get file metadata |
| GET | `/files/{file_id}/download-url` | Get pre-signed download URL |
| PATCH | `/files/{file_id}` | Rename / move file |
| DELETE | `/files/{file_id}` | Move to trash |
| DELETE | `/files/{file_id}/permanent` | Permanently delete |
| GET | `/files/{file_id}/versions` | List version history |

### GET `/files?folder_id=&page=1&limit=50`
```json
// Response 200
{
  "items": [
    {
      "file_id": "uuid",
      "name": "report.pdf",
      "size": 204800,
      "mime_type": "application/pdf",
      "folder_id": "uuid",
      "owner_id": "uuid",
      "created_at": "2024-01-01T00:00:00Z",
      "modified_at": "2024-01-02T00:00:00Z",
      "is_trashed": false
    }
  ],
  "total": 120,
  "page": 1,
  "limit": 50
}
```

### POST `/files/upload-url`
```json
// Request
{
  "file_name": "report.pdf",
  "mime_type": "application/pdf",
  "size": 204800,
  "folder_id": "uuid"
}

// Response 200
{
  "upload_url": "https://storage/presigned?...",
  "file_id": "uuid",
  "expires_in": 900
}
```

---

## Folders

| Method | Endpoint | Description |
|---|---|---|
| GET | `/folders` | List root folders |
| POST | `/folders` | Create folder |
| GET | `/folders/{folder_id}` | Get folder metadata |
| PATCH | `/folders/{folder_id}` | Rename / move folder |
| DELETE | `/folders/{folder_id}` | Delete folder (recursive) |

### POST `/folders`
```json
// Request
{ "name": "Projects", "parent_id": null }

// Response 201
{
  "folder_id": "uuid",
  "name": "Projects",
  "parent_id": null,
  "owner_id": "uuid",
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

## Sharing

| Method | Endpoint | Description |
|---|---|---|
| POST | `/share` | Share item with user or generate link |
| GET | `/share/{item_id}` | Get sharing settings for item |
| PATCH | `/share/{share_id}` | Update permissions |
| DELETE | `/share/{share_id}` | Revoke access |
| GET | `/shared-with-me` | List items shared with current user |

### POST `/share`
```json
// Request
{
  "item_id": "uuid",
  "item_type": "file",           // "file" | "folder"
  "share_type": "user",          // "user" | "link"
  "email": "collaborator@example.com",
  "permission": "editor"         // "viewer" | "commenter" | "editor"
}

// Response 201
{
  "share_id": "uuid",
  "share_link": null,
  "expires_at": null
}
```

---

## Notifications

| Method | Endpoint | Description |
|---|---|---|
| GET | `/notifications` | List notifications (paginated) |
| PATCH | `/notifications/{id}/read` | Mark as read |
| PATCH | `/notifications/read-all` | Mark all as read |

---

## Error Format

```json
{
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "The requested file does not exist or you lack permission.",
    "status": 404
  }
}
```

| HTTP Status | Meaning |
|---|---|
| 400 | Bad request / validation error |
| 401 | Unauthenticated |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict (e.g. duplicate name) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
