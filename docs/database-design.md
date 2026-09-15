# Database Design

Database: **PostgreSQL 16**

---

## Entity-Relationship Overview

```
users ──< files
users ──< folders
folders ──< files
folders ──< folders (self-referencing, parent)
files ──< file_versions
files ──< shares
folders ──< shares
users ──< notifications
```

---

## Tables

### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL |
| `display_name` | VARCHAR(100) | NOT NULL |
| `password_hash` | VARCHAR(255) | nullable (OAuth users) |
| `avatar_url` | TEXT | nullable |
| `storage_used` | BIGINT | DEFAULT 0 (bytes) |
| `storage_quota` | BIGINT | DEFAULT 15_000_000_000 (15 GB) |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

### `folders`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR(255) | NOT NULL |
| `owner_id` | UUID | FK → users.id |
| `parent_id` | UUID | FK → folders.id, nullable (root) |
| `path` | LTREE | indexed (materialised path) |
| `is_trashed` | BOOLEAN | DEFAULT FALSE |
| `trashed_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

> `path` uses PostgreSQL `ltree` extension for efficient ancestor/descendant queries.

---

### `files`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR(255) | NOT NULL |
| `owner_id` | UUID | FK → users.id |
| `folder_id` | UUID | FK → folders.id, nullable |
| `mime_type` | VARCHAR(127) | NOT NULL |
| `size` | BIGINT | NOT NULL (bytes) |
| `storage_key` | TEXT | UNIQUE, NOT NULL (object storage path) |
| `checksum` | VARCHAR(64) | nullable (SHA-256) |
| `is_trashed` | BOOLEAN | DEFAULT FALSE |
| `trashed_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

### `file_versions`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `file_id` | UUID | FK → files.id ON DELETE CASCADE |
| `version_number` | INTEGER | NOT NULL |
| `storage_key` | TEXT | NOT NULL |
| `size` | BIGINT | NOT NULL |
| `checksum` | VARCHAR(64) | nullable |
| `created_by` | UUID | FK → users.id |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

### `shares`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `item_id` | UUID | NOT NULL |
| `item_type` | VARCHAR(10) | CHECK IN ('file','folder') |
| `owner_id` | UUID | FK → users.id |
| `shared_with_id` | UUID | FK → users.id, nullable (link shares) |
| `share_token` | VARCHAR(64) | UNIQUE, nullable (public link) |
| `permission` | VARCHAR(20) | CHECK IN ('viewer','commenter','editor') |
| `expires_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

### `notifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users.id |
| `type` | VARCHAR(50) | e.g. 'file_shared', 'upload_complete' |
| `payload` | JSONB | event-specific data |
| `is_read` | BOOLEAN | DEFAULT FALSE |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

## Indexes

```sql
-- Fast folder children lookup
CREATE INDEX idx_folders_parent_id ON folders(parent_id);

-- Fast file listing by folder
CREATE INDEX idx_files_folder_id ON files(folder_id);

-- Sharing lookups
CREATE INDEX idx_shares_item ON shares(item_id, item_type);
CREATE INDEX idx_shares_shared_with ON shares(shared_with_id);

-- Notifications per user
CREATE INDEX idx_notifications_user_id ON notifications(user_id, created_at DESC);

-- Full-text search on file names
CREATE INDEX idx_files_name_fts ON files USING GIN (to_tsvector('english', name));
```

---

## Migrations

Migrations are managed with a tool such as **Flyway** or **Alembic**.
Naming convention: `V<version>__<description>.sql`

Example:
```
migrations/
├── V1__create_users.sql
├── V2__create_folders.sql
├── V3__create_files.sql
├── V4__create_file_versions.sql
├── V5__create_shares.sql
└── V6__create_notifications.sql
```
