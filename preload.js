const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ── Invoke (renderer → main) ──
    fetchPlaylist: (url) => ipcRenderer.invoke('fetch-playlist', url),
    downloadPlaylist: (tracks) => ipcRenderer.invoke('download-playlist', tracks),
    saveZip: () => ipcRenderer.invoke('save-zip'),

    // ── Listen (main → renderer) ──
    onProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
    },

    onZipProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('zip-progress', handler);
        return () => ipcRenderer.removeListener('zip-progress', handler);
    },
});
