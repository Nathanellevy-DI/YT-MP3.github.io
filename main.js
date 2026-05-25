const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
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
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? `${name}.exe` : name;

    const packed = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(packed)) return packed;

    const platformDir = isWin ? 'win' : 'mac';
    const local = path.join(__dirname, 'bin', platformDir, binaryName);
    if (fs.existsSync(local)) return local;

    // Fallback to system PATH
    return binaryName;
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
            env: { ...process.env, PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH}` },
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
                duration: item.duration
                    ? formatDuration(item.duration)
                    : null,
                rawDuration: item.duration,
                // Use maxresdefault for highest quality YouTube thumbnail (1920x1080)
                thumbnail: item.id
                    ? `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`
                    : (item.thumbnails && item.thumbnails.length > 0
                        ? item.thumbnails[item.thumbnails.length - 1].url
                        : item.thumbnail || null),
                url: item.webpage_url || `https://www.youtube.com/watch?v=${item.id}`,
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

// ── IPC: Fetch Image Proxy ───────────────────────────────
ipcMain.handle('fetch-image', async (event, url) => {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                return resolve({ success: false, error: `Status Code: ${res.statusCode}` });
            }

            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                const contentType = res.headers['content-type'] || 'image/jpeg';
                const base64 = buffer.toString('base64');
                resolve({ success: true, base64: `data:${contentType};base64,${base64}` });
            });
        }).on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
});

// ── IPC: Fetch Audio Stream ──────────────────────────────
ipcMain.handle('fetch-audio', async (event, url) => {
    return new Promise((resolve) => {
        const tempDir = ensureTempDir();
        const outputFilename = path.join(tempDir, `preview_${Date.now()}.mp3`);

        console.log(`[fetch-audio] Starting download for preview: ${url}`);
        const ytdlpPath = getBinPath('yt-dlp');
        const ytDlpProcess = spawn(ytdlpPath, [
            url,
            '-f', 'bestaudio',
            '--extract-audio',
            '--audio-format', 'mp3',
            '-o', outputFilename,
        ]);

        let errorLog = '';
        ytDlpProcess.stderr.on('data', (data) => {
            errorLog += data.toString();
        });

        ytDlpProcess.on('close', (code) => {
            console.log(`[fetch-audio] Process exited with code ${code}`);
            if (code === 0 && fs.existsSync(outputFilename)) {
                try {
                    console.log(`[fetch-audio] File exists, reading buffer...`);
                    const buffer = fs.readFileSync(outputFilename);
                    const base64 = buffer.toString('base64');
                    // We can resolve with a data URI to play in wavesurfer natively
                    resolve({ success: true, base64: `data:audio/mp3;base64,${base64}` });
                    // Optionally delete the temp file immediately since we've buffered it
                    try { fs.unlinkSync(outputFilename); } catch (e) { }
                } catch (e) {
                    console.error(`[fetch-audio] Buffer error:`, e);
                    resolve({ success: false, error: e.message });
                }
            } else {
                console.error(`[fetch-audio] Failure. Code: ${code}. File exists: ${fs.existsSync(outputFilename)}. Log: ${errorLog}`);
                resolve({ success: false, error: `Failed to download audio preview. Log: ${errorLog}` });
            }
        });
    });
});

// ── Helpers: DPI Patching ────────────────────────────────
/**
 * Patches a JPEG buffer to set the DPI to 300x300 in the JFIF header.
 * Kunaki requires 300 DPI exactly.
 */
function setJpegDpi(buffer, dpi = 300) {
    // JFIF header usually starts at byte 6: 'J', 'F', 'I', 'F', '\0'
    // Byte 13: units (1 = dots per inch, 2 = dots per cm)
    // Byte 14-15: X_density
    // Byte 16-17: Y_density
    const marker = buffer.indexOf(Buffer.from('JFIF\0'));
    if (marker !== -1) {
        buffer.writeUInt8(1, marker + 7); // Set units to dots per inch
        buffer.writeUInt16BE(dpi, marker + 8); // X
        buffer.writeUInt16BE(dpi, marker + 10); // Y
    }
    return buffer;
}

// ── IPC: Download Playlist ───────────────────────────────

