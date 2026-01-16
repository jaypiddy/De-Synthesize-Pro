import React, { useState, useRef, useEffect } from 'react';
import { AspectRatio } from '../types';

interface ComparisonSliderProps {
  original: string;
  processed: string;
  aspectRatio: AspectRatio;
  zoomScale?: number;
}

const ComparisonSlider: React.FC<ComparisonSliderProps> = ({ original, processed, aspectRatio, zoomScale = 1 }) => {
  const [position, setPosition] = useState(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const getAspectRatioValue = () => {
    const [w, h] = aspectRatio.split(':').map(Number);
    return h / w;
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (zoomScale === 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoomScale]);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return;

    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;

    if (isDraggingSlider) {
      const x = ((clientX - container.left) / container.width) * 100;
      setPosition(Math.min(Math.max(x, 0), 100));
    } else if (isPanning && zoomScale > 1) {
      const dx = clientX - lastMousePos.current.x;
      const dy = clientY - lastMousePos.current.y;
      
      setPan(prev => ({
        x: prev.x + dx,
        y: prev.y + dy
      }));
      
      lastMousePos.current = { x: clientX, y: clientY };
    }
  };

  const startDraggingSlider = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSlider(true);
  };

  const startPanning = (e: React.MouseEvent | React.TouchEvent) => {
    if (zoomScale <= 1 || isDraggingSlider) return;
    setIsPanning(true);
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    lastMousePos.current = { x: clientX, y: clientY };
  };

  const stopAll = () => {
    setIsDraggingSlider(false);
    setIsPanning(false);
  };

  const transformStyle = { 
    transform: `scale(${zoomScale}) translate(${pan.x / zoomScale}px, ${pan.y / zoomScale}px)`,
    transformOrigin: 'center center',
    transition: isPanning ? 'none' : 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
  };

  return (
    <div 
      ref={containerRef}
      className={`relative w-full overflow-hidden border-4 border-kodak-dark select-none bg-kodak-dark group shadow-2xl theme-transition ${zoomScale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      style={{ paddingBottom: `${getAspectRatioValue() * 100}%` }}
      onMouseMove={handleMouseMove}
      onTouchMove={handleMouseMove}
      onMouseDown={startPanning}
      onMouseUp={stopAll}
      onMouseLeave={stopAll}
      onTouchStart={startPanning}
      onTouchEnd={stopAll}
    >
      {/* BACKGROUND LAYER: Developed Image */}
      <div className="absolute inset-0 w-full h-full pointer-events-none" style={transformStyle}>
        <img 
          src={processed} 
          alt="Developed Negative" 
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* OVERLAY LAYER: Original Image */}
      <div 
        className="absolute inset-0 z-10 overflow-hidden pointer-events-none"
        style={{ width: `${position}%` }}
      >
        <div style={{ width: containerWidth, height: '100%', position: 'relative' }}>
          <div className="absolute inset-0 w-full h-full" style={transformStyle}>
            <img 
              src={original} 
              alt="Synthetic Frame" 
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </div>
      </div>

      {/* SLIDER CONTROLS - Highest Priority Z-Index */}
      <div 
        className="absolute top-0 bottom-0 w-1.5 z-50 group/slider"
        style={{ left: `calc(${position}% - 0.75px)`, backgroundColor: 'var(--theme-accent)' }}
      >
        {/* Invisible Hit Area: Extended width for better UX */}
        <div 
           className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-full cursor-col-resize z-[60]"
           onMouseDown={startDraggingSlider}
           onTouchStart={startDraggingSlider}
        />
        
        {/* Visual Handle: Custom Diamond UI */}
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex items-center justify-center pointer-events-none rotate-45 border-4 transition-transform group-hover/slider:scale-110 z-[70]"
          style={{ backgroundColor: 'var(--theme-brand)', borderColor: 'var(--theme-accent)' }}
        >
          <svg className="w-6 h-6 -rotate-45" style={{ color: 'var(--theme-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 7l-4 4m0 0l4 4m-4-4h18" />
          </svg>
        </div>
      </div>

      {/* ANNOTATIONS */}
      <div className="absolute bottom-4 left-4 z-20 px-3 py-1 bg-kodak-dark/90 backdrop-blur-md text-kodak-red font-display text-sm md:text-xl uppercase tracking-widest border-2 border-kodak-red theme-transition pointer-events-none shadow-lg">
        Synthetic
      </div>
      <div className="absolute bottom-4 right-4 z-20 px-3 py-1 bg-kodak-red text-kodak-yellow font-display text-sm md:text-xl uppercase tracking-widest border-2 border-kodak-yellow theme-transition pointer-events-none shadow-lg">
        Developed
      </div>

      {/* INTERACTION HINT */}
      {zoomScale > 1 && !isPanning && !isDraggingSlider && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-kodak-dark/80 text-kodak-yellow px-6 py-2 border border-kodak-red/30 rounded-full font-bold text-[10px] uppercase tracking-[0.2em] pointer-events-none animate-pulse backdrop-blur-sm">
          Drag to Pan Frame
        </div>
      )}
    </div>
  );
};

export default ComparisonSlider;