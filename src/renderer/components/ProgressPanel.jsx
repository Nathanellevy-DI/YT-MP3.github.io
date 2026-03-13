import React from 'react';

export default function ProgressPanel({ completed, total, currentTrack }) {
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="card progress-panel fade-in">
            <div className="progress-panel__info">
                <span className="progress-panel__label">
                    {completed < total ? 'Processing…' : 'Complete!'}
                </span>
                <span className="progress-panel__percent">{percent}%</span>
            </div>

            <div className="progress-bar">
                <div
                    className="progress-bar__fill"
                    style={{ width: `${percent}%` }}
                />
            </div>

            <div className="progress-panel__info">
                <span className="progress-panel__current">
                    {currentTrack
                        ? `♪ ${currentTrack}`
                        : completed >= total
                            ? 'All tracks processed'
                            : 'Waiting…'}
                </span>
                <span className="progress-panel__label">
                    {completed}/{total}
                </span>
            </div>
        </div>
    );
}
