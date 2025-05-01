import React, { useRef, useEffect } from 'react';

interface WaveformVisualizerProps {
  audioData: Float32Array | null;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ audioData }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  // Draw the waveform visualization
  const draw = () => {
    if (!canvasRef.current || !audioData) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get the actual dimensions of the canvas in the DOM
    const rect = canvas.getBoundingClientRect();
    
    // Set the canvas resolution to match its display size
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    
    // Scale the context to ensure correct drawing
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // Clear the canvas
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    const centerY = rect.height / 2;
    const width = rect.width;
    
    // Configuration
    const barWidth = 3;
    const barSpacing = 1;
    const barCount = Math.floor(width / (barWidth + barSpacing));
    const samplesPerBar = Math.floor(audioData.length / barCount) || 1;
    
    // Create a gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
    gradient.addColorStop(0, 'rgba(109, 40, 217, 0.8)');  // Purple-600
    gradient.addColorStop(1, 'rgba(13, 148, 136, 0.6)');  // Teal-600
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    
    // Draw each bar
    for (let i = 0; i < barCount; i++) {
      // Get the average amplitude for this bar
      let sum = 0;
      for (let j = 0; j < samplesPerBar; j++) {
        const index = i * samplesPerBar + j;
        if (index < audioData.length) {
          sum += Math.abs(audioData[index]);
        }
      }
      const amplitude = sum / samplesPerBar;
      
      // Calculate bar height based on amplitude (apply some scaling for visibility)
      const barHeight = Math.max(2, amplitude * rect.height * 1.5);
      
      // Calculate x position
      const x = i * (barWidth + barSpacing);
      
      // Draw the bar as a rounded rectangle
      const roundedRect = (x: number, y: number, width: number, height: number, radius: number) => {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      
      roundedRect(
        x, 
        centerY - barHeight / 2, 
        barWidth, 
        barHeight,
        1
      );
    }
    
    animationRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioData]);

  return (
    <div className="w-full h-[200px] relative bg-gray-50 dark:bg-gray-800/40 rounded">
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
      <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none">
        <div className="text-xs text-purple-600 dark:text-purple-400 bg-white dark:bg-gray-800 px-2 py-1 rounded-full shadow-sm">
          Recording...
        </div>
      </div>
    </div>
  );
};

export default WaveformVisualizer;