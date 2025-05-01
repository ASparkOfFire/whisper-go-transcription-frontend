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

type RecordingStatus = 'preparing' | 'listening' | 'recording' | 'inactive' | 'error';

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
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Real-time processing references
  const isListeningRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const silenceStartRef = useRef<number>(0);
  const speechStartTimeRef = useRef<number>(0);
  
  // Constants for voice detection
  const SILENCE_THRESHOLD = 0.01; // Reduced sensitivity for silence detection
  const MIN_SILENCE_DURATION = 1500; // Longer silence required to end recording
  const MIN_WORD_SAMPLES = Math.floor(sampleRate * (chunkDuration / 1000)); // Convert ms to samples
  
  // Buffer to store audio frames before speech is detected
  const preSpeechBufferRef = useRef<Float32Array[]>([]);
  // Max number of frames to keep before speech (about 500ms at 16kHz with 1024-sample frames)
  const MAX_PRE_SPEECH_FRAMES = 8;
  
  // Clean up resources
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    
    if (microphoneSourceRef.current) {
      microphoneSourceRef.current.disconnect();
      microphoneSourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
    }

    if (vadRef.current) {
      vadRef.current.pause().catch(console.error);
      vadRef.current = null;
    }

    isListeningRef.current = false;
    isSpeakingRef.current = false;
    audioBufferRef.current = [];
    setAudioData(null);
  }, []);

  // Improved WAV encoder with proper sample rate handling - fixes pitch issues
  const encodeWAV = (samples: Float32Array): ArrayBuffer => {
    // Ensure we work with a clean copy of the samples
    const audioSamples = new Float32Array(samples);
    const numSamples = audioSamples.length;
    
    // Create the WAV file buffer
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true); // File size - 8 bytes
    writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
    view.setUint16(20, 1, true); // Audio format (1 for PCM)
    view.setUint16(22, 1, true); // Number of channels (1 for mono)
    view.setUint32(24, sampleRate, true); // Sample rate - CRITICAL for proper pitch
    view.setUint32(28, sampleRate * 2, true); // Byte rate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true); // Block align (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // Bits per sample
    
    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true); // Sub-chunk size (NumSamples * NumChannels * BitsPerSample/8)

    // Find the maximum amplitude for normalization
    let maxAmplitude = 0;
    for (let i = 0; i < numSamples; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(audioSamples[i]));
    }
    
    // Apply a scale factor for volume - don't over-normalize
    const scaleFactor = maxAmplitude > 0.7 ? 0.7 / maxAmplitude : 1.0;
    
    // Convert Float32 to Int16 with proper scaling - crucial for audio quality
    for (let i = 0; i < numSamples; i++) {
      // Apply scale factor and clamp to [-1, 1]
      const sample = Math.max(-1, Math.min(1, audioSamples[i] * scaleFactor));
      
      // Convert to 16-bit integer with proper rounding
      // Use Math.round instead of just typecasting for better accuracy
      const int16Sample = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
      
      view.setInt16(44 + i * 2, int16Sample, true);
    }

    return buffer;
  };

  // Helper function to write strings to the DataView
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Detect if current audio frame contains speech
  const detectSpeech = (audioFrame: Float32Array): boolean => {
    let sum = 0;
    for (let i = 0; i < audioFrame.length; i++) {
      sum += audioFrame[i] * audioFrame[i];
    }
    const rms = Math.sqrt(sum / audioFrame.length);
    return rms > SILENCE_THRESHOLD;
  };
  
  // Process complete speech segment once speech has ended
  const processSpeechSegment = useCallback(() => {
    if (audioBufferRef.current.length === 0) return;
    
    const totalSamples = audioBufferRef.current.reduce((sum, buffer) => sum + buffer.length, 0);
    
    if (totalSamples >= MIN_WORD_SAMPLES) {
      // Calculate speech duration
      const speechDurationMs = Date.now() - speechStartTimeRef.current;
      console.log(`Processing complete speech segment: ${totalSamples} samples (${totalSamples/sampleRate}s, ${speechDurationMs}ms real time)`);
      
      // Merge all buffers
      const mergedBuffer = new Float32Array(totalSamples);
      let offset = 0;
      for (const buffer of audioBufferRef.current) {
        mergedBuffer.set(buffer, offset);
        offset += buffer.length;
      }
      
      // Apply a simple low-pass filter to reduce high frequency noise
      const filteredBuffer = applySimpleLowPassFilter(mergedBuffer);
      
      // Create WAV and send
      const wavData = encodeWAV(filteredBuffer);
      console.log(`Sending speech segment: ${wavData.byteLength} bytes, duration: ${filteredBuffer.length/sampleRate}s`);
      onAudioChunk(wavData);
    } else {
      console.log(`Speech segment too short (${totalSamples} samples), discarding`);
    }
    
    // Clear buffer after processing
    audioBufferRef.current = [];
  }, [onAudioChunk, sampleRate, MIN_WORD_SAMPLES]);
  
  // Simple low-pass filter to reduce high-frequency noise without affecting pitch
  const applySimpleLowPassFilter = (buffer: Float32Array): Float32Array => {
    const result = new Float32Array(buffer.length);
    const filterCoeff = 0.8; // Higher coefficient = less filtering (was 0.2)
    
    result[0] = buffer[0]; // Start with first sample
    
    // Apply simple first-order low-pass filter (moving average)
    for (let i = 1; i < buffer.length; i++) {
      result[i] = filterCoeff * buffer[i] + (1 - filterCoeff) * result[i-1];
    }
    
    return result;
  };

  // Start listening and recording when speech is detected
  const startRecording = useCallback(async () => {
    try {
      cleanup();
      setRecordingStatus('preparing');
      
      // Create AudioContext with explicit sample rate
      const audioContext = new AudioContext({ sampleRate });
      console.log(`Created AudioContext with sample rate: ${audioContext.sampleRate}Hz`);
      audioContextRef.current = audioContext;
      
      // Access microphone with optimal quality settings
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: sampleRate // Request specific sample rate
        }
      });
      microphoneStreamRef.current = stream;
      
      // Log the actual audio tracks to verify settings
      const audioTracks = stream.getAudioTracks();
      console.log('Audio track settings:', audioTracks[0].getSettings());
      
      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      microphoneSourceRef.current = source;
      
      // Create analyser for visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);
      
      // Create script processor for real-time audio processing
      const bufferSize = 2048;
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = scriptProcessor;
      
      // Initialize recording state
      isListeningRef.current = true;
      isSpeakingRef.current = false;
      audioBufferRef.current = [];
      silenceStartRef.current = 0;
      speechStartTimeRef.current = 0;
      
      // Process audio in real-time
      scriptProcessor.onaudioprocess = (e) => {
        if (!isListeningRef.current) return;
        
        // Get input audio data
        const inputData = e.inputBuffer.getChannelData(0);
        const inputCopy = new Float32Array(inputData); // Make a copy to avoid reference issues
        
        // Always keep some audio in the pre-speech buffer
        if (!isSpeakingRef.current) {
          preSpeechBufferRef.current.push(inputCopy);
          // Limit the pre-speech buffer size
          if (preSpeechBufferRef.current.length > MAX_PRE_SPEECH_FRAMES) {
            preSpeechBufferRef.current.shift(); // Remove oldest frame
          }
        }
        
        // Detect if frame contains speech
        const hasSpeech = detectSpeech(inputCopy);
        const currentTime = Date.now();
        
        if (hasSpeech) {
          // If just started speaking after silence
          if (!isSpeakingRef.current) {
            speechStartTimeRef.current = currentTime;
            console.log('Speech detected - recording started with pre-speech buffer');
            isSpeakingRef.current = true;
            silenceStartRef.current = 0;
            
            // Start with pre-speech buffer to capture beginning of speech
            audioBufferRef.current = [...preSpeechBufferRef.current];
            
            // Update UI to show active recording
            setRecordingStatus('recording');
          }
          
          // Store the audio frame
          audioBufferRef.current.push(inputCopy);
        } else {
          // Still store some silence frames to capture word endings properly
          if (isSpeakingRef.current) {
            audioBufferRef.current.push(inputCopy);
          }
          
          // If was speaking but now detected silence
          if (isSpeakingRef.current) {
            if (silenceStartRef.current === 0) {
              // Mark the start of silence
              silenceStartRef.current = currentTime;
              console.log('Silence started, will end speech if silence continues for 1.5s');
            } else {
              const silenceDuration = currentTime - silenceStartRef.current;
              
              // Log silence duration for debugging
              if (silenceDuration % 200 < 20) { // Log approximately every 200ms
                console.log(`Silence for ${silenceDuration}ms`);
              }
              
              if (silenceDuration > MIN_SILENCE_DURATION) {
                // If silence continues for enough time, consider speech ended
                console.log(`Speech ended - silence detected for ${silenceDuration}ms`);
                isSpeakingRef.current = false;
                
                // Update UI to show we're listening but not actively recording
                setRecordingStatus('listening');
                
                // Process the complete speech segment
                processSpeechSegment();
              }
            }
          }
        }
      };
      
      // Connect the script processor
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      // Set up visualization animation
      const updateVisualization = () => {
        if (!analyserRef.current) return;
        
        const dataArray = new Float32Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getFloatTimeDomainData(dataArray);
        setAudioData(dataArray);
        
        animationFrameRef.current = requestAnimationFrame(updateVisualization);
      };
      
      animationFrameRef.current = requestAnimationFrame(updateVisualization);
      
      console.log('Voice-activated recording started');
      console.log(`Audio context sample rate: ${audioContext.sampleRate}Hz`);
      console.log(`Recording with sample rate: ${sampleRate}Hz`);
      console.log(`Minimum samples for valid speech: ${MIN_WORD_SAMPLES} (${MIN_WORD_SAMPLES/sampleRate}s)`);
      console.log('==== SPEAK CLEARLY INTO YOUR MICROPHONE - PROCESSING COMPLETE SPEECH SEGMENTS ====');
      
      // Initially we're just listening, not actively recording speech
      setRecordingStatus('listening');
    } catch (error) {
      console.error('Error starting recording:', error);
      setRecordingStatus('error');
      cleanup();
    }
  }, [cleanup, processSpeechSegment]);

  // Stop recording
  const stopRecording = useCallback(() => {
    // If we're in the middle of speaking, process what we have
    if (isSpeakingRef.current && audioBufferRef.current.length > 0) {
      processSpeechSegment();
    }
    
    isListeningRef.current = false;
    setRecordingStatus('inactive');
    cleanup();
  }, [cleanup, processSpeechSegment]);

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