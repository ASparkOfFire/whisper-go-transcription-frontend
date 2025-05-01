export interface Token {
  Id: number;
  Text: string;
  P: number;
  Start: number;
  End: number;
}

export interface TranscriptionResponse {
  Num: number;
  Start: number;
  End: number;
  Text: string;
  Tokens: Token[];
  timestamp?: string;
  audioData?: ArrayBuffer;
}