ipcMain.handle('download-playlist', async (event, data) => {
    // Handle either old signature (just an array) or new signature (object)
    const tracks = Array.isArray(data) ? data : data.tracks;
    const { format, jacketFront, jacketBack, diskFront, diskBack, labelA, labelB } = Array.isArray(data) ? {} : data;

    const dir = ensureTempDir();
    const total = tracks.length;
    let completed = 0;

    // Helper to save base64 string buffer
    const saveImage = (base64, filename) => {
        if (!base64) return;
        try {
            // Strip the data URI prefix if present (e.g. "data:image/jpeg;base64,")
            let rawBase64 = base64;
            if (rawBase64.includes(',')) {
                rawBase64 = rawBase64.split(',')[1];
            }
            const buffer = Buffer.from(rawBase64, 'base64');
            const patchedBuffer = setJpegDpi(buffer, 300);
            const filePath = path.join(dir, filename);
            fs.writeFileSync(filePath, patchedBuffer);
            console.log(`[saveImage] Saved ${filename} (${patchedBuffer.length} bytes) to ${filePath}`);
        } catch (err) {
            console.error(`[saveImage] Failed to save ${filename}:`, err);
        }
    };

    saveImage(jacketFront, 'Jacket Front Sleeve.jpg');
    saveImage(jacketBack, 'Jacket Back Sleeve.jpg');
    saveImage(diskFront, 'Picture Disk Front.jpg');
    saveImage(diskBack, 'Picture Disk Back.jpg');
    saveImage(labelA, 'Record Label A.jpg');
    saveImage(labelB, 'Record Label B.jpg');

    for (const track of tracks) {
        const safeTitle = sanitizeFilename(track.title);
        // Prefix with track index relative to its side
        const mp3Path = path.join(dir, `${track.side}_${track.index.toString().padStart(2, '0')}_${safeTitle}.mp3`);

        try {
            // Send "downloading" status
            mainWindow.webContents.send('download-progress', {
                trackId: track.id,
                status: 'downloading',
                completed,
                total,
                title: track.title,
            });

            // Download and convert to 192kbps MP3
            // Incorporate trimming and padding using ffmpeg post-processor args
            const ytArgs = [
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K',
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '-o', mp3Path,
            ];

            const ppArgs = [];

            // Trim start (milliseconds to seconds)
            if (track.trimStartMs && track.trimStartMs > 0) {
                ppArgs.push('-ss', (track.trimStartMs / 1000).toFixed(3));
            }

            // Trim end and add silence
            let filterArgs = 'apad=pad_dur=2';

            // -to is relative to the START of the original file, so we need:
            // rawDuration - (trimEndMs / 1000)
            if (track.trimEndMs && track.trimEndMs > 0 && track.rawDuration > 0) {
                const toSeconds = track.rawDuration - (track.trimEndMs / 1000);
                if (toSeconds > 0) {
                    ppArgs.push('-to', toSeconds.toFixed(3));
                }
            }

            ppArgs.push('-af', filterArgs);

            if (ppArgs.length > 0) {
                ytArgs.push('--postprocessor-args', ppArgs.join(' '));
            }

            ytArgs.push(track.url);

            await runYtDlp(ytArgs);

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
    const imgFiles = [
        'Jacket Front Sleeve.jpg',
        'Jacket Back Sleeve.jpg',
        'Picture Disk Front.jpg',
        'Picture Disk Back.jpg',
        'Record Label A.jpg',
        'Record Label B.jpg'
    ].filter(f => fs.existsSync(path.join(tempDir, f)));

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
            cleanupTemp();
            resolve({ success: false, error: err.message });
        });

        archive.on('progress', (progress) => {
            mainWindow.webContents.send('zip-progress', {
                entriesProcessed: progress.entries.processed,
                entriesTotal: progress.entries.total,
            });
        });

        archive.pipe(output);

        // Add Audio files in Side A / Side B folders
        let sideAIndex = 1;
        let sideBIndex = 1;

        for (const file of mp3Files) {
            // we encoded the side into the filename `A_01_Title.mp3`
            const side = file.charAt(0);
            const sourcePath = path.join(tempDir, file);

            // Clean up the filename for final display (strip the 'A_' prefix and correct the index)
            // Original format stored in temp: A_01_Original_Yt_Index_Title.mp3
            // Desired format: Audio/Side A/01_Title.mp3

            // Re-indexing is critical here because the user rearranged them.
            const rawTitle = file.replace(/^[AB]_\d+_/, '');

            if (side === 'A') {
                const finalName = `${sideAIndex.toString().padStart(2, '0')}_${rawTitle}`;
                archive.append(fs.createReadStream(sourcePath), { name: `Audio/Side A/${finalName}` });
                sideAIndex++;
            } else if (side === 'B') {
                const finalName = `${sideBIndex.toString().padStart(2, '0')}_${rawTitle}`;
                archive.append(fs.createReadStream(sourcePath), { name: `Audio/Side B/${finalName}` });
                sideBIndex++;
            } else {
                archive.append(fs.createReadStream(sourcePath), { name: `Audio/${file}` });
            }
        }

        // Add Artwork Files
        for (const file of imgFiles) {
            const sourcePath = path.join(tempDir, file);
            archive.append(fs.createReadStream(sourcePath), { name: `Artwork/${file}` });
        }

        archive.finalize();
    });
});
