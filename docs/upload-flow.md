# Upload Flow

## Overview

CloudVault supports two upload modes:

1. **Simple upload** — for files ≤ 5 MB (single HTTP request)
2. **Chunked resumable upload** — for files > 5 MB (implemented in Phase 5)

---

## Simple Upload Sequence

```
Client                  Nginx               API                  MinIO               PostgreSQL
  │                       │                  │                     │                     │
  │── POST /api/files ────>│                  │                     │                     │
  │                       │── proxy ─────────>│                     │                     │
  │                       │                  │── putObject ────────>│                     │
  │                       │                  │<── objectKey ────────│                     │
  │                       │                  │── INSERT file ───────────────────────────>│
  │                       │                  │<── file row ─────────────────────────────│
  │<── 201 { fileId } ────│<── response ─────│                     │                     │
```

---

## Chunked Resumable Upload Sequence (Phase 5)

```
Client                       API                      MinIO             PostgreSQL / Redis
  │                            │                        │                        │
  │── POST /api/uploads/initiate ────────────────────>  │                        │
  │                            │── create upload session ──────────────────────> │
  │<── { uploadId, chunkSize } │                        │                        │
  │                            │                        │                        │
  │  (for each chunk i)        │                        │                        │
  │── POST /uploads/:id/chunk ──────────────────────>   │                        │
  │                            │── hash chunk (SHA-256) │                        │
  │                            │── check if block exists ──────────────────────> │
  │                            │   (deduplication)      │                        │
  │                            │── putObject (if new) ──>                        │
  │                            │── mark chunk complete ─────────────────────── > │
  │<── { chunkIndex, received }│                        │                        │
  │                            │                        │                        │
  │── POST /uploads/:id/complete ───────────────────>   │                        │
  │                            │── assemble file metadata ─────────────────────> │
  │<── { fileId }              │                        │                        │
```

---

## Resumability

If a client disconnects mid-upload:

1. Client calls `GET /api/uploads/:uploadId/status`
2. Server returns list of received chunk indices
3. Client skips already-uploaded chunks
4. Client resumes from the first missing chunk

---

## Chunk Size

- Default: **4 MB** per chunk
- Rationale: balances retry overhead vs. number of requests

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Network timeout on chunk | Client retries that chunk only |
| Server crash mid-upload | Session state in Redis/DB survives; client resumes |
| Duplicate chunk (same hash) | Server detects via block hash; skips storage write |
| Bucket full / storage error | 507 response; client notified; upload session cancelled |
