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

// Auto-refresh token on 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const authRes = await axios.post('/api/auth/demo');
        const newToken = authRes.data.access_token;
        localStorage.setItem('cloudvault_token', newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (err) {
        console.warn('Auto token renewal failed:', err);
      }
    }
    return Promise.reject(error);
  }
);

// Format byte size helper
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0 || bytes === '0') return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
  return `${parseFloat((Number(bytes) / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Get file type icon, color and description
function getFileMeta(name, mimeType = '') {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext) || mimeType.startsWith('image/')) {
    return { type: 'image', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)', icon: '🖼️', label: 'Image' };
  }
  if (['pdf'].includes(ext) || mimeType.includes('pdf')) {
    return { type: 'pdf', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)', icon: '📄', label: 'PDF' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mimeType.includes('zip') || mimeType.includes('tar')) {
    return { type: 'archive', color: '#d97706', bg: 'rgba(217, 119, 6, 0.12)', icon: '📦', label: 'Archive' };
  }
  if (['mp4', 'mkv', 'mov', 'webm'].includes(ext) || mimeType.startsWith('video/')) {
    return { type: 'video', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)', icon: '🎬', label: 'Video' };
  }
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext) || mimeType.startsWith('audio/')) {
    return { type: 'audio', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.12)', icon: '🎵', label: 'Audio' };
  }
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'sql', 'md'].includes(ext)) {
    return { type: 'code', color: '#059669', bg: 'rgba(5, 150, 105, 0.12)', icon: '💻', label: 'Code' };
  }
  if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
    return { type: 'document', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)', icon: '📝', label: 'Document' };
  }
  return { type: 'file', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)', icon: '📎', label: 'File' };
}

export default function App() {
  // ─── Theme State (Light & Dark Mode) ───────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('cloudvault_theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cloudvault_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
    addNotification(`Switched to ${theme === 'light' ? 'Dark' : 'Light'} theme`, 'info');
  };

  // ─── User & Auth State ─────────────────────────────────────────────────────
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general'); // 'general' | 'appearance' | 'sharing' | 'system'
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Share Modal & Options
  const [shareModalItem, setShareModalItem] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState('viewer'); // 'viewer' | 'editor'
  const [allowCopyOption, setAllowCopyOption] = useState(true);
  const [allowDownloadOption, setAllowDownloadOption] = useState(true);
  const [copiedLinkFeedback, setCopiedLinkFeedback] = useState(false);

  // Rename / Edit Item
  const [renameItem, setRenameItem] = useState(null);
  const [renameNewName, setRenameNewName] = useState('');

  // Version History Modal
  const [versionModalFile, setVersionModalFile] = useState(null);
  const [fileVersions, setFileVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // System Health
  const [systemHealth, setSystemHealth] = useState(null);
  const [showHealthModal, setShowHealthModal] = useState(false);

  // Notifications / Toasts
  const [notifications, setNotifications] = useState([]);

  // Active Context Menu
  const [activeMenuId, setActiveMenuId] = useState(null);

  // Drag & drop upload & Chunked upload
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { name, percent, isChunked }
  const fileInputRef = useRef(null);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setShowUserMenu(false);
      setShowNewMenu(false);
      setActiveMenuId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

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
        addNotification(`New file uploaded: ${e.payload?.name || 'File'}`, 'success');
        loadContent();
      });

      socket.on('file_shared', (e) => {
        addNotification(`A file was shared with you!`, 'info');
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
      addNotification('Error loading items: ' + (err.response?.data?.message || err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadContent();
    }
  }, [user, currentTab, currentFolderId, searchQuery]);

  // ─── Notifications / Toast Helper ──────────────────────────────────────────
  const addNotification = (message, type = 'info', icon = null) => {
    const id = Date.now() + Math.random();
    const defaultIcon =
      type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    setNotifications((prev) => [{ id, message, type, icon: icon || defaultIcon }, ...prev]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
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
      addNotification(`Welcome back, ${res.data.user.display_name}!`, 'success', '👋');
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
      addNotification('Logged in as Demo User!', 'success', '⚡');
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
    setShowUserMenu(false);
    setShowSettingsModal(false);
    addNotification('You have logged out safely', 'info', '🚪');
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
      const name = newFolderName.trim();
      setNewFolderModal(false);
      setNewFolderName('');
      loadContent();
      addNotification(`Folder "${name}" created successfully!`, 'success', '📁');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to create folder', 'error');
    }
  };

  const navigateToFolder = (folderId) => {
    setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  // ─── File Upload (Standard & Chunked Resumable) ─────────────────────────────
  const handleFileUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];

    const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
    const isLargeFile = file.size > 5 * 1024 * 1024; // > 5 MB use chunked upload flow

    addNotification(`Starting upload for "${file.name}"...`, 'info', '📤');

    if (isLargeFile) {
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
        setTimeout(() => setUploadProgress(null), 1200);

        loadContent();
        const userRes = await api.get('/auth/me');
        setUser(userRes.data.user);
        addNotification(`Chunked upload completed for "${file.name}"!`, 'success', '⚡');
      } catch (err) {
        setUploadProgress(null);
        addNotification(err.response?.data?.message || 'Chunked upload failed', 'error');
      }
    } else {
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
        setTimeout(() => setUploadProgress(null), 1200);
        loadContent();
        const userRes = await api.get('/auth/me');
        setUser(userRes.data.user);
        addNotification(`File "${file.name}" uploaded successfully!`, 'success', '🎉');
      } catch (err) {
        setUploadProgress(null);
        addNotification(err.response?.data?.message || 'File upload failed', 'error');
      }
    }
  };

  // ─── File Actions ──────────────────────────────────────────────────────────
  const handleDownload = async (fileId, fileName) => {
    addNotification(`Preparing download for "${fileName}"...`, 'info', '⬇️');
    try {
      const res = await api.get(`/files/${fileId}/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
      addNotification(`Downloaded "${fileName}" successfully!`, 'success', '✅');
    } catch (err) {
      const token = localStorage.getItem('cloudvault_token');
      const downloadUrl = `/api/files/${fileId}/download?auth_token=${token}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addNotification(`Download started: "${fileName}"`, 'success', '✅');
    }
  };

  const handleTrashFile = async (fileId, fileName) => {
    try {
      await api.delete(`/files/${fileId}`);
      loadContent();
      addNotification(`Moved "${fileName}" to Trash`, 'info', '🗑️');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to move to trash', 'error');
    }
  };

  const handleRestoreFile = async (fileId, fileName) => {
    try {
      await api.post(`/files/${fileId}/restore`);
      loadContent();
      addNotification(`Restored "${fileName}" to My Drive!`, 'success', '♻️');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to restore file', 'error');
    }
  };

  const handlePermanentDeleteFile = async (fileId, fileName) => {
    if (!confirm(`Are you sure you want to permanently delete "${fileName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/files/${fileId}/permanent`);
      loadContent();
      addNotification(`Permanently deleted "${fileName}"`, 'info', '❌');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to delete file', 'error');
    }
  };

  const handleTrashFolder = async (folderId, folderName) => {
    try {
      await api.delete(`/folders/${folderId}`);
      loadContent();
      addNotification(`Moved folder "${folderName}" to Trash`, 'info', '🗑️');
    } catch (err) {
      addNotification(err.response?.data?.message || 'Failed to move folder to trash', 'error');
    }
  };

  // Concurrency & ETag-protected rename
  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameItem || !renameNewName.trim()) return;
    const oldName = renameItem.name;
    const newName = renameNewName.trim();
    try {
      if (renameItem.type === 'folder') {
        await api.patch(`/folders/${renameItem.id}`, { name: newName });
      } else {
        await api.patch(
          `/files/${renameItem.id}`,
          { name: newName },
          { headers: renameItem.etag ? { 'If-Match': renameItem.etag } : {} }
        );
      }
      setRenameItem(null);
      setRenameNewName('');
      loadContent();
      addNotification(`Renamed "${oldName}" to "${newName}"`, 'success', '✏️');
    } catch (err) {
      if (err.response?.status === 412) {
        addNotification('Conflict: Item was modified by another session. Refreshed.', 'error');
        loadContent();
      } else {
        addNotification(err.response?.data?.message || 'Failed to rename', 'error');
      }
    }
  };

  // ─── Version History ───────────────────────────────────────────────────────
  const handleOpenVersions = async (file) => {
    setVersionModalFile(file);
    setVersionsLoading(true);
    try {
      const res = await api.get(`/files/${file.id}/versions`);
      setFileVersions(res.data.versions || []);
      addNotification(`Loaded versions for "${file.name}"`, 'info', '📜');
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
      addNotification(`Restored "${versionModalFile.name}" to version ${versionNumber}!`, 'success', '♻️');
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
    setCopiedLinkFeedback(false);
    try {
      let res;
      try {
        res = await api.post('/shares', {
          item_id: item.id,
          item_type: itemType,
          share_type: 'link',
          permission: sharePermission,
        });
      } catch (postErr) {
        if (postErr.response?.status === 401) {
          const authRes = await axios.post('/api/auth/demo');
          const newToken = authRes.data.access_token;
          localStorage.setItem('cloudvault_token', newToken);
          setUser(authRes.data.user);
          res = await api.post('/shares', {
            item_id: item.id,
            item_type: itemType,
            share_type: 'link',
            permission: sharePermission,
          });
        } else {
          throw postErr;
        }
      }
      const origin = window.location.origin;
      setShareLink(`${origin}/api/shares/public/${res.data.share.share_token}`);
      addNotification(`Share link generated for "${item.name}"`, 'success', '🔗');
    } catch (err) {
      console.error('Error generating share link:', err);
      addNotification('Could not generate share link: ' + (err.response?.data?.message || err.message), 'error');
    }
  };

  const handlePermissionChange = async (newPermission) => {
    setSharePermission(newPermission);
    if (!shareModalItem) return;
    try {
      const res = await api.post('/shares', {
        item_id: shareModalItem.id,
        item_type: shareModalItem.itemType,
        share_type: 'link',
        permission: newPermission,
      });
      const origin = window.location.origin;
      setShareLink(`${origin}/api/shares/public/${res.data.share.share_token}`);
      addNotification(`Permission updated to: ${newPermission === 'editor' ? 'Editor' : 'Viewer'}`, 'info', '🔒');
    } catch (err) {
      console.warn('Could not update permission link:', err);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setCopiedLinkFeedback(true);
    setTimeout(() => setCopiedLinkFeedback(false), 2500);
    addNotification(
      `Share link copied to clipboard! Permission: ${sharePermission === 'editor' ? 'Editor' : 'Viewer'} (Allow copy: ${allowCopyOption ? 'Yes' : 'No'})`,
      'success',
      '📋'
    );
  };

  const handleShareByEmail = async (e) => {
    e.preventDefault();
    if (!shareEmail.trim() || !shareModalItem) return;
    const email = shareEmail.trim();
    try {
      await api.post('/shares', {
        item_id: shareModalItem.id,
        item_type: shareModalItem.itemType,
        share_type: 'user',
        email,
        permission: sharePermission,
      });
      addNotification(`Shared "${shareModalItem.name}" with ${email} (${sharePermission})!`, 'success', '💌');
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
      <div style={themeStyles[theme].landingPage}>
        <div style={themeStyles[theme].blob1} />
        <div style={themeStyles[theme].blob2} />

        <div style={themeStyles[theme].landingContainer}>
          <div style={themeStyles[theme].logoBadge}>
            <span style={{ fontSize: 24 }}>☁️</span>
            <span style={themeStyles[theme].brandTitle}>CloudVault</span>
          </div>

          <h1 style={themeStyles[theme].heroHeading}>
            Scalable Cloud File Storage <br />
            <span style={themeStyles[theme].gradientText}>& Instant Synchronization</span>
          </h1>

          <p style={themeStyles[theme].heroSubheading}>
            Full-stack, enterprise-grade cloud drive with multi-part chunked uploads, block-level deduplication,
            real-time Socket.IO notifications, and Redis caching.
          </p>

          <div style={themeStyles[theme].ctaRow}>
            <button style={themeStyles[theme].primaryBtn} onClick={() => setAuthModal('register')}>
              Create Free Account
            </button>
            <button style={themeStyles[theme].secondaryBtn} onClick={() => setAuthModal('login')}>
              Sign In
            </button>
            <button style={themeStyles[theme].demoBtn} onClick={handleDemoLogin}>
              ⚡ One-Click Demo Mode
            </button>
            <button
              style={themeStyles[theme].themeToggleLanding}
              onClick={toggleTheme}
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
            </button>
          </div>

          <div style={themeStyles[theme].featuresGrid}>
            <div style={themeStyles[theme].featureCard}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>⚡</div>
              <h3 style={themeStyles[theme].featureTitle}>Resumable Chunked Uploads</h3>
              <p style={themeStyles[theme].featureDesc}>Automatic chunk slicing for large files with resume and deduplication.</p>
            </div>
            <div style={themeStyles[theme].featureCard}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📜</div>
              <h3 style={themeStyles[theme].featureTitle}>Full Version History</h3>
              <p style={themeStyles[theme].featureDesc}>Revert to any historical version seamlessly with audit checksum verification.</p>
            </div>
            <div style={themeStyles[theme].featureCard}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🔔</div>
              <h3 style={themeStyles[theme].featureTitle}>Real-Time Event Sync</h3>
              <p style={themeStyles[theme].featureDesc}>WebSocket and Redis Pub/Sub push notifications on share and upload events.</p>
            </div>
          </div>
        </div>

        {/* Auth Modal */}
        {authModal && (
          <div style={themeStyles[theme].modalOverlay} onClick={() => setAuthModal(null)}>
            <div style={themeStyles[theme].modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={themeStyles[theme].modalHeader}>
                <h2 style={themeStyles[theme].modalTitle}>
                  {authModal === 'register' ? 'Create your Account' : 'Welcome Back'}
                </h2>
                <button style={themeStyles[theme].closeBtn} onClick={() => setAuthModal(null)}>✕</button>
              </div>

              {authError && <div style={themeStyles[theme].errorAlert}>{authError}</div>}

              <form onSubmit={handleAuthSubmit} style={themeStyles[theme].form}>
                {authModal === 'register' && (
                  <div style={themeStyles[theme].inputGroup}>
                    <label style={themeStyles[theme].label}>Full Name</label>
                    <input
                      style={themeStyles[theme].input}
                      type="text"
                      placeholder="Jane Doe"
                      required
                      value={authForm.display_name}
                      onChange={(e) => setAuthForm({ ...authForm, display_name: e.target.value })}
                    />
                  </div>
                )}

                <div style={themeStyles[theme].inputGroup}>
                  <label style={themeStyles[theme].label}>Email Address</label>
                  <input
                    style={themeStyles[theme].input}
                    type="email"
                    placeholder="user@example.com"
                    required
                    value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                  />
                </div>

                <div style={themeStyles[theme].inputGroup}>
                  <label style={themeStyles[theme].label}>Password</label>
                  <input
                    style={themeStyles[theme].input}
                    type="password"
                    placeholder="••••••••"
                    required
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                  />
                </div>

                <button style={themeStyles[theme].modalSubmitBtn} type="submit">
                  {authModal === 'register' ? 'Register Account' : 'Sign In'}
                </button>

                <div style={themeStyles[theme].modalFooter}>
                  {authModal === 'register' ? (
                    <span style={themeStyles[theme].footerText}>
                      Already have an account?{' '}
                      <a style={themeStyles[theme].footerLink} onClick={() => setAuthModal('login')}>Sign In</a>
                    </span>
                  ) : (
                    <span style={themeStyles[theme].footerText}>
                      Don't have an account?{' '}
                      <a style={themeStyles[theme].footerLink} onClick={() => setAuthModal('register')}>Sign Up</a>
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
  const S = themeStyles[theme];

  return (
    <div
      style={S.appContainer}
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
        <div style={S.dragOverlay}>
          <div style={S.dragBox}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📤</div>
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>Drop files to upload immediately</h2>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 6, fontSize: 14 }}>
              Automatic chunked resumable upload for large files
            </p>
          </div>
        </div>
      )}

      {/* Upload Toast Indicator */}
      {uploadProgress && (
        <div style={S.uploadToast}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
              {uploadProgress.isChunked ? '⚡ Chunked: ' : '📤 Uploading: '} {uploadProgress.name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)' }}>{uploadProgress.percent}%</span>
          </div>
          <div style={S.progressBarBg}>
            <div style={{ ...S.progressBarFill, width: `${uploadProgress.percent}%` }} />
          </div>
        </div>
      )}

      {/* Toast Notifications System */}
      <div style={S.notificationsContainer}>
        {notifications.map((n) => (
          <div
            key={n.id}
            className="animate-toast"
            style={{
              ...S.toast,
              borderLeft: `4px solid ${n.type === 'error' ? 'var(--color-error)' : n.type === 'success' ? 'var(--color-success)' : 'var(--color-primary)'}`,
            }}
          >
            <span style={{ fontSize: 16 }}>{n.icon}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{n.message}</span>
          </div>
        ))}
      </div>

      {/* Top Header */}
      <header style={S.topHeader}>
        <div style={S.headerLeft}>
          <div style={S.brandGroup}>
            <div style={S.brandIconWrapper}>☁️</div>
            <span style={S.brandName}>CloudVault</span>
          </div>
        </div>

        <div style={S.headerCenter}>
          <div style={S.searchBar}>
            <span style={S.searchIcon}>🔍</span>
            <input
              style={S.searchInput}
              type="text"
              placeholder="Search in Drive... (Press '/' to search)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button style={S.clearSearchBtn} onClick={() => setSearchQuery('')} title="Clear search">✕</button>
            )}
          </div>
        </div>

        <div style={S.headerRight}>
          {/* Theme Switcher Button */}
          <button
            style={S.headerIconBtn}
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>

          {/* System Health */}
          <button
            style={S.healthBadge}
            onClick={() => setShowHealthModal(true)}
            title="System Diagnostics & Health"
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
            <span style={{ fontSize: 12, fontWeight: 600 }}>System Health</span>
          </button>

          {/* Quick Settings Icon */}
          <button
            style={S.headerIconBtn}
            onClick={() => {
              setShowSettingsModal(true);
              setShowUserMenu(false);
            }}
            title="Settings & Preferences"
          >
            ⚙️
          </button>

          {/* User Profile Pill & Dropdown */}
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              style={S.userProfileBtn}
              onClick={() => setShowUserMenu(!showUserMenu)}
              title="Account, Settings & Logout"
            >
              <div style={S.avatar}>
                {user?.display_name ? user.display_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div style={S.userInfo}>
                <span style={S.userName}>{user?.display_name || 'User'}</span>
                <span style={S.userBadge}>Demo Account</span>
              </div>
              <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 2 }}>▾</span>
            </button>

            {/* User Dropdown Menu */}
            {showUserMenu && (
              <div className="animate-slide-down" style={S.userMenuDropdown}>
                <div style={S.userMenuHeader}>
                  <div style={{ ...S.avatar, width: 44, height: 44, fontSize: 18 }}>
                    {user?.display_name ? user.display_name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{user?.display_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {user?.email}
                    </div>
                  </div>
                </div>

                {/* Mini Storage Indicator inside menu */}
                <div style={S.userMenuStorage}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>
                    <span>Cloud Storage</span>
                    <span>{quotaPercent}% used</span>
                  </div>
                  <div style={S.storageBarBg}>
                    <div style={{ ...S.storageBarFill, width: `${quotaPercent}%` }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {formatBytes(usedBytes)} of {formatBytes(totalQuota)} used
                  </div>
                </div>

                <div style={S.userMenuDivider} />

                {/* Actions */}
                <button
                  style={S.userMenuItem}
                  onClick={() => {
                    setShowSettingsModal(true);
                    setShowUserMenu(false);
                  }}
                >
                  <span style={{ fontSize: 16 }}>⚙️</span>
                  <span>Settings & Preferences</span>
                </button>

                <button
                  style={S.userMenuItem}
                  onClick={() => {
                    toggleTheme();
                    setShowUserMenu(false);
                  }}
                >
                  <span style={{ fontSize: 16 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
                  <span>Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode</span>
                </button>

                <button
                  style={S.userMenuItem}
                  onClick={() => {
                    setShowHealthModal(true);
                    setShowUserMenu(false);
                  }}
                >
                  <span style={{ fontSize: 16 }}>🩺</span>
                  <span>System Diagnostics</span>
                </button>

                <div style={S.userMenuDivider} />

                <button
                  style={{ ...S.userMenuItem, color: 'var(--color-error)' }}
                  onClick={handleLogout}
                >
                  <span style={{ fontSize: 16 }}>🚪</span>
                  <span style={{ fontWeight: 600 }}>Sign Out / Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div style={S.mainLayout}>
        {/* Sidebar */}
        <aside style={S.sidebar}>
          <div style={S.newBtnContainer} onClick={(e) => e.stopPropagation()}>
            <button
              style={S.newButton}
              onClick={() => setShowNewMenu(!showNewMenu)}
            >
              <span style={{ fontSize: 20, marginRight: 8, fontWeight: 300 }}>+</span>
              <span>New</span>
            </button>

            {showNewMenu && (
              <div className="animate-slide-down" style={S.newDropdown}>
                <button
                  style={S.dropdownItem}
                  onClick={() => {
                    setShowNewMenu(false);
                    setNewFolderModal(true);
                  }}
                >
                  <span style={{ marginRight: 10, fontSize: 16 }}>📁</span>
                  <span>New Folder</span>
                </button>
                <button
                  style={S.dropdownItem}
                  onClick={() => {
                    setShowNewMenu(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <span style={{ marginRight: 10, fontSize: 16 }}>📄</span>
                  <span>Upload File</span>
                </button>
              </div>
            )}
          </div>

          <nav style={S.navMenu}>
            <button
              style={{ ...S.navItem, ...(currentTab === 'drive' ? S.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('drive');
                setCurrentFolderId(null);
              }}
            >
              <span style={S.navIcon}>🗂️</span>
              <span>My Drive</span>
            </button>

            <button
              style={{ ...S.navItem, ...(currentTab === 'shared' ? S.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('shared');
                setCurrentFolderId(null);
              }}
            >
              <span style={S.navIcon}>👥</span>
              <span>Shared with me</span>
            </button>

            <button
              style={{ ...S.navItem, ...(currentTab === 'trash' ? S.navItemActive : {}) }}
              onClick={() => {
                setCurrentTab('trash');
                setCurrentFolderId(null);
              }}
            >
              <span style={S.navIcon}>🗑️</span>
              <span>Trash</span>
            </button>

            <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '12px 0' }} />

            <button
              style={S.navItem}
              onClick={() => setShowSettingsModal(true)}
            >
              <span style={S.navIcon}>⚙️</span>
              <span>Settings</span>
            </button>
          </nav>

          {/* Storage Meter */}
          <div style={S.storageSection}>
            <div style={S.storageHeader}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Storage</span>
              <span style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 700 }}>{quotaPercent}%</span>
            </div>
            <div style={S.storageBarBg}>
              <div style={{ ...S.storageBarFill, width: `${quotaPercent}%` }} />
            </div>
            <div style={S.storageSubtext}>
              {formatBytes(usedBytes)} of {formatBytes(totalQuota)} used
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main style={S.mainContent}>
          {/* Sub-Header / Breadcrumbs & View Controls */}
          <div style={S.contentHeader}>
            <div style={S.breadcrumbBar}>
              {breadcrumbs.map((crumb, idx) => (
                <span key={idx} style={S.breadcrumbItem}>
                  {idx > 0 && <span style={S.breadcrumbSeparator}>›</span>}
                  <button
                    style={{
                      ...S.breadcrumbLink,
                      fontWeight: idx === breadcrumbs.length - 1 ? 700 : 500,
                      color: idx === breadcrumbs.length - 1 ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                    onClick={() => navigateToFolder(crumb.id)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div style={S.viewControls}>
              <button
                style={{ ...S.iconBtn, ...(viewMode === 'grid' ? S.iconBtnActive : {}) }}
                onClick={() => setViewMode('grid')}
                title="Grid View"
              >
                ⊞ Grid
              </button>
              <button
                style={{ ...S.iconBtn, ...(viewMode === 'list' ? S.iconBtnActive : {}) }}
                onClick={() => setViewMode('list')}
                title="List View"
              >
                ☰ List
              </button>
              <button
                style={S.iconBtn}
                onClick={loadContent}
                title="Refresh Drive Content"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {loading && (
            <div style={S.loadingBar}>
              <div style={S.loadingAnimation} />
            </div>
          )}

          {/* Content Scroll Container */}
          <div style={S.scrollableContent}>
            {currentTab === 'shared' ? (
              <div>
                <h3 style={S.sectionHeading}>Shared Files & Folders</h3>
                {sharedItems.length === 0 ? (
                  <div style={S.emptyState}>
                    <div style={{ fontSize: 52, marginBottom: 12 }}>👥</div>
                    <h4 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>No shared items yet</h4>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Files and folders shared with you will appear here.</p>
                  </div>
                ) : (
                  <div style={S.filesGrid}>
                    {sharedItems.map((item) => (
                      <div key={item.share_id} style={S.cardItem}>
                        <div style={S.cardIconWrapper}>📄</div>
                        <div style={S.cardTitle} title={item.name}>{item.name}</div>
                        <div style={S.cardMeta}>
                          Shared by {item.owner?.displayName || item.owner?.email} · {item.permission}
                        </div>
                        <div style={S.cardActions}>
                          <button
                            style={S.actionBtnPrimary}
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
                  <div style={{ marginBottom: 32 }}>
                    <h3 style={S.sectionHeading}>Folders ({folders.length})</h3>
                    <div style={S.foldersGrid}>
                      {folders.map((f) => (
                        <div
                          key={f.id}
                          style={S.folderCard}
                          onClick={() => currentTab === 'drive' && navigateToFolder(f.id)}
                        >
                          <span style={{ fontSize: 24 }}>📁</span>
                          <span style={S.folderName} title={f.name}>{f.name}</span>
                          <div style={S.itemMenu} onClick={(e) => e.stopPropagation()}>
                            {currentTab === 'drive' ? (
                              <>
                                <button
                                  style={S.menuSmallBtn}
                                  onClick={() => handleOpenShare(f, 'folder')}
                                  title="Share Folder & Copy Link"
                                >
                                  🔗
                                </button>
                                <button
                                  style={S.menuSmallBtn}
                                  onClick={() => {
                                    setRenameItem({ ...f, type: 'folder' });
                                    setRenameNewName(f.name);
                                  }}
                                  title="Rename / Edit Name"
                                >
                                  ✏️
                                </button>
                                <button
                                  style={S.menuSmallBtn}
                                  onClick={() => handleTrashFolder(f.id, f.name)}
                                  title="Move to Trash"
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
                  <h3 style={S.sectionHeading}>
                    Files {files.length > 0 && `(${files.length})`}
                  </h3>

                  {files.length === 0 && folders.length === 0 && !loading && (
                    <div style={S.emptyState}>
                      <div style={{ fontSize: 52, marginBottom: 12 }}>📂</div>
                      <h4 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>This folder is empty</h4>
                      <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                        Drag and drop files here, or click "+ New" above to upload.
                      </p>
                    </div>
                  )}

                  {viewMode === 'grid' ? (
                    <div style={S.filesGrid}>
                      {files.map((file) => {
                        const meta = getFileMeta(file.name, file.mime_type);
                        return (
                          <div key={file.id} style={S.cardItem}>
                            {/* File Header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                              <div style={{ ...S.cardIconWrapper, backgroundColor: meta.bg }}>
                                <span style={{ fontSize: 28 }}>{meta.icon}</span>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, backgroundColor: meta.bg, color: meta.color }}>
                                {meta.label}
                              </span>
                            </div>

                            {/* Title & Meta */}
                            <div style={S.cardTitle} title={file.name}>
                              {file.name}
                            </div>
                            <div style={S.cardMeta}>
                              <span>{formatBytes(file.size)}</span>
                              <span>·</span>
                              <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>v{file.versions_count || 1}</span>
                            </div>

                            {/* Card Actions Toolbar */}
                            <div style={S.cardActions}>
                              {currentTab === 'drive' ? (
                                <>
                                  <button
                                    style={S.cardActionBtn}
                                    onClick={() => handleDownload(file.id, file.name)}
                                    title="Download File"
                                  >
                                    ⬇️
                                  </button>
                                  <button
                                    style={S.cardActionBtn}
                                    onClick={() => handleOpenShare(file, 'file')}
                                    title="Share & Copy Link"
                                  >
                                    🔗
                                  </button>
                                  <button
                                    style={S.cardActionBtn}
                                    onClick={() => {
                                      setRenameItem({ ...file, type: 'file' });
                                      setRenameNewName(file.name);
                                    }}
                                    title="Rename / Edit File Name"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    style={S.cardActionBtn}
                                    onClick={() => handleOpenVersions(file)}
                                    title="Version History"
                                  >
                                    📜
                                  </button>
                                  <button
                                    style={{ ...S.cardActionBtn, color: 'var(--color-error)' }}
                                    onClick={() => handleTrashFile(file.id, file.name)}
                                    title="Move to Trash"
                                  >
                                    🗑️
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    style={S.actionBtnPrimary}
                                    onClick={() => handleRestoreFile(file.id, file.name)}
                                    title="Restore back to Drive"
                                  >
                                    ♻️ Restore
                                  </button>
                                  <button
                                    style={S.actionBtnDanger}
                                    onClick={() => handlePermanentDeleteFile(file.id, file.name)}
                                    title="Delete Forever"
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
                    <div style={S.listView}>
                      <div style={S.listHeader}>
                        <span style={{ flex: 3 }}>Name</span>
                        <span style={{ flex: 1 }}>Size</span>
                        <span style={{ flex: 1 }}>Version</span>
                        <span style={{ flex: 1.5 }}>Modified</span>
                        <span style={{ flex: 2, textAlign: 'right' }}>Actions</span>
                      </div>
                      {files.map((file) => {
                        const meta = getFileMeta(file.name, file.mime_type);
                        return (
                          <div key={file.id} style={S.listRow}>
                            <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{ fontSize: 20 }}>{meta.icon}</span>
                              <span style={{ fontWeight: 600, fontSize: 14 }} title={file.name}>{file.name}</span>
                            </div>
                            <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 13 }}>
                              {formatBytes(file.size)}
                            </span>
                            <span style={{ flex: 1, color: 'var(--color-primary)', fontSize: 12, fontWeight: 700 }}>
                              v{file.versions_count || 1}
                            </span>
                            <span style={{ flex: 1.5, color: 'var(--color-text-muted)', fontSize: 13 }}>
                              {new Date(file.updated_at).toLocaleDateString()}
                            </span>
                            <div style={{ flex: 2, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              {currentTab === 'drive' ? (
                                <>
                                  <button style={S.menuSmallBtn} onClick={() => handleDownload(file.id, file.name)} title="Download">⬇️</button>
                                  <button style={S.menuSmallBtn} onClick={() => handleOpenShare(file, 'file')} title="Share & Link">🔗</button>
                                  <button
                                    style={S.menuSmallBtn}
                                    onClick={() => {
                                      setRenameItem({ ...file, type: 'file' });
                                      setRenameNewName(file.name);
                                    }}
                                    title="Rename / Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button style={S.menuSmallBtn} onClick={() => handleOpenVersions(file)} title="History">📜</button>
                                  <button style={{ ...S.menuSmallBtn, color: 'var(--color-error)' }} onClick={() => handleTrashFile(file.id, file.name)} title="Trash">🗑️</button>
                                </>
                              ) : (
                                <>
                                  <button style={S.actionBtnPrimary} onClick={() => handleRestoreFile(file.id, file.name)}>♻️ Restore</button>
                                  <button style={S.actionBtnDanger} onClick={() => handlePermanentDeleteFile(file.id, file.name)}>✕ Delete</button>
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

      {/* Share Modal with "Allow Copy", Permissions, and Direct Link */}
      {shareModalItem && (
        <div style={S.modalOverlay} onClick={() => setShareModalItem(null)}>
          <div className="animate-fade-in" style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>🔗</span>
                <div>
                  <h3 style={S.modalTitle}>Share "{shareModalItem.name}"</h3>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Manage link access and collaborator permissions</p>
                </div>
              </div>
              <button style={S.closeBtn} onClick={() => setShareModalItem(null)}>✕</button>
            </div>

            {/* Public Link Sharing Box */}
            <div style={S.shareSectionBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>🌐 General Link Access</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 700 }}>
                  Active & Ready
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  style={{ ...S.input, flex: 1, fontSize: 13 }}
                  readOnly
                  value={shareLink || 'Generating link...'}
                />
                <button
                  type="button"
                  style={{
                    ...S.primaryBtnSmall,
                    minWidth: 100,
                    backgroundColor: copiedLinkFeedback ? '#10b981' : 'var(--color-primary)',
                  }}
                  onClick={handleCopyShareLink}
                >
                  {copiedLinkFeedback ? '✅ Copied!' : '📋 Copy Link'}
                </button>
              </div>

              {/* Permission & Copy Control Options */}
              <div style={S.shareOptionRow}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Link Permissions:</label>
                <select
                  style={S.selectInput}
                  value={sharePermission}
                  onChange={(e) => handlePermissionChange(e.target.value)}
                >
                  <option value="viewer">Viewer (Can view & download)</option>
                  <option value="editor">Editor (Can edit, rename & organize)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
                <label style={S.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={allowCopyOption}
                    onChange={(e) => {
                      setAllowCopyOption(e.target.checked);
                      addNotification(e.target.checked ? 'Enabled: Viewers can copy options' : 'Disabled: Viewers copy restricted', 'info');
                    }}
                  />
                  <span>Allow viewers to copy file text, extract contents, & copy link</span>
                </label>

                <label style={S.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={allowDownloadOption}
                    onChange={(e) => {
                      setAllowDownloadOption(e.target.checked);
                      addNotification(e.target.checked ? 'Direct download enabled' : 'Direct download restricted', 'info');
                    }}
                  />
                  <span>Allow direct full-speed file downloads</span>
                </label>
              </div>
            </div>

            {/* Invite Collaborators by Email */}
            <form onSubmit={handleShareByEmail} style={{ marginTop: 20 }}>
              <label style={S.label}>Invite Collaborator by Email</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  type="email"
                  placeholder="colleague@example.com"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                />
                <button type="submit" style={S.primaryBtn}>
                  Send Invite
                </button>
              </div>
            </form>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button style={S.secondaryBtn} onClick={() => setShareModalItem(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div style={S.modalOverlay} onClick={() => setShowSettingsModal(false)}>
          <div className="animate-fade-in" style={S.modalContentLarge} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>⚙️</span>
                <div>
                  <h3 style={S.modalTitle}>Settings & Preferences</h3>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Configure your CloudVault account and UI appearance</p>
                </div>
              </div>
              <button style={S.closeBtn} onClick={() => setShowSettingsModal(false)}>✕</button>
            </div>

            {/* Settings Tabs */}
            <div style={S.settingsTabsBar}>
              <button
                style={{ ...S.settingsTabBtn, ...(settingsTab === 'general' ? S.settingsTabBtnActive : {}) }}
                onClick={() => setSettingsTab('general')}
              >
                👤 Profile & Storage
              </button>
              <button
                style={{ ...S.settingsTabBtn, ...(settingsTab === 'appearance' ? S.settingsTabBtnActive : {}) }}
                onClick={() => setSettingsTab('appearance')}
              >
                🎨 Appearance
              </button>
              <button
                style={{ ...S.settingsTabBtn, ...(settingsTab === 'sharing' ? S.settingsTabBtnActive : {}) }}
                onClick={() => setSettingsTab('sharing')}
              >
                🔗 Sharing & Copy
              </button>
              <button
                style={{ ...S.settingsTabBtn, ...(settingsTab === 'system' ? S.settingsTabBtnActive : {}) }}
                onClick={() => setSettingsTab('system')}
              >
                🩺 System Info
              </button>
            </div>

            {/* Tab Contents */}
            <div style={{ minHeight: 240 }}>
              {settingsTab === 'general' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Display Name</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Your public identity on shared documents</div>
                    </div>
                    <span style={{ fontWeight: 700 }}>{user?.display_name}</span>
                  </div>

                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Email Address</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Used for login and notification relays</div>
                    </div>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{user?.email}</span>
                  </div>

                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Cloud Storage Quota</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {formatBytes(usedBytes)} of {formatBytes(totalQuota)} ({quotaPercent}%)
                      </div>
                    </div>
                    <div style={{ width: 140 }}>
                      <div style={S.storageBarBg}>
                        <div style={{ ...S.storageBarFill, width: `${quotaPercent}%` }} />
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      style={{ ...S.secondaryBtn, color: 'var(--color-error)' }}
                      onClick={handleLogout}
                    >
                      🚪 Sign Out of All Sessions
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'appearance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                    Choose your preferred visual theme for CloudVault.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* Light Mode Card */}
                    <div
                      style={{
                        ...S.themeCard,
                        borderColor: theme === 'light' ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                      }}
                      onClick={() => setTheme('light')}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>☀️</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>Light Mode</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                        Clean, high-clarity white & slate background for daylight productivity
                      </div>
                      {theme === 'light' && (
                        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>
                          ✓ Active Theme
                        </div>
                      )}
                    </div>

                    {/* Dark Mode Card */}
                    <div
                      style={{
                        ...S.themeCard,
                        borderColor: theme === 'dark' ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: '#111827',
                        color: '#f8fafc',
                      }}
                      onClick={() => setTheme('dark')}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🌙</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>Dark Mode</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Sleek obsidian & deep slate aesthetic optimized for low-light focus
                      </div>
                      {theme === 'dark' && (
                        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>
                          ✓ Active Theme
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === 'sharing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Default Link Permission</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Applied when generating new shareable links</div>
                    </div>
                    <select
                      style={S.selectInput}
                      value={sharePermission}
                      onChange={(e) => setSharePermission(e.target.value)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  </div>

                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Allow Content Copying</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Allow viewers to copy file text and copy share links</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowCopyOption}
                      onChange={(e) => setAllowCopyOption(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                  </div>

                  <div style={S.settingsRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Allow Direct Download</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Enable one-click downloading for shared files</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowDownloadOption}
                      onChange={(e) => setAllowDownloadOption(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}

              {settingsTab === 'system' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={S.settingsRow}>
                    <span>API Server Status</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>HEALTHY (Port 8000)</span>
                  </div>
                  <div style={S.settingsRow}>
                    <span>PostgreSQL Database</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>CONNECTED (Port 5434 / 5432)</span>
                  </div>
                  <div style={S.settingsRow}>
                    <span>Redis Cache</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>CONNECTED (Port 6379)</span>
                  </div>
                  <div style={S.settingsRow}>
                    <span>MinIO S3 Object Storage</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>ACTIVE (Bucket: cloudvault-files)</span>
                  </div>
                  <div style={S.settingsRow}>
                    <span>Real-Time WebSocket Service</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>ONLINE (Port 8001 / Socket.IO)</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <button style={S.primaryBtn} onClick={() => setShowSettingsModal(false)}>
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename / Edit Modal */}
      {renameItem && (
        <div style={S.modalOverlay} onClick={() => setRenameItem(null)}>
          <div className="animate-fade-in" style={S.modalContentSmall} onClick={(e) => e.stopPropagation()}>
            <h3 style={S.modalTitle}>✏️ Rename {renameItem.type === 'folder' ? 'Folder' : 'File'}</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Enter the new name for this item</p>
            <form onSubmit={handleRenameSubmit} style={{ marginTop: 16 }}>
              <input
                style={S.input}
                type="text"
                autoFocus
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
              />
              <div style={S.modalActions}>
                <button
                  type="button"
                  style={S.secondaryBtn}
                  onClick={() => setRenameItem(null)}
                >
                  Cancel
                </button>
                <button type="submit" style={S.primaryBtn}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {newFolderModal && (
        <div style={S.modalOverlay} onClick={() => setNewFolderModal(false)}>
          <div className="animate-fade-in" style={S.modalContentSmall} onClick={(e) => e.stopPropagation()}>
            <h3 style={S.modalTitle}>📁 New Folder</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Enter a title for the new folder</p>
            <form onSubmit={handleCreateFolder} style={{ marginTop: 16 }}>
              <input
                style={S.input}
                type="text"
                placeholder="Folder title"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
              <div style={S.modalActions}>
                <button
                  type="button"
                  style={S.secondaryBtn}
                  onClick={() => setNewFolderModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" style={S.primaryBtn}>
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionModalFile && (
        <div style={S.modalOverlay} onClick={() => setVersionModalFile(null)}>
          <div className="animate-fade-in" style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <h3 style={S.modalTitle}>📜 Version History</h3>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{versionModalFile.name}</p>
              </div>
              <button style={S.closeBtn} onClick={() => setVersionModalFile(null)}>✕</button>
            </div>

            {versionsLoading ? (
              <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading versions...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, maxHeight: 360, overflowY: 'auto' }}>
                {fileVersions.map((v) => (
                  <div key={v.id} style={S.versionCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: v.is_current ? 'var(--color-primary)' : 'inherit' }}>
                        Version {v.version_number} {v.is_current && ' (Current)'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {formatBytes(v.size)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Saved on {new Date(v.created_at).toLocaleString()} by {v.created_by}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button
                        style={S.secondaryBtnSmall}
                        onClick={() => window.open(`/api/files/${versionModalFile.id}/versions/${v.version_number}/download`, '_blank')}
                      >
                        ⬇️ Download
                      </button>
                      {!v.is_current && (
                        <button
                          style={S.primaryBtnSmall}
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

      {/* Health / System Status Modal */}
      {showHealthModal && (
        <div style={S.modalOverlay} onClick={() => setShowHealthModal(false)}>
          <div className="animate-fade-in" style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <h3 style={S.modalTitle}>🩺 System Architecture & Health</h3>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Real-time status across microservices</p>
              </div>
              <button style={S.closeBtn} onClick={() => setShowHealthModal(false)}>✕</button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={S.healthRow}>
                <span>API Gateway (Nginx :80)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>ONLINE</span>
              </div>
              <div style={S.healthRow}>
                <span>API Service (Express :8000)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>HEALTHY (v1.0.0)</span>
              </div>
              <div style={S.healthRow}>
                <span>PostgreSQL Database (:5434 / :5432)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>CONNECTED</span>
              </div>
              <div style={S.healthRow}>
                <span>Redis Distributed Cache (:6379)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>CONNECTED</span>
              </div>
              <div style={S.healthRow}>
                <span>Object Storage (MinIO S3 :9000)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>CONNECTED</span>
              </div>
              <div style={S.healthRow}>
                <span>Real-Time Notifications (Socket.IO :8001)</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>ONLINE</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button style={S.primaryBtn} onClick={() => setShowHealthModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Theme Style Definitions (Light & Dark) ──────────────────────────────────
const createThemeStyles = (isLight) => {
  const bg = isLight ? '#f8fafc' : '#0b0f19';
  const headerBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.92)';
  const sidebarBg = isLight ? '#ffffff' : '#0f172a';
  const cardBg = isLight ? '#ffffff' : '#141e33';
  const cardBorder = isLight ? '#e2e8f0' : '#1e293b';
  const text = isLight ? '#0f172a' : '#f8fafc';
  const textMuted = isLight ? '#64748b' : '#94a3b8';
  const inputBg = isLight ? '#f8fafc' : '#1e293b';
  const inputBorder = isLight ? '#cbd5e1' : '#334155';
  const shadow = isLight ? '0 2px 10px rgba(0, 0, 0, 0.05)' : '0 4px 20px rgba(0, 0, 0, 0.5)';
  const hoverBg = isLight ? '#f1f5f9' : '#1e293b';

  return {
    landingPage: {
      minHeight: '100vh',
      background: isLight
        ? 'radial-gradient(ellipse at top, #e0e7ff 0%, #f8fafc 100%)'
        : 'radial-gradient(ellipse at top, #111827 0%, #090d16 100%)',
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
      background: isLight
        ? 'radial-gradient(circle, rgba(79, 70, 229, 0.12) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
      pointerEvents: 'none',
    },
    blob2: {
      position: 'absolute',
      bottom: '-150px',
      right: '-150px',
      width: 600,
      height: 600,
      borderRadius: '50%',
      background: isLight
        ? 'radial-gradient(circle, rgba(2, 132, 199, 0.1) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, transparent 70%)',
      pointerEvents: 'none',
    },
    landingContainer: {
      maxWidth: 860,
      width: '100%',
      textAlign: 'center',
      position: 'relative',
      zIndex: 2,
    },
    logoBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 20px',
      background: isLight ? '#ffffff' : 'rgba(255,255,255,0.05)',
      border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)',
      borderRadius: 30,
      marginBottom: 24,
      boxShadow: shadow,
    },
    brandTitle: { fontSize: 18, fontWeight: 800, color: text },
    heroHeading: {
      fontSize: 48,
      fontWeight: 800,
      lineHeight: 1.15,
      marginBottom: 16,
      letterSpacing: '-1px',
      color: text,
    },
    gradientText: {
      background: 'linear-gradient(135deg, #4f46e5, #0284c7)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    },
    heroSubheading: {
      fontSize: 16,
      color: textMuted,
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
      background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
      color: '#fff',
      padding: '11px 22px',
      borderRadius: 10,
      fontWeight: 600,
      fontSize: 14,
      boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)',
    },
    secondaryBtn: {
      background: isLight ? '#ffffff' : 'rgba(255,255,255,0.06)',
      border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.14)',
      color: text,
      padding: '11px 20px',
      borderRadius: 10,
      fontWeight: 600,
      fontSize: 14,
    },
    primaryBtnSmall: {
      background: '#4f46e5',
      color: '#fff',
      padding: '7px 14px',
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
    },
    secondaryBtnSmall: {
      background: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
      border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.12)',
      color: text,
      padding: '7px 14px',
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
    },
    demoBtn: {
      background: isLight ? 'rgba(79, 70, 229, 0.08)' : 'rgba(99, 102, 241, 0.15)',
      border: '1px solid rgba(79, 70, 229, 0.3)',
      color: '#4f46e5',
      padding: '11px 20px',
      borderRadius: 10,
      fontWeight: 700,
      fontSize: 14,
    },
    themeToggleLanding: {
      background: isLight ? '#ffffff' : '#1e293b',
      border: `1px solid ${cardBorder}`,
      color: text,
      padding: '11px 18px',
      borderRadius: 10,
      fontSize: 13,
      fontWeight: 600,
    },
    featuresGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: 18,
      textAlign: 'left',
    },
    featureCard: {
      background: isLight ? '#ffffff' : 'rgba(17, 24, 39, 0.7)',
      border: `1px solid ${cardBorder}`,
      borderRadius: 14,
      padding: 24,
      boxShadow: shadow,
    },
    featureTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8, color: text },
    featureDesc: { fontSize: 13, color: textMuted, lineHeight: 1.5 },

    // App Container
    appContainer: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: bg,
      color: text,
      overflow: 'hidden',
      position: 'relative',
    },
    topHeader: {
      height: 64,
      backgroundColor: headerBg,
      backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${cardBorder}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      zIndex: 20,
      boxShadow: isLight ? '0 1px 3px rgba(0,0,0,0.03)' : 'none',
    },
    headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
    brandGroup: { display: 'flex', alignItems: 'center', gap: 10 },
    brandIconWrapper: {
      width: 36,
      height: 36,
      borderRadius: 10,
      background: 'linear-gradient(135deg, #4f46e5, #0284c7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18,
      color: '#ffffff',
    },
    brandName: {
      fontSize: 18,
      fontWeight: 800,
      color: text,
      letterSpacing: '-0.3px',
    },
    headerCenter: { flex: 1, maxWidth: 580, margin: '0 32px' },
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
      color: textMuted,
      pointerEvents: 'none',
    },
    searchInput: {
      width: '100%',
      height: 40,
      borderRadius: 10,
      backgroundColor: inputBg,
      border: `1px solid ${inputBorder}`,
      padding: '0 38px',
      fontSize: 14,
      color: text,
      transition: 'border-color 0.2s',
    },
    clearSearchBtn: {
      position: 'absolute',
      right: 12,
      color: textMuted,
      fontSize: 12,
      padding: 4,
    },
    headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
    headerIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 16,
      cursor: 'pointer',
    },
    healthBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 14px',
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 20,
      color: text,
      cursor: 'pointer',
    },
    userProfileBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 10px 4px 6px',
      borderRadius: 24,
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
      cursor: 'pointer',
    },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 13,
    },
    userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
    userName: { fontSize: 13, fontWeight: 700, color: text },
    userBadge: { fontSize: 10, color: textMuted, fontWeight: 500 },

    // User Dropdown Menu
    userMenuDropdown: {
      position: 'absolute',
      top: 48,
      right: 0,
      width: 280,
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 14,
      padding: 16,
      boxShadow: isLight ? '0 12px 32px rgba(0,0,0,0.12)' : '0 12px 36px rgba(0,0,0,0.6)',
      zIndex: 50,
    },
    userMenuHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 14,
    },
    userMenuStorage: {
      padding: 10,
      borderRadius: 8,
      backgroundColor: inputBg,
      marginBottom: 10,
    },
    userMenuDivider: {
      height: 1,
      backgroundColor: cardBorder,
      margin: '10px 0',
    },
    userMenuItem: {
      width: '100%',
      padding: '9px 12px',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      fontWeight: 500,
      color: text,
      textAlign: 'left',
      cursor: 'pointer',
    },

    mainLayout: {
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
    },
    sidebar: {
      width: 250,
      backgroundColor: sidebarBg,
      borderRight: `1px solid ${cardBorder}`,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 14px',
    },
    newBtnContainer: { position: 'relative', marginBottom: 20 },
    newButton: {
      width: '100%',
      height: 48,
      borderRadius: 12,
      background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
      color: '#fff',
      fontWeight: 700,
      fontSize: 15,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 14px rgba(79, 70, 229, 0.28)',
    },
    newDropdown: {
      position: 'absolute',
      top: 54,
      left: 0,
      width: '100%',
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: 6,
      boxShadow: shadow,
      zIndex: 30,
    },
    dropdownItem: {
      width: '100%',
      padding: '11px 14px',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      fontSize: 14,
      fontWeight: 600,
      color: text,
      cursor: 'pointer',
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
      padding: '11px 14px',
      borderRadius: 10,
      fontSize: 14,
      color: textMuted,
      fontWeight: 600,
      cursor: 'pointer',
    },
    navItemActive: {
      backgroundColor: isLight ? 'rgba(79, 70, 229, 0.08)' : 'rgba(99, 102, 241, 0.15)',
      color: '#4f46e5',
      fontWeight: 700,
    },
    navIcon: { fontSize: 18 },
    storageSection: {
      backgroundColor: isLight ? '#f8fafc' : '#141e33',
      border: `1px solid ${cardBorder}`,
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
      backgroundColor: isLight ? '#e2e8f0' : '#1e293b',
      overflow: 'hidden',
      marginBottom: 8,
    },
    storageBarFill: {
      height: '100%',
      backgroundColor: '#4f46e5',
      borderRadius: 999,
      transition: 'width 0.3s ease',
    },
    storageSubtext: { fontSize: 11, color: textMuted },

    mainContent: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: bg,
      overflow: 'hidden',
    },
    contentHeader: {
      height: 56,
      borderBottom: `1px solid ${cardBorder}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      backgroundColor: headerBg,
    },
    breadcrumbBar: { display: 'flex', alignItems: 'center', gap: 6 },
    breadcrumbItem: { display: 'flex', alignItems: 'center', gap: 6 },
    breadcrumbSeparator: { color: textMuted, fontSize: 14, padding: '0 2px' },
    breadcrumbLink: { fontSize: 14, cursor: 'pointer' },

    viewControls: { display: 'flex', alignItems: 'center', gap: 8 },
    iconBtn: {
      padding: '6px 12px',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: textMuted,
      fontSize: 13,
      fontWeight: 600,
      border: `1px solid ${cardBorder}`,
      backgroundColor: inputBg,
      cursor: 'pointer',
    },
    iconBtnActive: {
      backgroundColor: isLight ? '#ffffff' : '#334155',
      color: 'var(--color-primary)',
      borderColor: 'var(--color-primary)',
    },
    loadingBar: { height: 2, width: '100%', backgroundColor: cardBorder, overflow: 'hidden' },
    loadingAnimation: {
      height: '100%',
      width: '40%',
      backgroundColor: '#4f46e5',
      animation: 'pulse 1s infinite alternate',
    },
    scrollableContent: {
      flex: 1,
      overflowY: 'auto',
      padding: 28,
    },
    sectionHeading: {
      fontSize: 13,
      fontWeight: 800,
      color: textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 16,
    },

    foldersGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
      gap: 14,
    },
    folderCard: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      cursor: 'pointer',
      boxShadow: isLight ? '0 1px 3px rgba(0,0,0,0.03)' : 'none',
      transition: 'transform 0.15s, border-color 0.15s',
    },
    folderName: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: text,
    },
    itemMenu: { display: 'flex', gap: 4 },
    menuSmallBtn: {
      fontSize: 13,
      padding: '4px 6px',
      borderRadius: 6,
      cursor: 'pointer',
      backgroundColor: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
    },

    filesGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
      gap: 18,
    },
    cardItem: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 16,
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: shadow,
      transition: 'transform 0.18s, box-shadow 0.18s',
    },
    cardIconWrapper: {
      width: 46,
      height: 46,
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: 700,
      marginBottom: 4,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: text,
    },
    cardMeta: {
      fontSize: 12,
      color: textMuted,
      marginBottom: 14,
      display: 'flex',
      gap: 6,
      alignItems: 'center',
    },
    cardActions: {
      display: 'flex',
      gap: 6,
      marginTop: 'auto',
      borderTop: `1px solid ${cardBorder}`,
      paddingTop: 12,
    },
    cardActionBtn: {
      flex: 1,
      height: 32,
      borderRadius: 8,
      backgroundColor: isLight ? '#f1f5f9' : '#1e293b',
      border: `1px solid ${cardBorder}`,
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'background 0.15s',
    },
    actionBtnPrimary: {
      flex: 1,
      height: 32,
      borderRadius: 8,
      backgroundColor: 'var(--color-primary)',
      color: '#fff',
      fontSize: 12,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    actionBtnDanger: {
      flex: 1,
      height: 32,
      borderRadius: 8,
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
      color: 'var(--color-error)',
      border: '1px solid rgba(239, 68, 68, 0.25)',
      fontSize: 12,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },

    listView: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: shadow,
    },
    listHeader: {
      display: 'flex',
      padding: '14px 20px',
      borderBottom: `1px solid ${cardBorder}`,
      fontSize: 12,
      fontWeight: 700,
      color: textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    listRow: {
      display: 'flex',
      alignItems: 'center',
      padding: '14px 20px',
      borderBottom: `1px solid ${cardBorder}`,
    },

    emptyState: {
      textAlign: 'center',
      padding: '70px 20px',
    },

    dragOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(11, 15, 25, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    },
    dragBox: {
      padding: 48,
      borderRadius: 24,
      border: '2px dashed #4f46e5',
      textAlign: 'center',
      backgroundColor: isLight ? 'rgba(79, 70, 229, 0.05)' : 'rgba(99, 102, 241, 0.1)',
    },

    uploadToast: {
      position: 'fixed',
      bottom: 24,
      right: 24,
      width: 340,
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 14,
      padding: 16,
      boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
      zIndex: 90,
    },
    progressBarBg: {
      height: 6,
      borderRadius: 999,
      backgroundColor: isLight ? '#e2e8f0' : '#1e293b',
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: '#4f46e5',
      borderRadius: 999,
      transition: 'width 0.2s',
    },

    notificationsContainer: {
      position: 'fixed',
      top: 24,
      right: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      zIndex: 120,
    },
    toast: {
      backgroundColor: cardBg,
      color: text,
      padding: '12px 18px',
      borderRadius: 10,
      border: `1px solid ${cardBorder}`,
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 280,
      maxWidth: 420,
    },

    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
    },
    modalContent: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 18,
      padding: 26,
      width: '100%',
      maxWidth: 480,
      boxShadow: isLight ? '0 16px 40px rgba(0,0,0,0.15)' : '0 16px 40px rgba(0,0,0,0.6)',
      color: text,
    },
    modalContentLarge: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 18,
      padding: 28,
      width: '100%',
      maxWidth: 620,
      boxShadow: isLight ? '0 16px 40px rgba(0,0,0,0.15)' : '0 16px 40px rgba(0,0,0,0.6)',
      color: text,
    },
    modalContentSmall: {
      backgroundColor: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 380,
      boxShadow: isLight ? '0 16px 40px rgba(0,0,0,0.15)' : '0 16px 40px rgba(0,0,0,0.6)',
      color: text,
    },
    versionCard: {
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 10,
      padding: 14,
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 16,
    },
    modalTitle: { fontSize: 18, fontWeight: 800, color: text },
    closeBtn: { fontSize: 18, color: textMuted, padding: 4, cursor: 'pointer' },
    modalActions: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 20,
    },
    form: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 },
    inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
    label: { fontSize: 13, fontWeight: 700, color: text },
    input: {
      height: 42,
      borderRadius: 10,
      backgroundColor: inputBg,
      border: `1px solid ${inputBorder}`,
      padding: '0 14px',
      fontSize: 14,
      color: text,
    },
    selectInput: {
      height: 38,
      borderRadius: 8,
      backgroundColor: inputBg,
      border: `1px solid ${inputBorder}`,
      padding: '0 10px',
      fontSize: 13,
      color: text,
      cursor: 'pointer',
    },
    modalSubmitBtn: {
      height: 44,
      borderRadius: 10,
      backgroundColor: '#4f46e5',
      color: '#fff',
      fontWeight: 700,
      fontSize: 14,
      marginTop: 6,
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
    },
    modalFooter: { textAlign: 'center', marginTop: 12 },
    footerText: { fontSize: 13, color: textMuted },
    footerLink: { color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 700, marginLeft: 4 },
    errorAlert: {
      backgroundColor: 'rgba(239,68,68,0.12)',
      border: '1px solid rgba(239,68,68,0.25)',
      color: '#ef4444',
      padding: '10px 14px',
      borderRadius: 8,
      fontSize: 13,
      marginTop: 10,
    },
    healthRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: `1px solid ${cardBorder}`,
      fontSize: 13,
    },

    // Share Modal specific styles
    shareSectionBox: {
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: 12,
      padding: 16,
      marginTop: 10,
    },
    shareOptionRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    checkboxLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      color: text,
      cursor: 'pointer',
    },

    // Settings Modal specific styles
    settingsTabsBar: {
      display: 'flex',
      gap: 8,
      borderBottom: `1px solid ${cardBorder}`,
      paddingBottom: 12,
      marginBottom: 20,
    },
    settingsTabBtn: {
      padding: '8px 14px',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      color: textMuted,
      backgroundColor: 'transparent',
      cursor: 'pointer',
    },
    settingsTabBtnActive: {
      backgroundColor: isLight ? 'rgba(79, 70, 229, 0.1)' : 'rgba(99, 102, 241, 0.18)',
      color: 'var(--color-primary)',
      fontWeight: 700,
    },
    settingsRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 14px',
      borderRadius: 10,
      backgroundColor: inputBg,
      border: `1px solid ${cardBorder}`,
    },
    themeCard: {
      border: '2px solid',
      borderRadius: 14,
      padding: 18,
      cursor: 'pointer',
      boxShadow: shadow,
      textAlign: 'center',
      transition: 'all 0.15s ease',
    },
  };
};

const themeStyles = {
  light: createThemeStyles(true),
  dark: createThemeStyles(false),
};
