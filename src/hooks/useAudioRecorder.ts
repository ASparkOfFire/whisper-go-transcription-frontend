import { useState, useEffect, useRef, useCallback } from 'react';

// Declare global vad property on window
declare global {
  interface Window {
    vad: {
      MicVAD: {
        new: (options: any) => Promise<any>;
      };
    };
  }
}

type RecordingStatus = 'preparing' | 'recording' | 'inactive' | 'error';

interface UseAudioRecorderProps {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  sampleRate?: number;
  chunkDuration?: number; // in milliseconds
}

interface UseAudioRecorderReturn {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  recordingStatus: RecordingStatus;
  audioData: Float32Array | null;
}

// VAD configuration
const VAD_THRESHOLD = 0.5; // Voice activity detection threshold
const VAD_FRAME_SIZE = 1024; // Frame size for VAD processing
const VAD_MIN_SPEECH_DURATION = 0.3; // Minimum speech duration in seconds

export const useAudioRecorder = ({ 
  onAudioChunk, 
  sampleRate = 16000, 
  chunkDuration = 1000 
}: UseAudioRecorderProps): UseAudioRecorderReturn => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('inactive');
  const [audioData, setAudioData] = useState<Float32Array | null>(null);

  const vadRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Clean up resources
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    if (vadRef.current) {
      vadRef.current.pause().catch(console.error);
      vadRef.current = null;
    }

    setAudioData(null);
  }, []);

  // Basic WAV encoder - simplified for reliability
  const encodeWAV = (samples: Float32Array): ArrayBuffer => {
    // Normalize to 16-bit
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // format chunk length
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono channel
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Convert Float32 to Int16
    const volume = 0.9; // Prevent clipping
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i])) * volume;
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
  };

  // Helper function to write strings to the DataView
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Helper function to analyze audio for debugging
  const analyzeAudio = (audio: Float32Array): { 
    rms: number, 
    peak: number, 
    zeroCrossings: number,
    lengthSec: number
  } => {
    let sumSquared = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let prevSample = 0;
    
    for (let i = 0; i < audio.length; i++) {
      const sample = audio[i];
      sumSquared += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      
      // Count zero crossings - indicator of frequency content
      if ((prevSample < 0 && sample >= 0) || (prevSample >= 0 && sample < 0)) {
        zeroCrossings++;
      }
      prevSample = sample;
    }
    
    const rms = Math.sqrt(sumSquared / audio.length);
    const lengthSec = audio.length / sampleRate;
    
    return { rms, peak, zeroCrossings, lengthSec };
  };

  // Start the recording
  const startRecording = useCallback(async () => {
    try {
      cleanup();
      setRecordingStatus('preparing');
      
      // Initialize AudioContext for visualization
      const audioContext = new AudioContext();
      console.log('Audio context sample rate:', audioContext.sampleRate);
      audioContextRef.current = audioContext;
      
      console.log('Initializing Silero VAD...');
      
      // Check if vad is available globally
      if (!window.vad || !window.vad.MicVAD) {
        throw new Error('VAD module not loaded. Make sure the script is loaded properly.');
      }
      
      // Initialize the Silero VAD
      const vad = await window.vad.MicVAD.new({
        onSpeechStart: () => {
          console.log('Silero VAD: Speech detected, recording started');
          // Visual feedback could be added here if needed
        },
        onSpeechEnd: (audio: Float32Array) => {
          // Analyze audio before encoding
          const audioStats = analyzeAudio(audio);
          
          console.log('Silero VAD: Speech ended, processing audio');
          console.log(`Audio stats: length=${audioStats.lengthSec.toFixed(2)}s, samples=${audio.length}, ` +
                     `RMS=${audioStats.rms.toFixed(3)}, peak=${audioStats.peak.toFixed(3)}, ` +
                     `zero crossings=${audioStats.zeroCrossings} (${(audioStats.zeroCrossings/audioStats.lengthSec).toFixed(0)}/sec)`);
          
          // Skip processing if audio is too short or too quiet
          if (audioStats.lengthSec < 0.2 || audioStats.peak < 0.01) {
            console.log('Audio too short or too quiet, skipping processing');
            return;
          }
          
          // Convert the audio to WAV format
          const wavData = encodeWAV(audio);
          
          // Log the size of the WAV data being sent
          console.log(`Sending WAV data: ${wavData.byteLength} bytes`);
          
          // Send the audio chunk
          onAudioChunk(wavData);
        },
        onVADMisfire: (audio: Float32Array) => {
          if (!audio || audio.length === 0) {
            console.log('Silero VAD: Misfire without audio data');
            return;
          }
          
          const audioStats = analyzeAudio(audio);
          console.log('Silero VAD: VAD misfire detected - this may be background noise or non-speech sounds');
          console.log(`Misfire audio stats: length=${audioStats.lengthSec.toFixed(2)}s, RMS=${audioStats.rms.toFixed(3)}, ` +
                     `peak=${audioStats.peak.toFixed(3)}, zero crossings=${audioStats.zeroCrossings}`);
          
          // If the audio looks like it might actually be speech, try processing it anyway
          if (audioStats.lengthSec > 0.3 && audioStats.peak > 0.05 && audioStats.rms > 0.01) {
            console.log('Misfire audio appears to have speech characteristics, processing anyway');
            const wavData = encodeWAV(audio);
            onAudioChunk(wavData);
          }
        },
        // Silero VAD configuration - adjusted for better sensitivity
        positiveSpeechThreshold: 0.5,  // Lower value = more sensitive to speech (was 0.8)
        negativeSpeechThreshold: 0.5,  // Lower value = less likely to end speech detection too early (was 0.8)
        minSpeechFrames: 5,            // Fewer frames needed to trigger speech (was 10)
        preSpeechPadFrames: 15,        // More frames before speech for context (was 10)
        redemptionFrames: 30,          // More frames to wait before concluding speech ended (was 15)
        frameSamples: 1024             // Smaller frame size for more granular detection (was 1536)
      });
      
      console.log('Silero VAD initialized successfully');
      vadRef.current = vad;
      
      // Get audio stream for visualization
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      
      // Set up audio visualization
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);
      
      // Update visualization in animation frame
      const updateVisualization = () => {
        if (!analyserRef.current) return;
        
        const dataArray = new Float32Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getFloatTimeDomainData(dataArray);
        setAudioData(dataArray);
        
        animationFrameRef.current = requestAnimationFrame(updateVisualization);
      };
      
      animationFrameRef.current = requestAnimationFrame(updateVisualization);
      
      // Start the VAD
      console.log('Starting Silero VAD...');
      await vad.start();
      console.log('Silero VAD started successfully');
      console.log('==== LISTENING FOR SPEECH - PLEASE SPEAK CLEARLY INTO YOUR MICROPHONE ====');
      console.log('==== VAD Settings: sensitivity=0.5, min frames=5, frame size=1024 ====');
      
      setRecordingStatus('recording');
    } catch (error) {
      console.error('Error starting recording:', error);
      setRecordingStatus('error');
      cleanup();
    }
  }, [cleanup, onAudioChunk]);

  // Stop the recording
  const stopRecording = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause().catch(console.error);
    }
    setRecordingStatus('inactive');
    cleanup();
  }, [cleanup]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    startRecording,
    stopRecording,
    recordingStatus,
    audioData
  };
};