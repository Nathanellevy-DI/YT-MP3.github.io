import React, { useState } from 'react';

export default function PlaylistInput({ onFetch, loading, disabled }) {
    const [url, setUrl] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (url.trim()) onFetch(url.trim());
    };

    return (
        <div className="card input-section fade-in">
            <label htmlFor="playlist-url">Playlist URL</label>
            <form className="input-row" onSubmit={handleSubmit}>
                <input
                    id="playlist-url"
                    className="input-field"
                    type="url"
                    placeholder="https://www.youtube.com/playlist?list=..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={disabled}
                    autoFocus
                />
                <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={!url.trim() || loading || disabled}
                >
                    {loading ? (
                        <>
                            <span className="spinner" /> Fetching…
                        </>
                    ) : (
                        <>🔍 Fetch Playlist</>
                    )}
                </button>
            </form>
        </div>
    );
}
