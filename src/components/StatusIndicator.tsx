import React from 'react';
import { Wifi, WifiOff, Mic, MicOff, AlertCircle, Ear } from 'lucide-react';

type StatusType = 'connection' | 'recording';
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type RecordingStatus = 'preparing' | 'listening' | 'recording' | 'inactive' | 'error';

interface StatusIndicatorProps {
  status: ConnectionStatus | RecordingStatus;
  type?: StatusType;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, type = 'connection' }) => {
  let icon;
  let label;
  let colorClass;

  if (type === 'connection') {
    switch (status as ConnectionStatus) {
      case 'connected':
        icon = <Wifi size={16} />;
        label = 'Connected';
        colorClass = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
        break;
      case 'connecting':
        icon = <Wifi size={16} className="animate-pulse" />;
        label = 'Connecting';
        colorClass = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
        break;
      case 'disconnected':
        icon = <WifiOff size={16} />;
        label = 'Disconnected';
        colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
        break;
      default:
        icon = <AlertCircle size={16} />;
        label = 'Unknown';
        colorClass = 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
    }
  } else {
    switch (status as RecordingStatus) {
      case 'recording':
        icon = <Mic size={16} className="animate-pulse" />;
        label = 'Recording';
        colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
        break;
      case 'listening':
        icon = <Mic size={16} />;
        label = 'Listening';
        colorClass = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
        break;
      case 'preparing':
        icon = <Mic size={16} className="animate-pulse" />;
        label = 'Preparing';
        colorClass = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
        break;
      case 'error':
        icon = <AlertCircle size={16} />;
        label = 'Error';
        colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
        break;
      case 'inactive':
      default:
        icon = <MicOff size={16} />;
        label = 'Not Recording';
        colorClass = 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
    }
  }

  return (
    <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
      {icon}
      <span className="ml-1.5">{label}</span>
    </div>
  );
};

export default StatusIndicator;