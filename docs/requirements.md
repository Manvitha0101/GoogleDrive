# Requirements

## Functional Requirements

### Authentication
- [ ] User registration (email + password)
- [ ] User login / logout
- [ ] OAuth 2.0 (Google sign-in)
- [ ] Password reset via email
- [ ] JWT-based session management

### File Management
- [ ] Upload files (single & multi-part for large files)
- [ ] Download files
- [ ] Delete files (move to trash / permanent delete)
- [ ] Preview files (images, PDFs, docs)
- [ ] Search files by name, type, and content
- [ ] Version history for files

### Folder Management
- [ ] Create, rename, and delete folders
- [ ] Move files and folders (drag-and-drop)
- [ ] Nested folder support
- [ ] "My Drive" root folder per user

### Sharing & Collaboration
- [ ] Share files/folders via link (view / edit / comment permissions)
- [ ] Share with specific users by email
- [ ] Revoke access
- [ ] "Shared with me" view

### Real-time Notifications
- [ ] Notify on file share
- [ ] Notify on comment added
- [ ] Notify on file upload completion
- [ ] Mark notifications as read

---

## Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.9% uptime (≤ 8.7 h downtime/year) |
| **Durability** | Files replicated across ≥ 3 availability zones |
| **Latency** | API p95 < 200 ms; file upload start < 500 ms |
| **Scalability** | Horizontal scaling of API and notification services |
| **Security** | Encrypted at rest (AES-256) and in transit (TLS 1.3) |
| **Consistency** | Eventual consistency acceptable for notifications; strong for file metadata |
| **Compliance** | GDPR-ready (data deletion, export) |
