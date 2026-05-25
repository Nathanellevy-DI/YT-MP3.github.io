import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Applies a 3x3 convolution matrix to an ImageData object.
 * Heavily optimized for sharpening.
 */
function applyConvolution(imageData, weights) {
    const side = Math.round(Math.sqrt(weights.length));
    const halfSide = Math.floor(side / 2);
    const src = imageData.data;
    const sw = imageData.width;
    const sh = imageData.height;

    const w = sw;
    const h = sh;
    const output = new ImageData(w, h);
    const dst = output.data;

    const alphaFac = 0; // Opaque

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dstOff = (y * w + x) * 4;
            let r = 0, g = 0, b = 0, a = 0;

            for (let cy = 0; cy < side; cy++) {
                for (let cx = 0; cx < side; cx++) {
                    const scy = y + cy - halfSide;
                    const scx = x + cx - halfSide;

                    if (scy >= 0 && scy < h && scx >= 0 && scx < w) {
                        const srcOff = (scy * w + scx) * 4;
                        const wt = weights[cy * side + cx];
                        r += src[srcOff] * wt;
                        g += src[srcOff + 1] * wt;
                        b += src[srcOff + 2] * wt;
                        a += src[srcOff + 3] * wt;
                    }
                }
            }
            dst[dstOff] = r;
            dst[dstOff + 1] = g;
            dst[dstOff + 2] = b;
            dst[dstOff + 3] = src[dstOff + 3]; // Preserve original alpha
        }
    }
    return output;
}

