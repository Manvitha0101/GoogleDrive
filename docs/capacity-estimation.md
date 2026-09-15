# Capacity Estimation

## Assumptions

| Parameter | Value |
|---|---|
| Total users | 50 million |
| Daily active users (DAU) | 10 million (20%) |
| Avg files per user | 200 |
| Avg file size | 500 KB |
| Uploads per DAU per day | 2 |
| Downloads per DAU per day | 5 |

---

## Storage

### Total file storage

```
50M users × 200 files × 500 KB = 5,000 TB (≈ 5 PB)
```

### Metadata storage (PostgreSQL)

Each file record ≈ 1 KB (name, size, type, owner, timestamps, permissions)

```
50M users × 200 files × 1 KB = 10 TB
```

### Growth rate

```
10M DAU × 2 uploads/day × 500 KB = 10 TB/day
```

---

## Bandwidth

### Upload throughput

```
10M DAU × 2 uploads × 500 KB = 10 TB/day
= 10 TB / 86,400 s ≈ 116 MB/s
```

### Download throughput

```
10M DAU × 5 downloads × 500 KB = 25 TB/day
= 25 TB / 86,400 s ≈ 289 MB/s
```

---

## Request Rate

| Operation | Requests/day | Requests/sec (avg) |
|---|---|---|
| File metadata reads | 100M | ~1,160 |
| File uploads | 20M | ~231 |
| File downloads | 50M | ~579 |
| Folder listing | 50M | ~579 |
| Auth (login/refresh) | 20M | ~231 |

---

## Infrastructure Estimates

| Component | Sizing |
|---|---|
| API servers | 10–20 pods (auto-scaled) |
| Notification servers | 5–10 pods |
| PostgreSQL | Primary + 2 read replicas, 10 TB SSD |
| Redis | 3-node cluster, 64 GB RAM |
| Object storage | 5+ PB (S3-compatible), multi-AZ |
| CDN | Edge caching for public/shared files |
