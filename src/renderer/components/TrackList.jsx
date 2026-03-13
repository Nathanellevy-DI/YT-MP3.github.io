import React from 'react';

const statusIcons = {
    pending: '○',
    downloading: '⬇',
    converting: '⟳',
    done: '✓',
    error: '✕',
};

function Track({ track, status }) {
    const state = status || 'pending';

    return (
        <div className="track">
            <span className="track__number">{track.index}</span>
            <span className="track__title">{track.title}</span>
            {track.duration && (
                <span className="track__duration">{track.duration}</span>
            )}
            <span className={`track__status track__status--${state}`}>
                {statusIcons[state]}
            </span>
        </div>
    );
}

export default function TrackList({ tracks, trackStatuses, playlistTitle }) {
    if (!tracks || tracks.length === 0) return null;

    return (
        <div className="card fade-in">
            <div className="tracklist__header">
                <h2>{playlistTitle || 'Playlist'}</h2>
                <span className="tracklist__count">{tracks.length} tracks</span>
            </div>
            <div className="tracklist">
                {tracks.map((track) => (
                    <Track
                        key={track.id}
                        track={track}
                        status={trackStatuses[track.id]}
                    />
                ))}
            </div>
        </div>
    );
}
