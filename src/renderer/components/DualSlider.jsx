import React, { useState, useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

/**
 * A dual-dot slider mapped from 0 to totalMs.
 * Allows scrubbing both ends with millisecond precision visually.
 * On demand, it can load a WaveSurfer instance to preview the actual audio.
 */
export default function DualSlider({ url, totalMs, startMs, endMs, onChange }) {
    const trackRef = useRef(null);
    const waveformRef = useRef(null);

    // Fallback slider state
    const [dragging, setDragging] = useState(null); // 'start' or 'end'

    // WaveSurfer state
    const [audioData, setAudioData] = useState(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    // Refs for plugin access
    const wsRef = useRef(null);
    const wsRegionsRef = useRef(null);

    // ── FALLBACK CUSTOM SLIDER LOGIC ────────────────────────────────

    const handlePointerDown = (type) => (e) => {
        setDragging(type);
        e.preventDefault();
    };

    const handlePointerUp = () => setDragging(null);

    const handlePointerMove = (e) => {
        if (!dragging || !trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        let percentage = (e.clientX - rect.left) / rect.width;
        percentage = Math.max(0, Math.min(1, percentage));

        const newMs = Math.round(percentage * totalMs);

        if (dragging === 'start') {
            const safeMs = Math.min(newMs, totalMs - endMs - 100);
            onChange('trimStartMs', Math.max(0, safeMs));
        } else if (dragging === 'end') {
            const msFromRight = totalMs - newMs;
            const safeMsFromRight = Math.min(msFromRight, totalMs - startMs - 100);
            onChange('trimEndMs', Math.max(0, safeMsFromRight));
        }
    };

    const handleInputChange = (field) => (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) return;

        const newMs = Math.round(val * 1000);
        if (field === 'start') {
            const safeMs = Math.min(newMs, totalMs - endMs - 1);
            onChange('trimStartMs', Math.max(0, safeMs));
        } else {
            const safeMs = Math.min(newMs, totalMs - startMs - 1);
            onChange('trimEndMs', Math.max(0, safeMs));
        }
    };

    useEffect(() => {
        if (dragging) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        } else {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [dragging, startMs, endMs, totalMs]);

    // ── WAVESURFER LOGIC ───────────────────────────────────────

    const loadAudio = async () => {
        if (!url) return;
        setIsLoadingAudio(true);
        try {
            const res = await window.electronAPI.fetchAudio(url);
            if (res.success && res.base64) {
                setAudioData(res.base64);
            } else {
                console.error("Failed to load audio:", res.error);
            }
        } catch (e) {
            console.error("Error fetching audio:", e);
        }
        setIsLoadingAudio(false);
    };

    // Mount WaveSurfer once audioData is available
    useEffect(() => {
        if (!audioData || !waveformRef.current) return;

        const ws = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: '#444',
            progressColor: '#eebb4d',
            cursorColor: '#fff',
            barWidth: 2,
            barGap: 1,
            height: 60,
            url: audioData,
        });

        const wsRegions = ws.registerPlugin(RegionsPlugin.create());
        wsRef.current = ws;
        wsRegionsRef.current = wsRegions;

        ws.on('decode', () => {
            wsRegions.addRegion({
                start: startMs / 1000,
                end: (totalMs - endMs) / 1000,
                color: 'rgba(238, 187, 77, 0.4)',
                drag: false, // Prevent moving the entire region box
                resize: true, // Allow resizing edges
                id: 'trim-region'
            });
        });

        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));

        // When user drags region handles, sync with our React state
        wsRegions.on('region-updated', (region) => {
            const newStartMs = Math.round(region.start * 1000);
            const newEndMs = Math.round(totalMs - (region.end * 1000));
            // Only fire onChange if there's a real difference 
            if (Math.abs(newStartMs - startMs) > 50 || Math.abs(newEndMs - endMs) > 50) {
                onChange('trimStartMs', Math.max(0, newStartMs));
                onChange('trimEndMs', Math.max(0, newEndMs));
            }
        });

        // Ensure playback stops when the cursor leaves the cropped region
        ws.on('timeupdate', (currentTime) => {
            const currentEndSec = (totalMs - endMs) / 1000;
            if (currentTime >= currentEndSec) {
                ws.pause();
                ws.seekTo((startMs / 1000) / (totalMs / 1000)); // Reset to start of region
            }
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
            wsRegionsRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioData]);

    // Sync external state changes (like someone typing in the inputs) to the active region
    useEffect(() => {
        if (!wsRegionsRef.current) return;
        const region = wsRegionsRef.current.getRegions()[0];
        if (region) {
            const expectedStart = startMs / 1000;
            const expectedEnd = (totalMs - endMs) / 1000;
            // Prevent feedback loops with small rounding errors
            if (Math.abs(region.start - expectedStart) > 0.1 || Math.abs(region.end - expectedEnd) > 0.1) {
                region.setOptions({
                    start: expectedStart,
                    end: expectedEnd
                });
            }
        }
    }, [startMs, endMs, totalMs]);

    const togglePlay = () => {
        if (wsRef.current) {
            const regionStart = startMs / 1000;
            const currentScrub = wsRef.current.getCurrentTime();

            // If they are paused and playing from outside the region, snap them back to the region start!
            if (!isPlaying && (currentScrub < regionStart || currentScrub >= ((totalMs - endMs) / 1000))) {
                wsRef.current.seekTo(regionStart / (totalMs / 1000));
            }
            wsRef.current.playPause();
        }
    };


    // ── RENDER HELPERS ───────────────────────────────────────

    const formatMs = (ms) => {
        const totalSecs = ms / 1000;
        const mins = Math.floor(totalSecs / 60);
        const secs = Math.floor(totalSecs % 60);
        const msecs = Math.floor((ms % 1000));
        return `${mins}:${secs.toString().padStart(2, '0')}.${msecs.toString().padStart(3, '0')}`;
    };

    const startPct = ((startMs / totalMs) * 100) || 0;
    const endPct = ((endMs / totalMs) * 100) || 0;

    return (
        <div style={{ padding: '8px 0', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.7em', color: '#eebb4d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Cut</span>
                    <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={((startMs || 0) / 1000).toFixed(3)}
                        onChange={handleInputChange('start')}
                        style={{ width: '65px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '4px', borderRadius: '4px', fontSize: '11px', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.7em', opacity: 0.5 }}>sec</span>
                </div>

                {audioData && (
                    <button
                        onClick={togglePlay}
                        style={{
                            background: isPlaying ? '#222' : '#eebb4d',
                            color: isPlaying ? '#eebb4d' : '#111',
                            border: 'none',
                            padding: '4px 16px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            textTransform: 'uppercase'
                        }}>
                        {isPlaying ? '⏸ Pause' : '▶ Play Selection'}
                    </button>
                )}

                {!audioData && (
                    <button
                        onClick={loadAudio}
                        disabled={isLoadingAudio}
                        style={{
                            background: '#222', border: '1px solid #444', color: '#ccc',
                            padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
                            cursor: isLoadingAudio ? 'not-allowed' : 'pointer'
                        }}>
                        {isLoadingAudio ? 'Downloading Audio...' : 'Load Audio Preview'}
                    </button>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.7em', color: '#eebb4d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End Cut</span>
                    <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={((endMs || 0) / 1000).toFixed(3)}
                        onChange={handleInputChange('end')}
                        style={{ width: '65px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '4px', borderRadius: '4px', fontSize: '11px', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.7em', opacity: 0.5 }}>sec</span>
                </div>
            </div>

            {audioData ? (
                /* WAVESURFER CONTAINER */
                <div
                    ref={waveformRef}
                    style={{
                        width: '100%',
                        background: '#111',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        border: '1px solid #333'
                    }}
                />
            ) : (
                /* FALLBACK CUSTOM SLIDER */
                <div
                    ref={trackRef}
                    style={{
                        position: 'relative',
                        height: '10px',
                        background: '#222',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        marginTop: '8px'
                    }}
                >
                    {/* Selected Area Background */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${startPct}%`,
                        right: `${endPct}%`,
                        background: '#eebb4d',
                        opacity: 0.5,
                        borderRadius: '5px'
                    }} />

                    {/* Start Handle */}
                    <div
                        onPointerDown={handlePointerDown('start')}
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: `${startPct}%`,
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: '#fff',
                            transform: 'translate(-50%, -50%)',
                            cursor: 'grab',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                            zIndex: 2
                        }}
                    />

                    {/* End Handle */}
                    <div
                        onPointerDown={handlePointerDown('end')}
                        style={{
                            position: 'absolute',
                            top: '50%',
                            right: `${endPct}%`,
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: '#fff',
                            transform: 'translate(50%, -50%)',
                            cursor: 'grab',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                            zIndex: 2
                        }}
                    />
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', fontSize: '0.75em', marginTop: '4px', opacity: 0.6 }}>
                Resulting Track: <strong style={{ color: '#fff', marginLeft: '4px' }}>{formatMs(totalMs - startMs - endMs)}</strong>
            </div>
        </div>
    );
}
