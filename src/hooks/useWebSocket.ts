import { useState, useEffect, useCallback, useRef } from 'react';
import { TranscriptionResponse } from '../types';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseWebSocketReturn {
  connectionStatus: ConnectionStatus;
  latestTranscription: TranscriptionResponse | null;
  sendAudioChunk: (audioChunk: ArrayBuffer) => void;
  error: string | null;
  resetError: () => void;
  forceReconnect: () => void;
}

// Server URL - this could be moved to environment variables for different environments
const SERVER_URL = 'ws://localhost:8010/api/v1/transcribe/ws';

// Heartbeat interval in milliseconds (ping every 30 seconds)
const HEARTBEAT_INTERVAL = 30000;

// Create a shared WebSocket instance that persists across renders
let globalSocket: WebSocket | null = null;
let globalHeartbeatInterval: number | null = null;
let isReconnecting = false;
let connectionAttempts = 0;
let totalBytesSent = 0;
let sendCount = 0;

export const useWebSocket = (): UseWebSocketReturn => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [latestTranscription, setLatestTranscription] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  // Reset error handler
  const resetError = useCallback(() => {
    setError(null);
  }, []);

  // Debug websocket state
  const debugSocketState = useCallback(() => {
    if (!globalSocket) {
      console.log('WebSocket: No socket instance exists');
      return;
    }
    
    const states = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED'
    };
    
    console.log(`WebSocket: Current state = ${states[globalSocket.readyState]}`);
    console.log(`WebSocket: Total bytes sent = ${totalBytesSent}, chunks sent = ${sendCount}`);
  }, []);

  // Send a ping to keep the connection alive
  const sendHeartbeat = useCallback(() => {
    if (globalSocket && globalSocket.readyState === WebSocket.OPEN) {
      try {
        // Send empty ArrayBuffer as a ping
        const emptyPing = new ArrayBuffer(0);
        globalSocket.send(emptyPing);
        console.log('WebSocket: Sent heartbeat ping');
      } catch (error) {
        console.error('WebSocket: Error sending heartbeat:', error);
      }
    }
  }, []);

  // Start heartbeat interval
  const startHeartbeat = useCallback(() => {
    // Stop any existing heartbeat
    if (globalHeartbeatInterval) {
      window.clearInterval(globalHeartbeatInterval);
      globalHeartbeatInterval = null;
    }
    
    globalHeartbeatInterval = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    console.log('WebSocket: Started heartbeat interval');
  }, [sendHeartbeat]);

  // Stop heartbeat interval
  const stopHeartbeat = useCallback(() => {
    if (globalHeartbeatInterval) {
      window.clearInterval(globalHeartbeatInterval);
      globalHeartbeatInterval = null;
      console.log('WebSocket: Stopped heartbeat interval');
    }
  }, []);

  const clearExistingConnection = useCallback(() => {
    // Stop heartbeats
    stopHeartbeat();
    
    // Clear any existing connection
    if (globalSocket) {
      try {
        globalSocket.close();
      } catch (e) {
        console.error('Error closing existing WebSocket:', e);
      }
      globalSocket = null;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    connectionAttempts = 0;
    isReconnecting = false;
    console.log('WebSocket: Cleared existing connection');
  }, [stopHeartbeat]);

  const connectWebSocket = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isReconnecting) {
      console.log('WebSocket: Already reconnecting, skipping request');
      return;
    }
    
    isReconnecting = true;
    connectionAttempts++;

    try {
      // Check if we already have a working connection
      if (globalSocket && globalSocket.readyState === WebSocket.OPEN) {
        console.log('WebSocket: Already connected, using existing connection');
        setConnectionStatus('connected');
        isReconnecting = false;
        return;
      }
      
      // Close any existing connection that isn't working
      if (globalSocket) {
        try {
          globalSocket.close();
        } catch (e) {
          console.error('Error closing existing non-functional WebSocket:', e);
        }
        globalSocket = null;
      }
      
      console.log(`WebSocket: Connecting... (attempt ${connectionAttempts})`);
      setConnectionStatus('connecting');
      
      // Create new WebSocket connection
      const socket = new WebSocket(SERVER_URL);
      socket.binaryType = 'arraybuffer';
      
      globalSocket = socket;

      socket.onopen = () => {
        console.log('WebSocket: Connected successfully!');
        setConnectionStatus('connected');
        setError(null);
        
        // Reset connection attempts on successful connection
        connectionAttempts = 0;
        isReconnecting = false;
        
        // Reset counters
        totalBytesSent = 0;
        sendCount = 0;
        
        // Start heartbeat to keep connection alive
        startHeartbeat();
      };

      socket.onmessage = (event) => {
        try {
          if (event.data instanceof ArrayBuffer) {
            // Don't log binary data to avoid console spam
            return;
          }
          
          const data = JSON.parse(event.data);
          console.log('WebSocket: Received message:', data);
          
          if (data.err) {
            console.error('WebSocket: Server error:', data.err);
            setError(`Server error: ${data.err}`);
          } else {
            setLatestTranscription(data);
          }
        } catch (error) {
          console.error('WebSocket: Parse error:', error);
        }
      };

      socket.onclose = (event) => {
        console.log(`WebSocket: Closed (code: ${event.code})`);
        
        // Only update UI if this is still the current socket
        if (socket === globalSocket) {
          setConnectionStatus('disconnected');
          
          // Stop heartbeat on connection close
          stopHeartbeat();
          
          if (event.code !== 1000) {
            setError(`Connection closed (code: ${event.code}). Try reconnecting.`);
            
            // Schedule reconnect with increasing delay
            if (connectionAttempts < 5) {
              const delay = Math.min(3000 * connectionAttempts, 15000);
              console.log(`WebSocket: Will reconnect in ${delay}ms...`);
              
              reconnectTimeoutRef.current = window.setTimeout(() => {
                isReconnecting = false;
                connectWebSocket();
              }, delay);
            } else {
              console.log('WebSocket: Max reconnect attempts reached');
              isReconnecting = false;
            }
          } else {
            isReconnecting = false;
          }
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket: Error occurred:', error);
        setError('Connection error. See console for details.');
      };
    } catch (error) {
      console.error('WebSocket: Creation error:', error);
      setConnectionStatus('disconnected');
      setError('Failed to create WebSocket connection');
      isReconnecting = false;
    }
  }, [startHeartbeat, stopHeartbeat]);

  const forceReconnect = useCallback(() => {
    console.log('WebSocket: Force reconnect requested');
    clearExistingConnection();
    connectWebSocket();
  }, [clearExistingConnection, connectWebSocket]);

  // Set up connection and cleanup
  useEffect(() => {
    console.log('WebSocket: Component mounted');
    
    // Initialize connection if needed
    if (!globalSocket || globalSocket.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      // If connection exists, just update the UI state
      console.log('WebSocket: Using existing connection');
      setConnectionStatus('connected');
    }
    
    // Periodic health check
    const healthCheck = setInterval(() => {
      debugSocketState();
      
      if (!globalSocket || globalSocket.readyState !== WebSocket.OPEN) {
        console.log('WebSocket: Health check - connection not open');
        
        if (!isReconnecting) {
          connectWebSocket();
        }
      }
    }, 30000); // Check every 30 seconds
    
    // Return cleanup function
    return () => {
      console.log('WebSocket: Component unmounting');
      
      // Clear health check
      clearInterval(healthCheck);
      
      // Clear any pending reconnects
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Note: We intentionally don't close the WebSocket here
      // This allows the connection to persist between component mounts
    };
  }, [connectWebSocket, debugSocketState]);

  const sendAudioChunk = useCallback((audioChunk: ArrayBuffer) => {
    if (!globalSocket) {
      console.warn('WebSocket: Cannot send - no socket instance');
      return;
    }
    
    if (globalSocket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket: Cannot send - socket not open (state:', globalSocket.readyState, ')');
      return;
    }
    
    try {
      // Send the binary data directly
      const byteLength = audioChunk.byteLength;
      console.log(`WebSocket: Sending audio chunk #${sendCount+1} (${byteLength} bytes)`);
      
      // Log first few bytes of the data for debugging
      const view = new Uint8Array(audioChunk, 0, Math.min(44, byteLength));
      console.log('WebSocket: First bytes:', Array.from(view).map(b => b.toString(16).padStart(2, '0')).join(' '));
      
      // Actually send the data
      globalSocket.send(audioChunk);
      
      // Update stats
      totalBytesSent += byteLength;
      sendCount++;
      
      console.log(`WebSocket: Successfully sent chunk (total: ${totalBytesSent} bytes in ${sendCount} chunks)`);
    } catch (error) {
      console.error('WebSocket: Send error:', error);
    }
  }, []);

  return {
    connectionStatus,
    latestTranscription,
    sendAudioChunk,
    error,
    resetError,
    forceReconnect
  };
};