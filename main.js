const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const archiver = require('archiver');

let mainWindow;
let tempDir;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 780,
        minHeight: 600,
        backgroundColor: '#393E41',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    cleanupTemp();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Helpers ──────────────────────────────────────────────

function ensureTempDir() {
    tempDir = path.join(os.tmpdir(), `yt-mp3-${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
}

function cleanupTemp() {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200);
}

/**
 * Resolve paths to bundled binaries.
 * In packaged app: process.resourcesPath/bin/
 * In dev mode: __dirname/bin/ (fallback to system PATH)
 */
function getBinPath(name) {
    const packed = path.join(process.resourcesPath, 'bin', name);
    if (fs.existsSync(packed)) return packed;

    const local = path.join(__dirname, 'bin', name);
    if (fs.existsSync(local)) return local;

    // Fallback to system PATH
    return name;
}

/**
 * Run yt-dlp as a child process and return stdout.
 * Resolves bundled binary and sets FFMPEG_PATH for audio conversion.
 */
function runYtDlp(args) {
    const ytdlpPath = getBinPath('yt-dlp');
    const ffmpegPath = getBinPath('ffmpeg');
    const ffmpegDir = path.dirname(ffmpegPath);

    return new Promise((resolve, reject) => {
        execFile(ytdlpPath, [...args, '--ffmpeg-location', ffmpegDir], {
            maxBuffer: 50 * 1024 * 1024,
            env: { ...process.env, PATH: `${ffmpegDir}:${process.env.PATH}` },
        }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout);
        });
    });
}

// ── IPC: Fetch Playlist ──────────────────────────────────

ipcMain.handle('fetch-playlist', async (_event, url) => {
    try {
        // Use yt-dlp to dump playlist metadata as JSON (one JSON object per line)
        const stdout = await runYtDlp([
            '--flat-playlist',
            '--dump-json',
            '--no-warnings',
            url,
        ]);

        // Each line of output is a JSON object for one video
        const lines = stdout.trim().split('\n').filter(Boolean);
        const tracks = lines.map((line, index) => {
            const item = JSON.parse(line);
            return {
                id: item.id,
                title: item.title,
                url: `https://www.youtube.com/watch?v=${item.id}`,
                duration: item.duration
                    ? formatDuration(item.duration)
                    : null,
                index: index + 1,
            };
        });

        // Try to get playlist title from first item
        const firstItem = lines.length > 0 ? JSON.parse(lines[0]) : {};
        const playlistTitle = firstItem.playlist_title || firstItem.playlist || 'Playlist';

        return { success: true, title: playlistTitle, tracks };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── IPC: Download Playlist ───────────────────────────────

ipcMain.handle('download-playlist', async (event, tracks) => {
    const dir = ensureTempDir();
    const total = tracks.length;
    let completed = 0;

    for (const track of tracks) {
        const safeTitle = sanitizeFilename(track.title);
        const mp3Path = path.join(dir, `${safeTitle}.mp3`);

        try {
            // Send "downloading" status
            mainWindow.webContents.send('download-progress', {
                trackId: track.id,
                status: 'downloading',
                completed,
                total,
                title: track.title,
            });

            // Download and convert to 192kbps MP3 in one step with yt-dlp + ffmpeg
            await runYtDlp([
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K',
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '-o', mp3Path,
                track.url,
            ]);

            // yt-dlp may append extra extensions; find the actual output file
            if (!fs.existsSync(mp3Path)) {
                // Check for common yt-dlp output patterns
                const files = fs.readdirSync(dir).filter(f =>
                    f.startsWith(safeTitle) && f.endsWith('.mp3')
                );
                if (files.length > 0) {
                    const actualPath = path.join(dir, files[0]);
                    if (actualPath !== mp3Path) {
                        fs.renameSync(actualPath, mp3Path);
                    }
                }
            }

            completed++;
            mainWindow.webContents.send('download-progress', {
                trackId: track.id,
                status: 'done',
                completed,
                total,
                title: track.title,
            });
        } catch (err) {
            completed++;
            mainWindow.webContents.send('download-progress', {
                trackId: track.id,
                status: 'error',
                completed,
                total,
                title: track.title,
                error: err.message,
            });
        }
    }

    return { success: true, completed, total };
});

// ── IPC: Save ZIP ────────────────────────────────────────

ipcMain.handle('save-zip', async () => {
    if (!tempDir || !fs.existsSync(tempDir)) {
        return { success: false, error: 'No downloaded files found.' };
    }

    const mp3Files = fs.readdirSync(tempDir).filter((f) => f.endsWith('.mp3'));
    if (mp3Files.length === 0) {
        return { success: false, error: 'No MP3 files to bundle.' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Playlist as ZIP',
        defaultPath: path.join(app.getPath('downloads'), 'playlist.zip'),
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (canceled || !filePath) {
        return { success: false, error: 'Save cancelled.' };
    }

    return new Promise((resolve) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 5 } });

        output.on('close', () => {
            cleanupTemp();
            resolve({ success: true, path: filePath, size: archive.pointer() });
        });

        archive.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        archive.on('progress', (progress) => {
            mainWindow.webContents.send('zip-progress', {
                entriesProcessed: progress.entries.processed,
                entriesTotal: progress.entries.total,
            });
        });

        archive.pipe(output);

        for (const file of mp3Files) {
            archive.file(path.join(tempDir, file), { name: file });
        }

        archive.finalize();
    });
});
