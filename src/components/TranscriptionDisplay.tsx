import React from 'react';
import { TranscriptionResponse } from '../types';

interface TranscriptionDisplayProps {
  transcription: TranscriptionResponse | null;
  transcriptionHistory: TranscriptionResponse[];
}

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ 
  transcription, 
  transcriptionHistory 
}) => {
  if (!transcription && transcriptionHistory.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4 min-h-[100px] flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400 text-center">
          Transcription will appear here when you start speaking...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4">
      {/* Current transcription */}
      {transcription && transcription.Text && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Current Transcription</h3>
          <div className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 min-h-[60px]">
            <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
              {transcription.Text}
            </p>
          </div>
        </div>
      )}

      {/* Transcription history */}
      {transcriptionHistory.length > 0 && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">History</h3>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 overflow-hidden max-h-[300px] overflow-y-auto">
            {transcriptionHistory.map((item, index) => (
              <div 
                key={index} 
                className={`p-3 border-b border-gray-100 dark:border-gray-700 ${
                  index === transcriptionHistory.length - 1 ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {item.timestamp || `Segment ${item.Num}`}
                  </span>
                  {item.Tokens && (
                    <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                      {item.Tokens.length} tokens
                    </span>
                  )}
                </div>
                <p className="text-gray-800 dark:text-gray-200">
                  {item.Text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Token details for current transcription */}
      {transcription && transcription.Tokens && transcription.Tokens.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Token Details</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            <div className="grid grid-cols-3 gap-2 p-2 bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400">
              <div>Token</div>
              <div>Probability</div>
              <div>ID</div>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {transcription.Tokens.map((token, index) => (
                <div 
                  key={index} 
                  className="grid grid-cols-3 gap-2 p-2 border-t border-gray-100 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <div className="font-medium text-gray-800 dark:text-gray-200">{token.Text}</div>
                  <div>
                    <span 
                      className={`
                        ${token.P > 0.8 ? 'text-green-600 dark:text-green-400' : ''}
                        ${token.P <= 0.8 && token.P >= 0.5 ? 'text-amber-600 dark:text-amber-400' : ''}
                        ${token.P < 0.5 ? 'text-red-600 dark:text-red-400' : ''}
                      `}
                    >
                      {(token.P * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">{token.Id}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptionDisplay;