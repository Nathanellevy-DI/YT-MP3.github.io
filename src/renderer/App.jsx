import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import PlaylistInput from './components/PlaylistInput';
import TrackList from './components/TrackList';
import ProgressPanel from './components/ProgressPanel';
import FormatSelection from './components/FormatSelection';
import ArtworkSelection from './components/ArtworkSelection';

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

    const [format, setFormat] = useState('12_black');
    const [quantity, setQuantity] = useState(1);
    const [jacketFront, setJacketFront] = useState(null);
    const [jacketBack, setJacketBack] = useState(null);
    const [diskFront, setDiskFront] = useState(null);
    const [diskBack, setDiskBack] = useState(null);
    const [labelA, setLabelA] = useState(null);
    const [labelB, setLabelB] = useState(null);

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
            // Initialize tracks with 0 trimStartMs, trimEndMs, and assign default sides (A for first half, B for second)
            const midpoint = Math.ceil(result.tracks.length / 2);
            const initializedTracks = result.tracks.map((t, index) => ({
                ...t,
                trimStartMs: 0,
                trimEndMs: 0,
                side: index < midpoint ? 'A' : 'B'
            }));
            setTracks(initializedTracks);
            setTrackStatuses({});
            setPhase(PHASE.READY);
        } else {
            setError(result.error || 'Failed to fetch playlist.');
            setPhase(PHASE.INPUT);
        }
    }, []);

    const handleTrackChange = useCallback((id, field, value) => {
        setTracks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
    }, []);

    const handleTrackSideChange = useCallback((id, newSide) => {
        setTracks(prev => prev.map(t => t.id === id ? { ...t, side: newSide } : t));
    }, []);

    const handleTrackMove = useCallback((id, direction) => {
        setTracks(prev => {
            const index = prev.findIndex(t => t.id === id);
            if (index < 0) return prev;

            const targetTrack = prev[index];
            // Find all tracks on the same side
            const sideTracks = prev.filter(t => t.side === targetTrack.side);
            const sideIndex = sideTracks.findIndex(t => t.id === id);

            if (direction === 'up' && sideIndex > 0) {
                const swapWithId = sideTracks[sideIndex - 1].id;
                const prevIndex = prev.findIndex(t => t.id === swapWithId);
                const newTracks = [...prev];
                // Swap in the main array to preserve global order memory
                [newTracks[index], newTracks[prevIndex]] = [newTracks[prevIndex], newTracks[index]];
                return newTracks;
            } else if (direction === 'down' && sideIndex < sideTracks.length - 1) {
                const swapWithId = sideTracks[sideIndex + 1].id;
                const nextIndex = prev.findIndex(t => t.id === swapWithId);
                const newTracks = [...prev];
                [newTracks[index], newTracks[nextIndex]] = [newTracks[nextIndex], newTracks[index]];
                return newTracks;
            }
            return prev;
        });
    }, []);

    // ── Download All ─────────────────────────────────
    const handleDownload = useCallback(async () => {
        setError('');
        setPhase(PHASE.DOWNLOADING);
        setCompleted(0);
        setTotal(tracks.length);
        setCurrentTrack('');

        const result = await window.electronAPI.downloadPlaylist({
            tracks,
            format,
            quantity,
            jacketFront,
            jacketBack,
            diskFront,
            diskBack,
            labelA,
            labelB
        });

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
    }, [tracks, format, quantity, jacketFront, jacketBack, diskFront, diskBack, labelA, labelB]);

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
                    <>
                        <FormatSelection
                            format={format} setFormat={setFormat}
                            quantity={quantity} setQuantity={setQuantity}
                        />

                        <ArtworkSelection
                            title={format === '7_inch' ? 'Jacket Front Artwork (2185x2185)' : 'Outer Jacket Front (3675x3675)'}
                            targetSize={format === '7_inch' ? 2185 : 3675}
                            tracks={tracks}
                            onArtworkProcessed={setJacketFront}
                        />

                        <ArtworkSelection
                            title={format === '7_inch' ? 'Jacket Back Artwork (2185x2185)' : 'Outer Jacket Back (3675x3675)'}
                            targetSize={format === '7_inch' ? 2185 : 3675}
                            tracks={tracks}
                            onArtworkProcessed={setJacketBack}
                        />

                        {format !== '12_color' && (
                            <>
                                <ArtworkSelection
                                    title="Record Label A (1200x1200)"
                                    targetSize={1200}
                                    shape="label"
                                    onArtworkProcessed={setLabelA}
                                />
                                <ArtworkSelection
                                    title="Record Label B (1200x1200)"
                                    targetSize={1200}
                                    shape="label"
                                    onArtworkProcessed={setLabelB}
                                />
                            </>
                        )}

                        {format === '12_color' && (
                            <>
                                <ArtworkSelection
                                    title="Picture Disk Front (3540x3540)"
                                    targetSize={3540}
                                    shape="disk"
                                    onArtworkProcessed={setDiskFront}
                                />
                                <ArtworkSelection
                                    title="Picture Disk Back (3540x3540)"
                                    targetSize={3540}
                                    shape="disk"
                                    onArtworkProcessed={setDiskBack}
                                />
                            </>
                        )}

                        <TrackList
                            tracks={tracks}
                            trackStatuses={trackStatuses}
                            playlistTitle={playlistTitle}
                            onTrackChange={handleTrackChange}
                            onTrackMove={handleTrackMove}
                            onTrackSideChange={handleTrackSideChange}
                        />
                    </>
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
