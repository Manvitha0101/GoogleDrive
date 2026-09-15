# Scalability Analysis

## Design Principles

CloudVault is designed for horizontal scalability from the start.

| Component | Strategy |
|---|---|
| API servers | **Stateless** — can add N instances behind Nginx |
| PostgreSQL | Vertical scale + read replicas |
| Redis | Cluster mode / managed (ElastiCache) |
| MinIO | Distributed mode / replaced by AWS S3 |
| Notification | Stateful (Socket.IO) — needs Redis adapter for multi-instance |

---

## Why Stateless API Servers?

Each request carries a **JWT** containing the user identity.
No session state is stored on the API server.

Result:

```
Request → Nginx (round-robin) → any API instance
```

When instance 1 fails, Nginx routes to instance 2. No data is lost.

---

## Horizontal Scaling Demo (Phase 10)

```bash
docker compose up --scale api=3
```

Nginx upstream config (nginx.conf):

```nginx
upstream api_upstream {
    server api_1:8000;
    server api_2:8000;
    server api_3:8000;
    keepalive 32;
}
```

All 3 instances share:
- The same PostgreSQL
- The same Redis
- The same MinIO

---

## Vertical vs. Horizontal Scaling

| | Vertical Scaling | Horizontal Scaling |
|---|---|---|
| **What** | Bigger machine | More machines |
| **Limit** | Physical CPU/RAM cap | Effectively unlimited |
| **Downtime** | Usually requires restart | Zero (rolling deploy) |
| **Cost** | Exponential | Linear |
| **CloudVault approach** | DB, Redis (initially) | API servers, Notification |

---

## Database Scaling

### Read Replicas

Read-heavy operations (file listing, metadata lookup) → read replica

Write operations (upload, rename, share) → primary

### Connection Pooling

Use PgBouncer or Prisma's built-in pooling to avoid exhausting DB connections.

At scale:
- 100 API pod replicas × 10 DB connections each = 1,000 connections
- PgBouncer pools these to ~50 actual PostgreSQL connections

---

## Object Storage Scaling

MinIO → AWS S3 migration:

1. Change `MINIO_ENDPOINT` to S3 endpoint
2. Change `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` to IAM credentials
3. No application code changes (S3-compatible API)

S3 automatically scales to petabytes and millions of concurrent requests.

---

## Notification Service Scaling

Socket.IO is stateful per connection.
For multi-instance notification service, use **Redis Pub/Sub adapter**:

```
API event → Redis PUBLISH → All Notification instances → WebSocket
```

Each Socket.IO instance subscribes to Redis channels and fans out to its connected clients.

---

## Bottlenecks at Scale

| Bottleneck | Solution |
|---|---|
| PostgreSQL write throughput | Read replicas + write batching |
| Redis memory | Eviction policy + cluster sharding |
| Nginx single point | Replace with AWS ALB / GCP LB |
| Large file upload bandwidth | Pre-signed direct-to-S3 uploads |
| JWT validation cost | RS256 (asymmetric) — verify without DB |

---

## Target Throughput

See [capacity-estimation.md](capacity-estimation.md) for full calculations.

Summary at 1M users / 200K DAU:

| Metric | Value |
|---|---|
| Upload QPS (average) | ~5 |
| Upload QPS (peak) | ~10 |
| API RPS (all endpoints) | ~500–2,000 |
| Recommended API pods | 4–8 (with HPA in K8s) |
