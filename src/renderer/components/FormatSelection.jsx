import React from 'react';

export default function FormatSelection({ format, setFormat, quantity, setQuantity }) {
    const formats = [
        { id: '12_black', label: '12-inch Black Vinyl ($36.00)', price: 36.00 },
        { id: '12_color', label: '12-inch Color/Picture Disc ($50.00)', price: 50.00 },
        { id: '7_inch', label: '7-inch Vinyl ($15.00)', price: 15.00 }
    ];

    const currentFormat = formats.find(f => f.id === format) || formats[0];
    const totalCost = (currentFormat.price * quantity) + 10.00; // $10 shipping placeholder

    return (
        <div className="card fade-in" style={{ marginBottom: '1rem' }}>
            <div className="format-selection__header">
                <h2>Vinyl Format & Pricing</h2>
            </div>
            <div className="format-options">
                {formats.map(f => (
                    <label key={f.id} className="radio-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                        <input
                            type="radio"
                            name="vinylFormat"
                            value={f.id}
                            checked={format === f.id}
                            onChange={(e) => setFormat(e.target.value)}
                            style={{ marginRight: '8px' }}
                        />
                        {f.label}
                    </label>
                ))}
            </div>
            <div className="pricing-section" style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label>
                    Quantity:
                    <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{ marginLeft: '8px', width: '60px', padding: '4px' }}
                    />
                </label>
                <div className="total-cost" style={{ fontWeight: 'bold' }}>
                    Estimated Cost (inc. $10 shipping): ${totalCost.toFixed(2)}
                </div>
            </div>
        </div>
    );
}
