# Download Flow

## Overview

CloudVault uses **pre-signed URLs** for file downloads.

The API never streams large file bytes through itself — it generates a short-lived signed URL pointing directly to MinIO/S3. The client then downloads directly from object storage, bypassing the API server.

This design:

- Removes large file bandwidth from API servers
- Enables CDN caching of public/shared files
- Scales naturally as object storage handles the load

---

## Download Sequence

```
Client              Nginx               API             PostgreSQL / Redis        MinIO
  │                   │                  │                     │                    │
  │── GET /api/files/:id/download ──────>│                     │                    │
  │                   │                  │── auth check ───────>│                    │
  │                   │                  │── permission check ──>│                    │
  │                   │                  │── presignedGetObject ──────────────────> │
  │                   │                  │<── signed URL ─────────────────────────  │
  │<── 200 { url } ───│<── response ─────│                     │                    │
  │                   │                  │                     │                    │
  │── GET <signed URL> ─────────────────────────────────────────────────────────── >│
  │<── file bytes ─────────────────────────────────────────────────────────────── ─ │
```

---

## Pre-signed URL Parameters

| Parameter | Value |
|---|---|
| Expiry | 900 seconds (15 minutes) |
| Method | GET |
| Bucket | `cloudvault-files` |
| Object key | Internal UUID-based key (not user filename) |

The object key is never the user-supplied filename to prevent path traversal attacks.

---

## Versioned Download

To download a specific version:

```
GET /api/files/:id/versions/:versionId/download
```

Returns a pre-signed URL pointing to the specific version's object key.

---

## Shared File Download

If the file is shared with a viewer:

1. API validates the share token or authenticated user permission
2. Generates pre-signed URL for the object
3. Returns URL to the authorized client

---

## Large File Streaming (fallback)

For environments where direct MinIO access is not possible, the API can stream the file:

```
GET /api/files/:id/stream
```

Uses Node.js streams (`minioClient.getObject → res.pipe`) to avoid loading the entire file into memory.

---

## Cache Behavior (Phase 7)

File metadata (size, MIME type, object key) is cached in Redis.
On download request:

```
Request → Redis (cache-aside)
  HIT: skip PostgreSQL, use cached objectKey
  MISS: query PostgreSQL, cache result for 5 minutes
→ presign URL → return to client
```
