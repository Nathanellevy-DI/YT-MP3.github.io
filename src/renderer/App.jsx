import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import PlaylistInput from './components/PlaylistInput';
import TrackList from './components/TrackList';
import ProgressPanel from './components/ProgressPanel';

const PHASE = {
    INPUT: 'input',
    FETCHING: 'fetching',
    READY: 'ready',
    DOWNLOADING: 'downloading',
    ZIPPING: 'zipping',
    COMPLETE: 'complete',
};

export default function App() {
    const [phase, setPhase] = useState(PHASE.INPUT);
    const [playlistTitle, setPlaylistTitle] = useState('');
    const [tracks, setTracks] = useState([]);
    const [trackStatuses, setTrackStatuses] = useState({});
    const [completed, setCompleted] = useState(0);
    const [total, setTotal] = useState(0);
    const [currentTrack, setCurrentTrack] = useState('');
    const [error, setError] = useState('');
    const [savedPath, setSavedPath] = useState('');

    // ── IPC Listeners ────────────────────────────────
    useEffect(() => {
        const removeProgress = window.electronAPI.onProgress((data) => {
            setTrackStatuses((prev) => ({ ...prev, [data.trackId]: data.status }));
            setCompleted(data.completed);
            setTotal(data.total);
            setCurrentTrack(
                data.status === 'done' || data.status === 'error' ? '' : data.title
            );
        });

        const removeZip = window.electronAPI.onZipProgress(() => {
            // ZIP progress events — could update UI if needed
        });

        return () => {
            removeProgress();
            removeZip();
        };
    }, []);

    // ── Fetch Playlist ───────────────────────────────
    const handleFetch = useCallback(async (url) => {
        setError('');
        setPhase(PHASE.FETCHING);

        const result = await window.electronAPI.fetchPlaylist(url);

        if (result.success) {
            setPlaylistTitle(result.title);
            setTracks(result.tracks);
            setTrackStatuses({});
            setPhase(PHASE.READY);
        } else {
            setError(result.error || 'Failed to fetch playlist.');
            setPhase(PHASE.INPUT);
        }
    }, []);

    // ── Download All ─────────────────────────────────
    const handleDownload = useCallback(async () => {
        setError('');
        setPhase(PHASE.DOWNLOADING);
        setCompleted(0);
        setTotal(tracks.length);
        setCurrentTrack('');

        const result = await window.electronAPI.downloadPlaylist(tracks);

        if (result.success) {
            setPhase(PHASE.ZIPPING);
            const zipResult = await window.electronAPI.saveZip();

            if (zipResult.success) {
                setSavedPath(zipResult.path);
                setPhase(PHASE.COMPLETE);
            } else {
                setError(zipResult.error || 'Failed to save ZIP.');
                setPhase(PHASE.READY);
            }
        } else {
            setError(result.error || 'Download failed.');
            setPhase(PHASE.READY);
        }
    }, [tracks]);

    // ── Reset ────────────────────────────────────────
    const handleReset = useCallback(() => {
        setPhase(PHASE.INPUT);
        setPlaylistTitle('');
        setTracks([]);
        setTrackStatuses({});
        setCompleted(0);
        setTotal(0);
        setCurrentTrack('');
        setError('');
        setSavedPath('');
    }, []);

    // ── Render ───────────────────────────────────────
    const isProcessing =
        phase === PHASE.DOWNLOADING || phase === PHASE.ZIPPING;

    return (
        <div className="app">
            <Header />
            <main className="main">
                {/* URL Input */}
                <PlaylistInput
                    onFetch={handleFetch}
                    loading={phase === PHASE.FETCHING}
                    disabled={isProcessing || phase === PHASE.COMPLETE}
                />

                {/* Error */}
                {error && (
                    <div className="status-msg status-msg--error fade-in">
                        ⚠ {error}
                    </div>
                )}

                {/* Track List */}
                {tracks.length > 0 && phase !== PHASE.COMPLETE && (
                    <TrackList
                        tracks={tracks}
                        trackStatuses={trackStatuses}
                        playlistTitle={playlistTitle}
                    />
                )}

                {/* Progress Panel */}
                {isProcessing && (
                    <ProgressPanel
                        completed={completed}
                        total={total}
                        currentTrack={
                            phase === PHASE.ZIPPING ? 'Creating ZIP archive…' : currentTrack
                        }
                    />
                )}

                {/* Actions */}
                {phase === PHASE.READY && (
                    <div className="actions fade-in">
                        <button className="btn btn--ghost" onClick={handleReset}>
                            ← Start Over
                        </button>
                        <button className="btn btn--secondary" onClick={handleDownload}>
                            ⬇ Download All as MP3
                        </button>
                    </div>
                )}

                {/* Complete */}
                {phase === PHASE.COMPLETE && (
                    <div className="card complete fade-in">
                        <div className="complete__icon">✓</div>
                        <h2>All Done!</h2>
                        <p>
                            {tracks.length} track{tracks.length !== 1 ? 's' : ''} saved
                            as MP3 in a ZIP archive.
                        </p>
                        {savedPath && (
                            <p style={{ fontSize: 12, opacity: 0.6, wordBreak: 'break-all' }}>
                                {savedPath}
                            </p>
                        )}
                        <button className="btn btn--primary" onClick={handleReset}>
                            ↻ Download Another Playlist
                        </button>
                    </div>
                )}

                {/* Empty State */}
                {phase === PHASE.INPUT && tracks.length === 0 && !error && (
                    <div className="empty-state fade-in">
                        <div className="empty-state__icon">📋</div>
                        <h3>Paste a YouTube Playlist URL</h3>
                        <p>
                            The app will fetch all video titles, convert them to 192kbps
                            MP3, and bundle everything into a single ZIP.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
