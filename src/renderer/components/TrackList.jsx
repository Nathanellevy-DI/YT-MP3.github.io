import React from 'react';
import DualSlider from './DualSlider';

const statusIcons = {
    pending: '○',
    downloading: '⬇',
    converting: '⟳',
    done: '✓',
    error: '✕',
};

function Track({ track, status, onChange, onMove, onSideChange, index, totalOnSide }) {
    const state = status || 'pending';

    const startMs = track.trimStartMs || 0;
    const endMs = track.trimEndMs || 0;
    const totalMs = (track.rawDuration || 300) * 1000;

    return (
        <div className="track" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 8px', borderBottom: '1px solid #333' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="track__number" style={{ width: '20px', color: '#888' }}>{index + 1}</span>
                <span className="track__title" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</span>

                {/* Move Controls */}
                <div style={{ display: 'flex', gap: '4px', marginRight: '16px' }}>
                    <button
                        onClick={() => onMove(track.id, 'up')}
                        disabled={index === 0}
                        style={{ background: 'transparent', border: '1px solid #444', color: index === 0 ? '#333' : '#fff', cursor: index === 0 ? 'not-allowed' : 'pointer', padding: '2px 6px', borderRadius: '4px' }}
                    >▲</button>
                    <button
                        onClick={() => onMove(track.id, 'down')}
                        disabled={index === totalOnSide - 1}
                        style={{ background: 'transparent', border: '1px solid #444', color: index === totalOnSide - 1 ? '#333' : '#fff', cursor: index === totalOnSide - 1 ? 'not-allowed' : 'pointer', padding: '2px 6px', borderRadius: '4px' }}
                    >▼</button>
                    <button
                        onClick={() => onSideChange(track.id, track.side === 'A' ? 'B' : 'A')}
                        style={{ background: '#222', border: '1px solid #eebb4d', color: '#eebb4d', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', marginLeft: '8px' }}
                    >
                        Move to Side {track.side === 'A' ? 'B' : 'A'}
                    </button>
                </div>

                {track.duration && (
                    <span className="track__duration" style={{ minWidth: '40px' }}>{track.duration}</span>
                )}
                <span className={`track__status track__status--${state}`} style={{ marginLeft: '12px' }}>
                    {statusIcons[state]}
                </span>
            </div>

            <div style={{ padding: '0 32px 0 28px' }}>
                <DualSlider
                    url={track.url}
                    totalMs={totalMs}
                    startMs={startMs}
                    endMs={endMs}
                    onChange={(field, val) => onChange(track.id, field, val)}
                />
            </div>

        </div>
    );
}

export default function TrackList({ tracks, trackStatuses, playlistTitle, onTrackChange, onTrackMove, onTrackSideChange }) {
    if (!tracks || tracks.length === 0) return null;

    const sideATracks = tracks.filter(t => t.side === 'A');
    const sideBTracks = tracks.filter(t => t.side === 'B');

    return (
        <div className="card fade-in" style={{ padding: '0', background: 'transparent', border: 'none' }}>

            <div style={{ marginBottom: '24px', background: '#1c1c1c', borderRadius: '8px', padding: '16px', border: '1px solid #333' }}>
                <div className="tracklist__header" style={{ borderBottom: '2px solid #eebb4d', paddingBottom: '8px', marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '1.2rem', color: '#fff' }}>Side A</h2>
                    <span className="tracklist__count">{sideATracks.length} tracks</span>
                </div>
                <div className="tracklist">
                    {sideATracks.length === 0 && <div style={{ padding: '12px', color: '#666', fontStyle: 'italic' }}>No tracks on Side A</div>}
                    {sideATracks.map((track, i) => (
                        <Track
                            key={track.id}
                            track={track}
                            index={i}
                            totalOnSide={sideATracks.length}
                            status={trackStatuses[track.id]}
                            onChange={onTrackChange}
                            onMove={onTrackMove}
                            onSideChange={onTrackSideChange}
                        />
                    ))}
                </div>
            </div>

            <div style={{ background: '#1c1c1c', borderRadius: '8px', padding: '16px', border: '1px solid #333' }}>
                <div className="tracklist__header" style={{ borderBottom: '2px solid #eebb4d', paddingBottom: '8px', marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '1.2rem', color: '#fff' }}>Side B</h2>
                    <span className="tracklist__count">{sideBTracks.length} tracks</span>
                </div>
                <div className="tracklist">
                    {sideBTracks.length === 0 && <div style={{ padding: '12px', color: '#666', fontStyle: 'italic' }}>No tracks on Side B</div>}
                    {sideBTracks.map((track, i) => (
                        <Track
                            key={track.id}
                            track={track}
                            index={i}
                            totalOnSide={sideBTracks.length}
                            status={trackStatuses[track.id]}
                            onChange={onTrackChange}
                            onMove={onTrackMove}
                            onSideChange={onTrackSideChange}
                        />
                    ))}
                </div>
            </div>

        </div>
    );
}
