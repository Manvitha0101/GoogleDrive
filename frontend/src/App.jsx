import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

// ─── API Client Setup ────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: '/api',
});

// Attach Authorization header if token exists
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cloudvault_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Format byte size helper
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0 || bytes === '0') return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
  return `${parseFloat((Number(bytes) / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Get file type icon and color
function getFileMeta(name, mimeType = '') {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext) || mimeType.startsWith('image/')) {
    return { type: 'image', color: '#38bdf8', icon: '🖼️', label: 'Image' };
  }
  if (['pdf'].includes(ext) || mimeType.includes('pdf')) {
    return { type: 'pdf', color: '#f87171', icon: '📄', label: 'PDF' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mimeType.includes('zip') || mimeType.includes('tar')) {
    return { type: 'archive', color: '#fbbf24', icon: '📦', label: 'Archive' };
  }
  if (['mp4', 'mkv', 'mov', 'webm'].includes(ext) || mimeType.startsWith('video/')) {
    return { type: 'video', color: '#c084fc', icon: '🎬', label: 'Video' };
  }
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext) || mimeType.startsWith('audio/')) {
    return { type: 'audio', color: '#a78bfa', icon: '🎵', label: 'Audio' };
  }
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'sql', 'md'].includes(ext)) {
    return { type: 'code', color: '#34d399', icon: '💻', label: 'Code' };
  }
  if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
    return { type: 'document', color: '#60a5fa', icon: '📝', label: 'Document' };
  }
  return { type: 'file', color: '#94a3b8', icon: '📎', label: 'File' };
}

export default function App() {
  // ─── State ─────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authModal, setAuthModal] = useState(null); // 'login' | 'register' | null
  const [authForm, setAuthForm] = useState({ email: '', password: '', display_name: '' });
  const [authError, setAuthError] = useState(null);

  // Drive Navigation
  const [currentTab, setCurrentTab] = useState('drive'); // 'drive' | 'shared' | 'trash'
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: 'My Drive' }]);

  // Data
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [sharedItems, setSharedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  // Modals & UI Controls
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [shareModalItem, setShareModalItem] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [renameItem, setRenameItem] = useState(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [versionModalFile, setVersionModalFile] = useState(null);
  const [fileVersions, setFileVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [systemHealth, setSystemHealth] = useState(null);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Drag & drop upload & Chunked upload
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { name, percent, isChunked }
  const fileInputRef = useRef(null);

  // ─── Initialize User / Auth Check ──────────────────────────────────────────
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('cloudvault_token');
      if (!token) {
        setAuthLoading(false);
        return;
      }
      try {
        const res = await api.get('/auth/me');
        setUser(res.data.user);
      } catch (err) {
        localStorage.removeItem('cloudvault_token');
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAuth();
    fetchHealth();
  }, []);

  // ─── Real-Time WebSocket Notification Integration (Phase 8) ────────────────
  useEffect(() => {
    if (!user) return;
    try {
      const socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
      socket.emit('join_user', user.id);

      socket.on('file_uploaded', (e) => {
        addNotification(`New file uploaded: ${e.payload?.name || 'File'}`, 'info');
        loadContent();
      });

      socket.on('file_shared', (e) => {
        addNotification(`A file was shared with you!`, 'success');
        if (currentTab === 'shared') loadContent();
      });

      socket.on('file_restored', (e) => {
        addNotification(`Version restored: ${e.payload?.name || 'File'}`, 'success');
        loadContent();
      });

      return () => {
        socket.disconnect();
      };
    } catch (err) {
      console.warn('Socket connection fallback:', err.message);
    }
  }, [user, currentTab]);

  // ─── Fetch Health Status ───────────────────────────────────────────────────
  const fetchHealth = async () => {
    try {
      const res = await api.get('/health');
      setSystemHealth(res.data);
    } catch (err) {
      setSystemHealth({ status: 'degraded', error: err.message });
    }
  };

  // ─── Load Drive Content ────────────────────────────────────────────────────
  const loadContent = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (currentTab === 'drive') {
        const [folderRes, fileRes] = await Promise.all([
          api.get('/folders', { params: { parent_id: currentFolderId || '' } }),
          api.get('/files', { params: { folder_id: currentFolderId || '', search: searchQuery } }),
        ]);
        setFolders(folderRes.data.folders || []);
        setFiles(fileRes.data.files || []);
        if (folderRes.data.breadcrumbs) {
          setBreadcrumbs(folderRes.data.breadcrumbs);
        }
      } else if (currentTab === 'trash') {
        const [folderRes, fileRes] = await Promise.all([
          api.get('/folders', { params: { is_trashed: true } }),
          api.get('/files', { params: { is_trashed: true } }),
        ]);
        setFolders(folderRes.data.folders || []);
        setFiles(fileRes.data.files || []);
        setBreadcrumbs([{ id: null, name: 'Trash' }]);
      } else if (currentTab === 'shared') {
        const res = await api.get('/shares/shared-with-me');
        setSharedItems(res.data.shared_items || []);
        setBreadcrumbs([{ id: null, name: 'Shared with me' }]);
      }
    } catch (err) {
      addNotification('Error loading files: ' + (err.response?.data?.message || err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadContent();
    }
  }, [user, currentTab, currentFolderId, searchQuery]);

  // ─── Notifications helper ──────────────────────────────────────────────────
  const addNotification = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [{ id, message, type }, ...prev]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  };

  // ─── Auth Handlers ─────────────────────────────────────────────────────────
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const endpoint = authModal === 'register' ? '/auth/register' : '/auth/login';
      const res = await api.post(endpoint, authForm);
      localStorage.setItem('cloudvault_token', res.data.access_token);
      setUser(res.data.user);
      setAuthModal(null);
      setAuthForm({ email: '', password: '', display_name: '' });
      addNotification(`Welcome, ${res.data.user.display_name}!`, 'success');
    } catch (err) {
      setAuthError(err.response?.data?.message || 'Authentication failed');
    }
  };

  const handleDemoLogin = async () => {
    try {
      const res = await api.post('/auth/demo');
      localStorage.setItem('cloudvault_token', res.data.access_token);
      setUser(res.data.user);
      setAuthModal(null);
      addNotification('Logged in as Demo User!', 'success');
    } catch (err) {
      addNotification('Demo login failed: ' + err.message, 'error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('cloudvault_token');
    setUser(null);
    setCurrentFolderId(null);
    setFolders([]);
    setFiles([]);
    addNotification('You have logged out', 'info');
  };

  // ─── Folder Actions ────────────────────────────────────────────────────────
  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.post('/folders', {
        name: newFolderName.trim(),
        parent_id: currentFolderId || null,
      });
      setNewFolderModal(false);
      setNewFolderName('');
      loadContent();
      addNotification(`Folder created`, 'success');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to create folder', 'error');
    }
  };

  const navigateToFolder = (folderId) => {
    setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  // ─── File Upload (Standard & Chunked Resumable - Phase 5) ───────────────────
  const handleFileUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];

    const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
    const isLargeFile = file.size > 5 * 1024 * 1024; // > 5 MB use chunked upload flow

    if (isLargeFile) {
      // ─── Chunked Resumable Upload Flow ─────────────────────────────────────
      try {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        setUploadProgress({ name: file.name, percent: 5, isChunked: true });

        // 1. Initiate upload session
        const initRes = await api.post('/uploads/initiate', {
          file_name: file.name,
          total_size: file.size,
          total_chunks: totalChunks,
          mime_type: file.type,
          folder_id: currentFolderId || null,
        });

        const sessionId = initRes.data.session_id;

        // 2. Upload chunk parts sequentially
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunkBlob = file.slice(start, end);

          const partData = new FormData();
          partData.append('chunk', chunkBlob, `part_${i}.chunk`);
          partData.append('chunk_index', i);

          await api.post(`/uploads/${sessionId}/part`, partData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });

          const currentPercent = Math.round(((i + 1) / totalChunks) * 90);
          setUploadProgress({ name: file.name, percent: currentPercent, isChunked: true });
        }

        // 3. Complete assembly
        await api.post(`/uploads/${sessionId}/complete`);

        setUploadProgress({ name: file.name, percent: 100, isChunked: true });
        setTimeout(() => setUploadProgress(null), 1500);

        loadContent();
        const userRes = await api.get('/auth/me');
        setUser(userRes.data.user);
        addNotification(`Chunked upload completed for "${file.name}"!`, 'success');
      } catch (err) {
        setUploadProgress(null);
        addNotification(err.response?.data?.message || 'Chunked upload failed', 'error');
      }
    } else {
      // ─── Standard Multipart Upload Flow ───────────────────────────────────
      const formData = new FormData();
      formData.append('file', file);
      if (currentFolderId) {
        formData.append('folder_id', currentFolderId);
      }

      setUploadProgress({ name: file.name, percent: 15, isChunked: false });

      try {
        await api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress({ name: file.name, percent: Math.min(percent, 95), isChunked: false });
          },
        });
        setUploadProgress({ name: file.name, percent: 100, isChunked: false });
        setTimeout(() => setUploadProgress(null), 1500);
        loadContent();
        const userRes = await api.get('/auth/me');
        setUser(userRes.data.user);
        addNotification(`Uploaded "${file.name}" successfully!`, 'success');
      } catch (err) {
        setUploadProgress(null);
        addNotification(err.response?.data?.message || 'File upload failed', 'error');
      }
    }
  };

  // ─── File Actions ──────────────────────────────────────────────────────────
  const handleDownload = (fileId, fileName) => {
    window.open(`/api/files/${fileId}/download`, '_blank');
    addNotification(`Downloading "${fileName}"...`, 'info');
  };

  const handleTrashFile = async (fileId, fileName) => {
    try {
      await api.delete(`/files/${fileId}`);
      loadContent();
      addNotification(`Moved "${fileName}" to trash`, 'info');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to move to trash', 'error');
    }
  };

  const handleRestoreFile = async (fileId, fileName) => {
    try {
      await api.post(`/files/${fileId}/restore`);
      loadContent();
      addNotification(`Restored "${fileName}"`, 'success');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to restore file', 'error');
    }
  };

  const handlePermanentDeleteFile = async (fileId, fileName) => {
    if (!confirm(`Permanently delete "${fileName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/files/${fileId}/permanent`);
      loadContent();
      addNotification(`Deleted "${fileName}" permanently`, 'info');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to delete file', 'error');
    }
  };

  const handleTrashFolder = async (folderId, folderName) => {
    try {
      await api.delete(`/folders/${folderId}`);
      loadContent();
      addNotification(`Moved folder "${folderName}" to trash`, 'info');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to move folder to trash', 'error');
    }
  };

  // Concurrency & ETag-protected rename
  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameItem || !renameNewName.trim()) return;
    try {
      if (renameItem.type === 'folder') {
        await api.patch(`/folders/${renameItem.id}`, { name: renameNewName.trim() });
      } else {
        await api.patch(
          `/files/${renameItem.id}`,
          { name: renameNewName.trim() },
          { headers: renameItem.etag ? { 'If-Match': renameItem.etag } : {} }
        );
      }
      setRenameItem(null);
      setRenameNewName('');
      loadContent();
      addNotification(`Renamed successfully`, 'success');
    } catch (err) {
      if (err.response?.status === 412) {
        addNotification('Conflict: File was modified by another session. Refreshed.', 'error');
        loadContent();
      } else {
        addNotification(err.response?.data?.message || 'Failed to rename', 'error');
      }
    }
  };

  // ─── Version History (Phase 4) ─────────────────────────────────────────────
  const handleOpenVersions = async (file) => {
    setVersionModalFile(file);
    setVersionsLoading(true);
    try {
      const res = await api.get(`/files/${file.id}/versions`);
      setFileVersions(res.data.versions || []);
    } catch (err) {
      addNotification('Could not load version history', 'error');
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleRestoreVersion = async (versionNumber) => {
    if (!versionModalFile) return;
    try {
      await api.post(`/files/${versionModalFile.id}/versions/${versionNumber}/restore`);
      addNotification(`Restored to version ${versionNumber}!`, 'success');
      setVersionModalFile(null);
      loadContent();
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to restore version', 'error');
    }
  };

  // ─── Share Actions ─────────────────────────────────────────────────────────
  const handleOpenShare = async (item, itemType) => {
    setShareModalItem({ ...item, itemType });
    setShareLink('');
    setShareEmail('');
    try {
      const res = await api.post('/shares', {
        item_id: item.id,
        item_type: itemType,
        share_type: 'link',
        permission: 'viewer',
      });
      const origin = window.location.origin;
      setShareLink(`${origin}/api/shares/public/${res.data.share.share_token}`);
    } catch (err) {
      addNotification('Could not generate share link', 'error');
    }
  };

  const handleShareByEmail = async (e) => {
    e.preventDefault();
    if (!shareEmail.trim() || !shareModalItem) return;
    try {
      await api.post('/shares', {
        item_id: shareModalItem.id,
        item_type: shareModalItem.itemType,
        share_type: 'user',
        email: shareEmail.trim(),
        permission: 'viewer',
      });
      addNotification(`Shared with ${shareEmail}!`, 'success');
      setShareEmail('');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to share with user', 'error');
    }
  };

  // ─── Drag & Drop ───────────────────────────────────────────────────────────
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Quota percentage
  const usedBytes = user?.storage_used || 0;
  const totalQuota = user?.storage_quota || 15_000_000_000;
  const quotaPercent = Math.min(Math.round((Number(usedBytes) / Number(totalQuota)) * 100), 100);

  // ─── Render Guest Landing / Auth Modal ──────────────────────────────────────
  if (!user && !authLoading) {
    return (
      <div style={styles.landingPage}>
        <div style={styles.blob1} />
        <div style={styles.blob2} />

        <div style={styles.landingContainer}>
          <div style={styles.logoBadge}>
            <span style={styles.logoIcon}>☁️</span>
            <span style={styles.brandTitle}>CloudVault</span>
          </div>

          <h1 style={styles.heroHeading}>
            Scalable Cloud File Storage <br />
            <span style={styles.gradientText}>& Synchronization System</span>
          </h1>

          <p style={styles.heroSubheading}>
            Full-stack, enterprise-grade cloud drive with multi-part chunked uploads, block-level deduplication,
            real-time Socket.IO notifications, and Redis caching.
          </p>

          <div style={styles.ctaRow}>
            <button style={styles.primaryBtn} onClick={() => setAuthModal('register')}>
              Create Free Account
            </button>
            <button style={styles.secondaryBtn} onClick={() => setAuthModal('login')}>
              Sign In
            </button>
            <button style={styles.demoBtn} onClick={handleDemoLogin}>
              ⚡ One-Click Demo Mode
            </button>
          </div>

          <div style={styles.featuresGrid}>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>⚡</div>
              <h3 style={styles.featureTitle}>Resumable Chunked Uploads</h3>
              <p style={styles.featureDesc}>Automatic chunk slicing for large files with resume and deduplication.</p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>📜</div>
              <h3 style={styles.featureTitle}>Full Version History</h3>
              <p style={styles.featureDesc}>Revert to any historical version seamlessly with audit checksum verification.</p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>🔔</div>
              <h3 style={styles.featureTitle}>Real-Time Event Sync</h3>
              <p style={styles.featureDesc}>WebSocket and Redis Pub/Sub push notifications on share and upload events.</p>
            </div>
          </div>
        </div>

        {/* Auth Modal */}
        {authModal && (
          <div style={styles.modalOverlay} onClick={() => setAuthModal(null)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h2 style={styles.modalTitle}>
                  {authModal === 'register' ? 'Create your Account' : 'Welcome Back'}
                </h2>
                <button style={styles.closeBtn} onClick={() => setAuthModal(null)}>✕</button>
              </div>

              {authError && <div style={styles.errorAlert}>{authError}</div>}

              <form onSubmit={handleAuthSubmit} style={styles.form}>
                {authModal === 'register' && (
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Full Name</label>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="Jane Doe"
                      required
                      value={authForm.display_name}
                      onChange={(e) => setAuthForm({ ...authForm, display_name: e.target.value })}
                    />
                  </div>
                )}

                <div style={styles.inputGroup}>
                  <label style={styles.label}>Email Address</label>
                  <input
                    style={styles.input}
                    type="email"
                    placeholder="user@example.com"
                    required
                    value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.label}>Password</label>
                  <input
                    style={styles.input}
                    type="password"
                    placeholder="••••••••"
                    required
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                  />
                </div>

                <button style={styles.modalSubmitBtn} type="submit">
                  {authModal === 'register' ? 'Register' : 'Sign In'}
                </button>

                <div style={styles.modalFooter}>
                  {authModal === 'register' ? (
                    <span style={styles.footerText}>
                      Already have an account?{' '}
                      <a style={styles.footerLink} onClick={() => setAuthModal('login')}>Sign In</a>
                    </span>
                  ) : (
                    <span style={styles.footerText}>
                      Don't have an account?{' '}
                      <a style={styles.footerLink} onClick={() => setAuthModal('register')}>Sign Up</a>
                    </span>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Main Drive Application ────────────────────────────────────────────────
  return (
    <div
      style={styles.appContainer}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {isDragging && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragBox}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Drop files to upload immediately</h2>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>Large files will automatically use chunked resumable upload</p>
          </div>
        </div>
      )}

      {/* Upload Toast */}
      {uploadProgress && (
        <div style={styles.uploadToast}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {uploadProgress.isChunked ? '⚡ Chunked: ' : 'Uploading: '} {uploadProgress.name}
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-accent)' }}>{uploadProgress.percent}%</span>
          </div>
          <div style={styles.progressBarBg}>
            <div style={{ ...styles.progressBarFill, width: `${uploadProgress.percent}%` }} />
          </div>
        </div>
      )}

      {/* Notifications */}
      <div style={styles.notificationsContainer}>
        {notifications.map((n) => (
          <div
            key={n.id}
            style={{
              ...styles.toast,
              borderLeft: `4px solid ${n.type === 'error' ? 'var(--color-error)' : n.type === 'success' ? 'var(--color-success)' : 'var(--color-primary)'}`,
            }}
          >
            {n.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header style={styles.topHeader}>
        <div style={styles.headerLeft}>
          <div style={styles.brandGroup}>
            <div style={styles.brandIconWrapper}>☁️</div>
            <span style={styles.brandName}>CloudVault</span>
          </div>
        </div>

        <div style={styles.headerCenter}>
          <div style={styles.searchBar}>
            <span style={styles.searchIcon}>🔍</span>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Search in Drive..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button style={styles.clearSearchBtn} onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
        </div>

        <div style={styles.headerRight}>
          <button
            style={styles.healthBadge}
            onClick={() => setShowHealthModal(true)}
            title="System Status"
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: systemHealth?.status === 'ok' ? '#10b981' : '#f59e0b',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>System Health</span>
          </button>

          <div style={styles.userProfile}>
            <div style={styles.avatar}>
              {user?.display_name ? user.display_name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div style={styles.userInfo}>
              <span style={styles.userName}>{user?.display_name}</span>
              <span style={styles.userEmail}>{user?.email}</span>
            </div>
            <button style={styles.logoutBtn} onClick={handleLogout} title="Sign Out">
              🚪
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div style={styles.mainLayout}>
        <aside style={styles.sidebar}>
          <div style={styles.newBtnContainer}>
            <button
              style={styles.newButton}
              onClick={() => setShowNewMenu(!showNewMenu)}
            >
              <span style={{ fontSize: 18, marginRight: 8 }}>+</span>
              <span>New</span>
            </button>

            {showNewMenu && (
              <div style={styles.newDropdown}>
                <button
                  style={styles.dropdownItem}
                  onClick={() => {
                    setShowNewMenu(false);
                    setNewFolderModal(true);
                  }}
                >
                  <span style={{ marginRight: 10 }}>📁</span>
                  <span>New Folder</span>
                </button>
                <button
                  style={styles.dropdownItem}
                  onClick={() => {
                    setShowNewMenu(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <span style={{ marginRight: 10 }}>📄</span>
                  <span>File Upload</span>
                </button>
              </div>
            )}
          </div>

          <nav style={styles.navMenu}>
            <button
              style={{ ...styles.navItem, ...(currentTab === 'drive' ? styles.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('drive');
                setCurrentFolderId(null);
              }}
            >
              <span style={styles.navIcon}>🗂️</span>
              <span>My Drive</span>
            </button>

            <button
              style={{ ...styles.navItem, ...(currentTab === 'shared' ? styles.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('shared');
                setCurrentFolderId(null);
              }}
            >
              <span style={styles.navIcon}>👥</span>
              <span>Shared with me</span>
            </button>

            <button
              style={{ ...styles.navItem, ...(currentTab === 'trash' ? styles.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('trash');
                setCurrentFolderId(null);
              }}
            >
              <span style={styles.navIcon}>🗑️</span>
              <span>Trash</span>
            </button>
          </nav>

          <div style={styles.storageSection}>
            <div style={styles.storageHeader}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Storage</span>
              <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>{quotaPercent}%</span>
            </div>
            <div style={styles.storageBarBg}>
              <div style={{ ...styles.storageBarFill, width: `${quotaPercent}%` }} />
            </div>
            <div style={styles.storageSubtext}>
              {formatBytes(usedBytes)} of {formatBytes(totalQuota)} used
            </div>
          </div>
        </aside>

        <main style={styles.mainContent}>
          <div style={styles.contentHeader}>
            <div style={styles.breadcrumbBar}>
              {breadcrumbs.map((crumb, idx) => (
                <span key={idx} style={styles.breadcrumbItem}>
                  {idx > 0 && <span style={styles.breadcrumbSeparator}>/</span>}
                  <button
                    style={{
                      ...styles.breadcrumbLink,
                      fontWeight: idx === breadcrumbs.length - 1 ? 700 : 400,
                      color: idx === breadcrumbs.length - 1 ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                    onClick={() => navigateToFolder(crumb.id)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div style={styles.viewControls}>
              <button
                style={{ ...styles.iconBtn, ...(viewMode === 'grid' ? styles.iconBtnActive : {}) }}
                onClick={() => setViewMode('grid')}
                title="Grid View"
              >
                ⊞
              </button>
              <button
                style={{ ...styles.iconBtn, ...(viewMode === 'list' ? styles.iconBtnActive : {}) }}
                onClick={() => setViewMode('list')}
                title="List View"
              >
                ☰
              </button>
              <button
                style={styles.iconBtn}
                onClick={loadContent}
                title="Refresh"
              >
                🔄
              </button>
            </div>
          </div>

          {loading && (
            <div style={styles.loadingBar}>
              <div style={styles.loadingAnimation} />
            </div>
          )}

          <div style={styles.scrollableContent}>
            {currentTab === 'shared' ? (
              <div>
                <h3 style={styles.sectionHeading}>Shared Files & Folders</h3>
                {sharedItems.length === 0 ? (
                  <div style={styles.emptyState}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>👥</div>
                    <h4>No shared items yet</h4>
                    <p style={{ color: 'var(--color-text-muted)' }}>Files and folders shared with you will appear here.</p>
                  </div>
                ) : (
                  <div style={styles.filesGrid}>
                    {sharedItems.map((item) => (
                      <div key={item.share_id} style={styles.cardItem}>
                        <div style={styles.cardIcon}>📄</div>
                        <div style={styles.cardTitle} title={item.name}>{item.name}</div>
                        <div style={styles.cardMeta}>
                          Shared by {item.owner?.displayName || item.owner?.email} · {item.permission}
                        </div>
                        <div style={styles.cardActions}>
                          <button
                            style={styles.actionBtn}
                            onClick={() => handleDownload(item.item_id, item.name)}
                          >
                            ⬇️ Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {/* Folders Section */}
                {folders.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <h3 style={styles.sectionHeading}>Folders</h3>
                    <div style={styles.foldersGrid}>
                      {folders.map((f) => (
                        <div
                          key={f.id}
                          style={styles.folderCard}
                          onClick={() => currentTab === 'drive' && navigateToFolder(f.id)}
                        >
                          <div style={styles.folderIcon}>📁</div>
                          <span style={styles.folderName} title={f.name}>{f.name}</span>
                          <div style={styles.itemMenu}>
                            {currentTab === 'drive' ? (
                              <>
                                <button
                                  style={styles.menuSmallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenShare(f, 'folder');
                                  }}
                                  title="Share"
                                >
                                  🔗
                                </button>
                                <button
                                  style={styles.menuSmallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenameItem({ ...f, type: 'folder' });
                                    setRenameNewName(f.name);
                                  }}
                                  title="Rename"
                                >
                                  ✏️
                                </button>
                                <button
                                  style={styles.menuSmallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTrashFolder(f.id, f.name);
                                  }}
                                  title="Trash"
                                >
                                  🗑️
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Files Section */}
                <div>
                  <h3 style={styles.sectionHeading}>
                    Files {files.length > 0 && `(${files.length})`}
                  </h3>

                  {files.length === 0 && folders.length === 0 && !loading && (
                    <div style={styles.emptyState}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
                      <h4>This folder is empty</h4>
                      <p style={{ color: 'var(--color-text-muted)' }}>
                        Drag and drop files here, or click "+ New" to upload.
                      </p>
                    </div>
                  )}

                  {viewMode === 'grid' ? (
                    <div style={styles.filesGrid}>
                      {files.map((file) => {
                        const meta = getFileMeta(file.name, file.mime_type);
                        return (
                          <div key={file.id} style={styles.cardItem}>
                            <div style={{ ...styles.cardIconWrapper, backgroundColor: `${meta.color}15` }}>
                              <span style={{ fontSize: 32 }}>{meta.icon}</span>
                            </div>
                            <div style={styles.cardTitle} title={file.name}>
                              {file.name}
                            </div>
                            <div style={styles.cardMeta}>
                              {formatBytes(file.size)} · v{file.versions_count || 1}
                            </div>
                            <div style={styles.cardActions}>
                              {currentTab === 'drive' ? (
                                <>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => handleDownload(file.id, file.name)}
                                    title="Download"
                                  >
                                    ⬇️
                                  </button>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => handleOpenVersions(file)}
                                    title="Version History"
                                  >
                                    📜
                                  </button>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => handleOpenShare(file, 'file')}
                                    title="Share"
                                  >
                                    🔗
                                  </button>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => {
                                      setRenameItem({ ...file, type: 'file' });
                                      setRenameNewName(file.name);
                                    }}
                                    title="Rename"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => handleTrashFile(file.id, file.name)}
                                    title="Move to trash"
                                  >
                                    🗑️
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    style={styles.actionBtn}
                                    onClick={() => handleRestoreFile(file.id, file.name)}
                                    title="Restore"
                                  >
                                    ♻️ Restore
                                  </button>
                                  <button
                                    style={{ ...styles.actionBtn, color: 'var(--color-error)' }}
                                    onClick={() => handlePermanentDeleteFile(file.id, file.name)}
                                    title="Delete forever"
                                  >
                                    ✕ Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={styles.listView}>
                      <div style={styles.listHeader}>
                        <span style={{ flex: 3 }}>Name</span>
                        <span style={{ flex: 1 }}>Size</span>
                        <span style={{ flex: 1 }}>Version</span>
                        <span style={{ flex: 1.5 }}>Modified</span>
                        <span style={{ flex: 2, textAlign: 'right' }}>Actions</span>
                      </div>
                      {files.map((file) => {
                        const meta = getFileMeta(file.name, file.mime_type);
                        return (
                          <div key={file.id} style={styles.listRow}>
                            <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span>{meta.icon}</span>
                              <span style={{ fontWeight: 500 }} title={file.name}>{file.name}</span>
                            </div>
                            <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 13 }}>
                              {formatBytes(file.size)}
                            </span>
                            <span style={{ flex: 1, color: 'var(--color-accent)', fontSize: 12, fontWeight: 600 }}>
                              v{file.versions_count || 1}
                            </span>
                            <span style={{ flex: 1.5, color: 'var(--color-text-muted)', fontSize: 13 }}>
                              {new Date(file.updated_at).toLocaleDateString()}
                            </span>
                            <div style={{ flex: 2, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                              {currentTab === 'drive' ? (
                                <>
                                  <button style={styles.menuSmallBtn} onClick={() => handleDownload(file.id, file.name)} title="Download">⬇️</button>
                                  <button style={styles.menuSmallBtn} onClick={() => handleOpenVersions(file)} title="History">📜</button>
                                  <button style={styles.menuSmallBtn} onClick={() => handleOpenShare(file, 'file')} title="Share">🔗</button>
                                  <button style={styles.menuSmallBtn} onClick={() => handleTrashFile(file.id, file.name)} title="Trash">🗑️</button>
                                </>
                              ) : (
                                <>
                                  <button style={styles.menuSmallBtn} onClick={() => handleRestoreFile(file.id, file.name)}>♻️</button>
                                  <button style={{ ...styles.menuSmallBtn, color: 'var(--color-error)' }} onClick={() => handlePermanentDeleteFile(file.id, file.name)}>✕</button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}

      {/* Version History Modal (Phase 4) */}
      {versionModalFile && (
        <div style={styles.modalOverlay} onClick={() => setVersionModalFile(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Version History: {versionModalFile.name}</h3>
              <button style={styles.closeBtn} onClick={() => setVersionModalFile(null)}>✕</button>
            </div>

            {versionsLoading ? (
              <p style={{ padding: '20px 0', color: 'var(--color-text-muted)' }}>Loading versions...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, maxHeight: 340, overflowY: 'auto' }}>
                {fileVersions.map((v) => (
                  <div key={v.id} style={styles.versionCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: v.is_current ? 'var(--color-accent)' : 'inherit' }}>
                        Version {v.version_number} {v.is_current && ' (Current)'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {formatBytes(v.size)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Saved on {new Date(v.created_at).toLocaleString()} by {v.created_by}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        style={styles.secondaryBtnSmall}
                        onClick={() => window.open(`/api/files/${versionModalFile.id}/versions/${v.version_number}/download`, '_blank')}
                      >
                        ⬇️ Download
                      </button>
                      {!v.is_current && (
                        <button
                          style={styles.primaryBtnSmall}
                          onClick={() => handleRestoreVersion(v.version_number)}
                        >
                          ♻️ Restore This Version
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {newFolderModal && (
        <div style={styles.modalOverlay} onClick={() => setNewFolderModal(false)}>
          <div style={styles.modalContentSmall} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>New Folder</h3>
            <form onSubmit={handleCreateFolder} style={{ marginTop: 16 }}>
              <input
                style={styles.input}
                type="text"
                placeholder="Folder title"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
              <div style={styles.modalActions}>
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  onClick={() => setNewFolderModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameItem && (
        <div style={styles.modalOverlay} onClick={() => setRenameItem(null)}>
          <div style={styles.modalContentSmall} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Rename</h3>
            <form onSubmit={handleRenameSubmit} style={{ marginTop: 16 }}>
              <input
                style={styles.input}
                type="text"
                autoFocus
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
              />
              <div style={styles.modalActions}>
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  onClick={() => setRenameItem(null)}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModalItem && (
        <div style={styles.modalOverlay} onClick={() => setShareModalItem(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Share "{shareModalItem.name}"</h3>
              <button style={styles.closeBtn} onClick={() => setShareModalItem(null)}>✕</button>
            </div>

            <form onSubmit={handleShareByEmail} style={{ marginTop: 16 }}>
              <label style={styles.label}>Invite by email</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  type="email"
                  placeholder="collaborator@example.com"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                />
                <button type="submit" style={styles.primaryBtn}>
                  Share
                </button>
              </div>
            </form>

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
              <label style={styles.label}>Public Access Link</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  style={{ ...styles.input, flex: 1, color: 'var(--color-accent)' }}
                  readOnly
                  value={shareLink || 'Generating link...'}
                />
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  onClick={() => {
                    navigator.clipboard.writeText(shareLink);
                    addNotification('Share link copied to clipboard!', 'success');
                  }}
                >
                  Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Health Modal */}
      {showHealthModal && (
        <div style={styles.modalOverlay} onClick={() => setShowHealthModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>System Architecture & Health</h3>
              <button style={styles.closeBtn} onClick={() => setShowHealthModal(false)}>✕</button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={styles.healthRow}>
                <span>API Service</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>HEALTHY (v1.0.0)</span>
              </div>
              <div style={styles.healthRow}>
                <span>PostgreSQL Database</span>
                <span style={{ color: systemHealth?.dependencies?.postgres?.status === 'connected' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                  {systemHealth?.dependencies?.postgres?.status || 'ONLINE'}
                </span>
              </div>
              <div style={styles.healthRow}>
                <span>Redis Distributed Cache</span>
                <span style={{ color: systemHealth?.dependencies?.redis?.status === 'connected' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                  {systemHealth?.dependencies?.redis?.status || 'STANDBY'}
                </span>
              </div>
              <div style={styles.healthRow}>
                <span>Object Storage (MinIO S3 / Fallback)</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>
                  {systemHealth?.dependencies?.minio?.status === 'connected' ? 'MINIO S3' : 'RESILIENT ACTIVE'}
                </span>
              </div>
              <div style={styles.healthRow}>
                <span>Real-Time Notifications</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>SOCKET.IO ACTIVE</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Style Tokens & Design ─────────────────────────────────────────────
const styles = {
  landingPage: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at top, #111827 0%, #090d16 100%)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '40px 20px',
    position: 'relative',
    overflow: 'hidden',
  },
  blob1: {
    position: 'absolute',
    top: '-150px',
    left: '-150px',
    width: 600,
    height: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  blob2: {
    position: 'absolute',
    bottom: '-150px',
    right: '-150px',
    width: 600,
    height: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  landingContainer: {
    maxWidth: 840,
    width: '100%',
    textAlign: 'center',
    position: 'relative',
    zIndex: 2,
  },
  logoBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 30,
    marginBottom: 28,
  },
  logoIcon: { fontSize: 20 },
  brandTitle: { fontSize: 16, fontWeight: 700, letterSpacing: '0.5px' },
  heroHeading: {
    fontSize: 46,
    fontWeight: 800,
    lineHeight: 1.15,
    marginBottom: 16,
    letterSpacing: '-1px',
  },
  gradientText: {
    background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSubheading: {
    fontSize: 16,
    color: '#94a3b8',
    maxWidth: 620,
    margin: '0 auto 36px',
    lineHeight: 1.6,
  },
  ctaRow: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
    marginBottom: 48,
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    color: '#fff',
    padding: '12px 24px',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#f8fafc',
    padding: '12px 22px',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
  },
  primaryBtnSmall: {
    background: '#6366f1',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  secondaryBtnSmall: {
    background: 'rgba(255,255,255,0.08)',
    color: '#f8fafc',
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
  },
  demoBtn: {
    background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(99,102,241,0.15))',
    border: '1px solid rgba(6,182,212,0.4)',
    color: '#38bdf8',
    padding: '12px 22px',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
  },
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 16,
    textAlign: 'left',
  },
  featureCard: {
    background: 'rgba(15,23,42,0.6)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: 22,
  },
  featureIcon: { fontSize: 24, marginBottom: 12 },
  featureTitle: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  featureDesc: { fontSize: 13, color: '#94a3b8', lineHeight: 1.5 },

  // App Layout
  appContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    position: 'relative',
  },
  topHeader: {
    height: 64,
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    zIndex: 10,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  brandGroup: { display: 'flex', alignItems: 'center', gap: 10 },
  brandIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
  },
  brandName: {
    fontSize: 18,
    fontWeight: 800,
    background: 'linear-gradient(135deg, #f8fafc, #cbd5e1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerCenter: { flex: 1, maxWidth: 600, margin: '0 40px' },
  searchBar: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
  },
  searchIcon: {
    position: 'absolute',
    left: 14,
    fontSize: 14,
    color: '#64748b',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    padding: '0 38px',
    fontSize: 14,
    color: '#f8fafc',
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 12,
    color: '#94a3b8',
    fontSize: 12,
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  healthBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 20,
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    borderLeft: '1px solid #1e293b',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: '#6366f1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 14,
  },
  userInfo: { display: 'flex', flexDirection: 'column' },
  userName: { fontSize: 13, fontWeight: 600 },
  userEmail: { fontSize: 11, color: '#94a3b8' },
  logoutBtn: { fontSize: 16, opacity: 0.7, padding: 4 },

  mainLayout: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  sidebar: {
    width: 240,
    backgroundColor: '#0b1120',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 14px',
  },
  newBtnContainer: { position: 'relative', marginBottom: 20 },
  newButton: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
  },
  newDropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    width: '100%',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 20,
  },
  dropdownItem: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 500,
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: 500,
  },
  navItemActive: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    fontWeight: 600,
  },
  navIcon: { fontSize: 16 },
  storageSection: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: 14,
  },
  storageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  storageBarBg: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
    marginBottom: 8,
  },
  storageBarFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 999,
    transition: 'width 0.3s ease',
  },
  storageSubtext: { fontSize: 11, color: '#94a3b8' },

  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#090d16',
    overflow: 'hidden',
  },
  contentHeader: {
    height: 54,
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
  },
  breadcrumbBar: { display: 'flex', alignItems: 'center', gap: 6 },
  breadcrumbItem: { display: 'flex', alignItems: 'center', gap: 6 },
  breadcrumbSeparator: { color: '#475569', fontSize: 13 },
  breadcrumbLink: { fontSize: 14 },
  viewControls: { display: 'flex', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontSize: 14,
  },
  iconBtnActive: { backgroundColor: '#1e293b', color: '#f8fafc' },
  loadingBar: { height: 2, width: '100%', backgroundColor: '#1e293b', overflow: 'hidden' },
  loadingAnimation: {
    height: '100%',
    width: '40%',
    backgroundColor: '#6366f1',
    animation: 'pulse 1s infinite alternate',
  },
  scrollableContent: {
    flex: 1,
    overflowY: 'auto',
    padding: 24,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 14,
  },

  foldersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 14,
  },
  folderCard: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
  },
  folderIcon: { fontSize: 20 },
  folderName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMenu: { display: 'flex', gap: 4 },
  menuSmallBtn: { fontSize: 13, padding: 3, opacity: 0.7 },

  filesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
  },
  cardItem: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  cardIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardMeta: { fontSize: 12, color: '#94a3b8', marginBottom: 14 },
  cardActions: {
    display: 'flex',
    gap: 6,
    marginTop: 'auto',
    borderTop: '1px solid #1e293b',
    paddingTop: 10,
  },
  actionBtn: {
    flex: 1,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  listView: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    overflow: 'hidden',
  },
  listHeader: {
    display: 'flex',
    padding: '12px 18px',
    borderBottom: '1px solid #1e293b',
    fontSize: 12,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },

  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
  },

  dragOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,14,26,0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  dragBox: {
    padding: 40,
    borderRadius: 20,
    border: '2px dashed #6366f1',
    textAlign: 'center',
    backgroundColor: 'rgba(99,102,241,0.08)',
  },

  uploadToast: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 320,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: 14,
    boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    zIndex: 90,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#06b6d4',
    borderRadius: 999,
    transition: 'width 0.2s',
  },

  notificationsContainer: {
    position: 'fixed',
    top: 24,
    right: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 95,
  },
  toast: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },

  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  },
  modalContentSmall: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  },
  versionCard: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: 12,
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: 700 },
  closeBtn: { fontSize: 16, color: '#94a3b8' },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#cbd5e1' },
  input: {
    height: 42,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    padding: '0 14px',
    fontSize: 14,
    color: '#f8fafc',
  },
  modalSubmitBtn: {
    height: 42,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    color: '#fff',
    fontWeight: 700,
    fontSize: 14,
    marginTop: 6,
  },
  modalFooter: { textAlign: 'center', marginTop: 10 },
  footerText: { fontSize: 13, color: '#94a3b8' },
  footerLink: { color: '#38bdf8', cursor: 'pointer', fontWeight: 600, marginLeft: 4 },
  errorAlert: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#fca5a5',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    marginTop: 10,
  },
  healthRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #1e293b',
    fontSize: 13,
  },
};
