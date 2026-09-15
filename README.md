# 🗄️ CloudVault

**A Scalable Cloud File Storage & Synchronization System**

Inspired by the Google Drive system-design case study from Alex Xu's *System Design Interview* book.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, JavaScript |
| **API** | Node.js 20, Express, REST, JWT |
| **Database** | PostgreSQL 16, Prisma ORM |
| **Cache** | Redis 7 |
| **Object Storage** | MinIO (S3-compatible) |
| **Reverse Proxy** | Nginx 1.25 |
| **Real-time** | Socket.IO |
| **Containers** | Docker, Docker Compose |

---

## Architecture

```
Browser
   │
Nginx :80           ← Reverse Proxy / Load Balancer
   │
┌──┴───────────────┐
│                  │
API :8000     Notification :8001
(Express)     (Express + Socket.IO)
│
┌────┬────┐
│    │    │
PG Redis MinIO
```

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 24
- Docker Compose ≥ 2

### 1. Clone / navigate to project

```bash
cd "Google Drive"
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### 3. Start everything

```bash
docker compose up --build
```

### 4. Verify

| URL | Description |
|---|---|
| http://localhost | Frontend (CloudVault UI) |
| http://localhost/api/health | API health check |
| http://localhost:8001/health | Notification service health |
| http://localhost:9001 | MinIO Console (cloudvault / cloudvault_secret_123) |

### 5. Stop

```bash
docker compose down
# To also remove volumes:
docker compose down -v
```

---

## Scale API servers

```bash
# Phase 10 — demonstrate horizontal scaling
docker compose up --scale api=3
```

---

## Project Structure

```
├── frontend/                  # React + Vite
│   ├── src/
│   └── Dockerfile
├── services/
│   ├── api/                   # Express API (Auth, Files, Folders, Sharing)
│   │   ├── src/
│   │   ├── prisma/
│   │   └── Dockerfile
│   └── notification/          # Socket.IO real-time service
│       ├── src/
│       └── Dockerfile
├── nginx/nginx.conf           # Reverse proxy config
├── docker-compose.yaml
├── .env.example
└── docs/
```

---

## Build Phases

| Phase | Feature | Status |
|---|---|---|
| 0 | Foundation — all containers running | ✅ |
| 1 | Authentication (JWT) | 🔜 |
| 2 | File & Folder Management | 🔜 |
| 3 | File Sharing & Permissions | 🔜 |
| 4 | File Versioning | 🔜 |
| 5 | Chunked & Resumable Upload | 🔜 |
| 6 | Block Hashing & Deduplication | 🔜 |
| 7 | Redis Caching | 🔜 |
| 8 | Real-time Notifications | 🔜 |
| 9 | Sync & Conflict Detection | 🔜 |
| 10 | Horizontal Scaling Demo | 🔜 |

---

## Documentation

| Doc | Description |
|---|---|
| [Requirements](docs/requirements.md) | Functional & non-functional |
| [Architecture](docs/architecture.md) | System design |
| [Capacity Estimation](docs/capacity-estimation.md) | 1M user calculations |
| [Database Design](docs/database-design.md) | Schema & ER |
| [API Design](docs/api-design.md) | REST endpoint reference |
| [Upload Flow](docs/upload-flow.md) | Chunked upload sequence |
| [Download Flow](docs/download-flow.md) | Download sequence |
| [Scalability](docs/scalability.md) | Scaling analysis |
| [Failure Handling](docs/failure-handling.md) | Fault tolerance |

---

## License

MIT
