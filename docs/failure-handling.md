# Failure Handling

## Design Philosophy

CloudVault is designed to:
1. Degrade gracefully — serve partial functionality when a dependency fails
2. Never silently corrupt data
3. Make interrupted operations resumable
4. Log all failures with enough context to diagnose

---

## Failure Scenarios

### 1. API Server Failure

**Scenario**: One of three API instances crashes.

**Detection**: Nginx marks the upstream unhealthy after failed health checks.

**Recovery**:
```
Request → Nginx
         │
         ├─ api_1 (DOWN) ← Nginx stops routing here
         ├─ api_2 ✓
         └─ api_3 ✓
```

Because API servers are **stateless** (JWT auth, shared DB/Redis), all requests are handled correctly by surviving instances.

Docker Compose: `restart: unless-stopped` automatically restarts the failed container.

---

### 2. PostgreSQL Failure

**Scenario**: Primary database becomes unreachable.

**Impact**: All write operations fail. Read operations fail if not in Redis cache.

**Handling**:
- API returns `503 Service Unavailable` with `{ "error": "database_unavailable" }`
- Cached data (file metadata in Redis) continues to serve reads for TTL duration
- In-progress uploads: chunk state tracked in Redis survives DB outage
- Uploads resume once DB recovers

**Recovery**: Docker `restart: unless-stopped`. In production: managed PostgreSQL with automatic failover (AWS RDS Multi-AZ).

---

### 3. Redis Failure

**Scenario**: Redis becomes unreachable.

**Impact**: Cache misses on every request (degraded performance, not data loss).

**Handling** (cache-aside pattern):
```
Request
   │
Redis unavailable → catch error
   │
Fall through to PostgreSQL
   │
Return response (no caching, acceptable degradation)
```

**CRITICAL**: Permissions are always re-verified from PostgreSQL when Redis is unavailable. Stale permission cache is never served.

---

### 4. MinIO / Object Storage Failure

**Scenario**: MinIO becomes unreachable.

**Impact**: All file uploads and downloads fail.

**Handling**:
- Upload API returns `503` with retry guidance
- Download API cannot generate pre-signed URLs — returns `503`
- File metadata in PostgreSQL is unaffected
- No data corruption (files not marked as uploaded until MinIO write succeeds)

**Retry**: Upload sessions persist in PostgreSQL/Redis. Once MinIO recovers, clients can resume.

---

### 5. Notification Service Failure

**Scenario**: Notification container crashes.

**Impact**: Real-time push notifications stop. File operations continue normally.

**Handling**:
- API events are published to Redis Pub/Sub regardless of notification service state
- When notification service restarts, it re-subscribes to Redis channels
- Clients reconnect via Socket.IO automatic reconnection
- Missed notifications: clients can poll `GET /api/notifications` for recent events

This is **graceful degradation** — core functionality is unaffected.

---

### 6. Interrupted Upload

**Scenario**: Client loses internet connection mid-upload.

**Detection**: Client connection drops; no `POST /uploads/:id/complete` received.

**Recovery**:
```
Client reconnects
   │
GET /api/uploads/:uploadId/status
   │
{ uploadedChunks: [0, 1, 2], totalChunks: 10 }
   │
Client re-uploads chunks 3–9 only
   │
POST /api/uploads/:uploadId/complete
```

Upload session expires after 24 hours of inactivity. Incomplete uploads are garbage-collected.

---

### 7. Duplicate Chunk Upload

**Scenario**: Chunk successfully stored but client doesn't receive the ACK. Client re-sends.

**Handling**:
- Server computes SHA-256 of received chunk
- Checks against stored chunk hash for that upload + index
- If hash matches: idempotent — returns success without re-storing
- If hash mismatch: returns `409 Conflict`

---

### 8. Conflict Detection (Phase 9)

**Scenario**: Two clients edit the same file simultaneously.

```
Client A: has version 5
Client B: has version 5

A updates → version 6
B sends update based on version 5

Server: currentVersion=6, clientVersion=5 → CONFLICT
Returns: 409 { "error": "version_conflict", "currentVersion": 6 }
```

B must:
1. Download version 6
2. Apply local changes on top
3. Re-submit

---

### 9. Nginx / Load Balancer Failure

**Scenario**: Nginx container crashes.

**Impact**: All external traffic drops (single point of failure in local dev).

**Production remedy**: Replace single Nginx with:
- AWS Application Load Balancer (managed, multi-AZ)
- Or multiple Nginx instances behind DNS round-robin

---

## Health Check Summary

| Service | Health Check Command | Checked By |
|---|---|---|
| PostgreSQL | `pg_isready` | Docker + API `/health` |
| Redis | `redis-cli ping` | Docker + API `/health` |
| MinIO | `curl /minio/health/live` | Docker + API `/health` |
| API | `GET /health` | Nginx (future) |
| Notification | `GET /health` | Docker |