export default function ArtworkSelection({ title, targetSize, shape, tracks, onArtworkProcessed }) {
    const canvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const containerRef = useRef(null);

    const [imageLoaded, setImageLoaded] = useState(false);
    const [fileName, setFileName] = useState('');
    const [imgObj, setImgObj] = useState(null);

    // Transform State
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    // Filter State
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const [saturation, setSaturation] = useState(100);
    const [sharpness, setSharpness] = useState(0);

    // Viewport Size
    const viewportSize = 450;

    // ────────────────────────────────────────────────────────────
    // Drawing Logic
    // ────────────────────────────────────────────────────────────
    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imgObj) return;
        const ctx = canvas.getContext('2d');

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();

        // CSS Filters (Brightness, Contrast, Saturation)
        ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

        // Draw image with transforms
        ctx.translate(canvas.width / 2 + pos.x, canvas.height / 2 + pos.y);
        ctx.scale(scale, scale);
        ctx.drawImage(imgObj, -imgObj.width / 2, -imgObj.height / 2);

        ctx.restore();

        // Software Sharpening (if > 0)
        if (sharpness > 0) {
            const amount = sharpness / 100;
            // Basic sharpen matrix
            const weights = [
                0, -amount, 0,
                -amount, 1 + 4 * amount, -amount,
                0, -amount, 0
            ];
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const sharpened = applyConvolution(imageData, weights);
            ctx.putImageData(sharpened, 0, 0);
        }

        // Draw Disk Mask (for preview only)
        if (shape === 'disk') {
            ctx.fillStyle = '#222'; // Same as background
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height); // Outer rect
            // Inner circle (drawn counter-clockwise to create a hole)
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2, true);
            ctx.fill();

            // Draw center spindle hole
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.015, 0, Math.PI * 2);
            ctx.fill();

            // Draw subtle border for the edge
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else if (shape === 'label') {
            // Label Preview: A black record with the label in the center
            ctx.fillStyle = '#111'; // Record color
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height); // Outer mask
            // Inner label area (the hole)
            // A 12" record is ~30cm. The label is 4" (~10cm). So label is 1/3 the diameter.
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 6, 0, Math.PI * 2, true);
            ctx.fill();

            // Draw center spindle hole
            ctx.fillStyle = '#222';
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.015, 0, Math.PI * 2);
            ctx.fill();

            // Record grooves (aesthetic)
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 2;
            for (let i = 1; i < 10; i++) {
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2, (canvas.width / 6) + (i * 8), 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Generate full-res byte array output debounced/when done drawing
        generateOutput();
    }, [imgObj, pos, scale, brightness, contrast, saturation, sharpness, targetSize, shape]);

    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    // ────────────────────────────────────────────────────────────
    // Output Generation (Background Canvas)
    // ────────────────────────────────────────────────────────────
    const generateOutput = () => {
        if (!imgObj) return;
        // Native canvas performance is very fast, but for 3000px images we shouldn't do 
        // high-res convolution on every single mouse-move frame.
        // We will scale up the viewport transform to the target size.

        const outCanvas = document.createElement('canvas');
        outCanvas.width = targetSize;
        outCanvas.height = targetSize;
        const outCtx = outCanvas.getContext('2d');

        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

        outCtx.save();
        outCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

        // Scale ratio from viewport to target.
        // For labels, the preview shows the label as a small circle (1/3 diameter)
        // inside a record. The output must map ONLY that label area to the full
        // target size, so we multiply by 3 (viewport / label_diameter).
        const baseRatio = targetSize / viewportSize;
        const ratio = shape === 'label' ? baseRatio * 3 : baseRatio;
        outCtx.translate(outCanvas.width / 2 + (pos.x * ratio), outCanvas.height / 2 + (pos.y * ratio));

        // scale already includes the initial fit (set on image load),
        // so just multiply by ratio to scale up to the target resolution.
        const finalScale = scale * ratio;
        outCtx.scale(finalScale, finalScale);
        outCtx.drawImage(imgObj, -imgObj.width / 2, -imgObj.height / 2);
        outCtx.restore();

        if (sharpness > 0) {
            const amount = sharpness / 100;
            const weights = [
                0, -amount, 0,
                -amount, 1 + 4 * amount, -amount,
                0, -amount, 0
            ];
            const imgData = outCtx.getImageData(0, 0, outCanvas.width, outCanvas.height);
            const sharpened = applyConvolution(imgData, weights);
            outCtx.putImageData(sharpened, 0, 0);
        }

        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.95);
        const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
        onArtworkProcessed(base64Data);
    };

    // ────────────────────────────────────────────────────────────
    // Interactions
    // ────────────────────────────────────────────────────────────
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setFileName(file.name);

        const img = new Image();
        const reader = new FileReader();

        reader.onload = (event) => {
            img.onload = () => {
                setImgObj(img);
                setImageLoaded(true);

                // Auto-fit to fill viewport square
                const s = Math.max(viewportSize / img.width, viewportSize / img.height);
                setScale(s);
                setPos({ x: 0, y: 0 });
                // Reset filters
                setBrightness(100);
                setContrast(100);
                setSaturation(100);
                setSharpness(0);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleThumbnailClick = async () => {
        if (!tracks || tracks.length === 0 || !tracks[0].thumbnail) return;

        try {
            const res = await window.electronAPI.fetchImage(tracks[0].thumbnail);
            if (res.success) {
                const img = new Image();
                img.onload = () => {
                    setImgObj(img);
                    setImageLoaded(true);

                    // Auto-fit to fill viewport square
                    const s = Math.max(viewportSize / img.width, viewportSize / img.height);
                    setScale(s);
                    setPos({ x: 0, y: 0 });
                    setBrightness(100);
                    setContrast(100);
                    setSaturation(100);
                    setSharpness(0);
                };
                img.src = res.base64;
            }
        } catch (err) {
            console.error('Failed to load thumbnail:', err);
        }
    };

    const handlePointerDown = (e) => {
        if (!imageLoaded) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
        e.target.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        if (!isDragging) return;
        setPos({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y
        });
    };

    const handlePointerUp = (e) => {
        setIsDragging(false);
        e.target.releasePointerCapture(e.pointerId);
        // Force an output gen on release
        if (imgObj) generateOutput();
    };

    const handleWheel = (e) => {
        if (!imageLoaded) return;
        e.preventDefault();
        const delta = e.deltaY * -0.001;
        const newScale = Math.min(Math.max(scale + delta, 0.05), 5); // limits
        setScale(newScale);
    };

    return (
        <div className="card fade-in" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2>{title || 'Artwork Editor'}</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {tracks && tracks.length > 0 && tracks[0].thumbnail && (
                        <button
                            className="btn btn--ghost"
                            onClick={handleThumbnailClick}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                        >
                            Use YT Thumbnail
                        </button>
                    )}
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                    />
                    <button
                        className="btn btn--secondary"
                        onClick={() => fileInputRef.current.click()}
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                        {imageLoaded ? 'Change Image' : 'Select Image'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* Canvas Container */}
                <div
                    ref={containerRef}
                    style={{
                        width: viewportSize,
                        height: viewportSize,
                        position: 'relative',
                        border: '2px dashed #444',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        background: '#222',
                        cursor: isDragging ? 'grabbing' : 'grab'
                    }}
                >
                    {imageLoaded ? (
                        <canvas
                            ref={canvasRef}
                            width={viewportSize}
                            height={viewportSize}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onWheel={handleWheel}
                            style={{ display: 'block' }}
                        />
                    ) : (
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#666', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🖼️</div>
                            No image selected
                        </div>
                    )}

                    {imageLoaded && (
                        <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', pointerEvents: 'none' }}>
                            Scroll to Scale, Drag to Pan
                        </div>
                    )}
                </div>

                {/* Filter Controls */}
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '12px', opacity: imageLoaded ? 1 : 0.5 }}>
                    <h3 style={{ margin: 0, fontSize: '14px', borderBottom: '1px solid #333', paddingBottom: '4px' }}>Image Fx / Enhancement</h3>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
                        Brightness ({brightness}%)
                        <input type="range" min="0" max="200" value={brightness} onChange={e => setBrightness(e.target.value)} disabled={!imageLoaded} />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
                        Contrast ({contrast}%)
                        <input type="range" min="0" max="200" value={contrast} onChange={e => setContrast(e.target.value)} disabled={!imageLoaded} />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
                        Saturation ({saturation}%)
                        <input type="range" min="0" max="200" value={saturation} onChange={e => setSaturation(e.target.value)} disabled={!imageLoaded} />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
                        Sharpening ({sharpness}%)
                        <input type="range" min="0" max="100" value={sharpness} onChange={e => setSharpness(e.target.value)} disabled={!imageLoaded} />
                    </label>
                </div>
            </div>
        </div>
    );
}
