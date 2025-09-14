export interface GeminiQueryRequest {
  prompt: string;
  model?: string;
}

export interface GeminiQueryResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface GeminiError extends Error {
  code?: string;
  exitCode?: number;
}

export interface GeminiCliResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}