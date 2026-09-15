# Architecture

## High-Level Overview

```
┌────────────────────────────────────────────────────────────┐
│                         Client                             │
│                    (React SPA / Mobile)                    │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTPS / WSS
                        ▼
┌────────────────────────────────────────────────────────────┐
│                    Nginx (Reverse Proxy)                    │
│         /api/*  →  API Service                             │
│         /ws/*   →  Notification Service                    │
│         /*      →  Frontend                                │
└──────────┬──────────────────────────────┬──────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────┐            ┌─────────────────────┐
│   API Service    │            │ Notification Service │
│  (Auth · Files   │◄──Redis────│   (WebSocket / SSE) │
│  Folders · Share)│  Pub/Sub   │                     │
└─────┬──────┬─────┘            └─────────────────────┘
      │      │
      │      │ File bytes (presigned URLs / streaming)
      │      ▼
      │  ┌────────────────┐
      │  │ Object Storage │
      │  │ (S3 / MinIO)   │
      │  └────────────────┘
      │
      ▼
┌─────────────┐        ┌─────────────┐
│  PostgreSQL │        │    Redis    │
│  (metadata) │        │(cache/queue)│
└─────────────┘        └─────────────┘
```

---

## Components

### Frontend (React)
- Single-page application served via Nginx
- Communicates with API over REST
- Maintains WebSocket connection to Notification Service for live updates

### API Service
Handles all business logic split into modules:

| Module | Responsibility |
|---|---|
| **Auth** | Registration, login, JWT issue/refresh, OAuth |
| **Files** | Upload (chunked), download, delete, version history |
| **Folders** | CRUD, hierarchy traversal |
| **Sharing** | Permission management, link generation |

### Notification Service
- Persistent WebSocket connections per user
- Subscribes to Redis Pub/Sub channels
- Pushes events to connected clients in real time

### Object Storage
- Binary file storage (S3-compatible)
- API generates short-lived pre-signed URLs for direct client upload/download
- Reduces load on API service

### PostgreSQL
- Stores all structured metadata (users, files, folders, permissions)
- Read replicas for scaling read-heavy workloads

### Redis
- Session/JWT cache
- Pub/Sub broker between API and Notification services
- Rate-limiting counters

### Nginx
- TLS termination
- Reverse proxy routing to each service
- Static file caching headers

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Pre-signed URLs for file transfer | Offload bandwidth from API; leverage CDN edge caching |
| Redis Pub/Sub for notifications | Decouples API from notification delivery; low latency |
| JWT + Refresh tokens | Stateless auth; refresh tokens stored in Redis for revocation |
| Chunked uploads | Support large files reliably with resume capability |
| Soft deletes (trash) | Recoverable delete; permanent purge after 30 days |
