import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Loader2, RefreshCw, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import TranscriptionDisplay from './components/TranscriptionDisplay';
import WaveformVisualizer from './components/WaveformVisualizer';
import StatusIndicator from './components/StatusIndicator';
import { useWebSocket } from './hooks/useWebSocket';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { TranscriptionResponse } from './types';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionTime, setConnectionTime] = useState<string | null>(null);
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionResponse[]>([]);
  const [lastAudioChunk, setLastAudioChunk] = useState<ArrayBuffer | undefined>(undefined);
  const { connectionStatus, latestTranscription, sendAudioChunk, error, resetError, forceReconnect } = useWebSocket();
  const { startRecording, stopRecording, recordingStatus, audioData } = useAudioRecorder({
    onAudioChunk: (chunk) => {
      if (connectionStatus === 'connected') {
        setLastAudioChunk(chunk);
        sendAudioChunk(chunk);
      }
    }
  });

  // Track connection time
  useEffect(() => {
    if (connectionStatus === 'connected') {
      setConnectionTime(new Date().toLocaleTimeString());
    } else if (connectionStatus === 'connecting') {
      setConnectionTime(null);
    }
  }, [connectionStatus]);

  // Track transcription history
  useEffect(() => {
    if (latestTranscription && latestTranscription.Text) {
      // Add new transcription to history
      setTranscriptionHistory(prevHistory => {
        // Make sure we don't add duplicates
        if (
          prevHistory.length > 0 && 
          prevHistory[prevHistory.length - 1].Text === latestTranscription.Text
        ) {
          return prevHistory;
        }
        
        // Add timestamp and audio data to the transcription
        const transcriptionWithTimeAndAudio: TranscriptionResponse = {
          ...latestTranscription,
          timestamp: new Date().toLocaleTimeString(),
          audioData: lastAudioChunk
        };
        
        // Keep the most recent 10 transcriptions (adjust number as needed)
        const newHistory = [...prevHistory, transcriptionWithTimeAndAudio];
        if (newHistory.length > 10) {
          return newHistory.slice(newHistory.length - 10);
        }
        return newHistory;
      });
    }
  }, [latestTranscription, lastAudioChunk]);

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
    } else {
      startRecording();
      setIsRecording(true);
    }
  };

  const clearHistory = () => {
    setTranscriptionHistory([]);
  };

  const handleReloadPage = () => {
    window.location.reload();
  };

  const handleReconnect = () => {
    forceReconnect();
  };

  const isConnecting = connectionStatus === 'connecting';
  const isDisabled = connectionStatus === 'disconnected' || isConnecting;

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-purple-100 dark:from-gray-900 dark:to-gray-800 text-gray-900 dark:text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <header className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-purple-800 dark:text-purple-400 mb-2">
            Real-Time Audio Transcription
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Speak clearly and watch your words appear
          </p>
        </header>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <StatusIndicator status={connectionStatus} />
              {connectionStatus === 'connected' && connectionTime && (
                <span className="ml-2 text-xs text-gray-500">Connected since {connectionTime}</span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleReconnect}
                className="flex items-center text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                title="Force reconnect WebSocket"
              >
                <RefreshCw size={12} className="mr-1" />
                Reconnect
              </button>
              <StatusIndicator status={recordingStatus} type="recording" />
            </div>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded-lg">
              <div className="flex items-start">
                <AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{error}</p>
                  <div className="mt-3 flex space-x-3">
                    <button 
                      onClick={handleReconnect}
                      className="px-3 py-1.5 text-xs bg-red-200 dark:bg-red-800 hover:bg-red-300 dark:hover:bg-red-700 rounded-md transition-colors"
                    >
                      <RefreshCw size={14} className="inline mr-1" /> Reconnect
                    </button>
                    <button 
                      onClick={handleReloadPage}
                      className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                      Reload Page
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="relative min-h-[200px] mb-6 flex items-center justify-center border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            {isRecording ? (
              <>
                <WaveformVisualizer audioData={audioData} />
                {recordingStatus === 'listening' && (
                  <div className="absolute top-2 left-2 p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded text-xs">
                    Listening for speech...
                  </div>
                )}
                {recordingStatus === 'recording' && (
                  <div className="absolute top-2 left-2 p-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded text-xs flex items-center">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>
                    Recording speech
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400">
                {connectionStatus === 'connected' ? (
                  <div>
                    <Wifi className="inline-block mb-2 text-green-500" size={24} />
                    <p>Press the microphone button to start recording</p>
                  </div>
                ) : (
                  <div>
                    {connectionStatus === 'connecting' ? (
                      <Loader2 className="inline-block mb-2 animate-spin text-amber-500" size={24} />
                    ) : (
                      <WifiOff className="inline-block mb-2 text-red-500" size={24} />
                    )}
                    <p className="mb-2">
                      {connectionStatus === 'connecting' 
                        ? 'Connecting to transcription service...' 
                        : 'Disconnected from transcription service'}
                    </p>
                    {connectionStatus === 'disconnected' && (
                      <button 
                        onClick={handleReconnect}
                        className="px-3 py-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/50 rounded-md transition-colors"
                      >
                        <RefreshCw size={14} className="inline mr-1" /> Try Reconnecting
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-center mb-6">
            <button
              onClick={toggleRecording}
              disabled={isDisabled}
              className={`flex items-center justify-center w-16 h-16 rounded-full shadow-lg transition-all ${
                isRecording
                  ? recordingStatus === 'recording'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-blue-500 hover:bg-blue-600'
                  : 'bg-purple-600 hover:bg-purple-700'
              } ${
                isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isConnecting ? (
                <Loader2 className="animate-spin text-white" size={28} />
              ) : isRecording ? (
                recordingStatus === 'recording' ? (
                  <Mic className="text-white animate-pulse" size={28} />
                ) : (
                  <Mic className="text-white opacity-70" size={28} />
                )
              ) : (
                <Mic className="text-white" size={28} />
              )}
            </button>
          </div>

          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Transcriptions</h2>
            {transcriptionHistory.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Clear History
              </button>
            )}
          </div>

          <TranscriptionDisplay 
            transcription={latestTranscription} 
            transcriptionHistory={transcriptionHistory}
          />
        </div>

        <footer className="text-center text-sm text-gray-500 dark:text-gray-400">
          <p>WebSocket connection to: ws://localhost:8010/api/v1/transcribe/ws</p>
          <p className="mt-1">
            Server status: 
            <span className={`ml-1 font-medium ${
              connectionStatus === 'connected' 
                ? 'text-green-500' 
                : connectionStatus === 'connecting' 
                  ? 'text-amber-500' 
                  : 'text-red-500'
            }`}>
              {connectionStatus}
            </span>
            {connectionTime && connectionStatus === 'connected' && (
              <span className="ml-1 text-xs">({connectionTime})</span>
            )}
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;