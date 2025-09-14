import { spawn } from 'child_process';
import { GeminiCliResult, GeminiError } from './types.js';

const COMMAND_TIMEOUT_MS = 10000; // 10 seconds
const TEST_MODE = process.env.GEMINI_TEST_MODE === 'true';

export async function executeGeminiCommand(prompt: string, model?: string): Promise<GeminiCliResult> {
  // Test mode - return simulated response
  if (TEST_MODE) {
    return simulateGeminiResponse(prompt, model);
  }
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt is required and must be a string');
  }

  if (prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty');
  }

  // Validate prompt length (reasonable limit)
  if (prompt.length > 10000) {
    throw new Error('Prompt is too long (max 10000 characters)');
  }

  return new Promise((resolve) => {
    let isResolved = false;

    // Build command arguments
    const args = [];
    // Default to gemini-2.5-flash if no model specified
    const selectedModel = model || 'gemini-2.5-flash';
    args.push('-m', selectedModel);
    args.push('-p', prompt);

    const child = spawn('gemini', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        child.kill('SIGKILL');
        resolve({
          success: false,
          output: '',
          error: `Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`,
          exitCode: 124
        });
      }
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);

        if (code === 0) {
          const output = stdout.trim();
          if (output) {
            resolve({
              success: true,
              output: output
            });
          } else {
            resolve({
              success: false,
              output: '',
              error: 'Gemini CLI returned empty response',
              exitCode: code || 0
            });
          }
        } else {
          resolve({
            success: false,
            output: stdout.trim(),
            error: stderr.trim() || `Command failed with exit code ${code}`,
            exitCode: code || 1
          });
        }
      }
    });

    child.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);

        const geminiError = err as GeminiError;
        let errorMessage = 'Failed to execute gemini command';

        if (geminiError.code === 'ENOENT') {
          errorMessage = 'Gemini CLI not found. Please ensure it is installed and in your PATH.';
        } else if (geminiError.code === 'ETIMEDOUT') {
          errorMessage = `Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`;
        } else {
          errorMessage = `Command execution error: ${geminiError.message}`;
        }

        resolve({
          success: false,
          output: '',
          error: errorMessage,
          exitCode: 1
        });
      }
    });
  });
}

export function sanitizePrompt(prompt: string): string {
  // Basic sanitization - remove any null bytes and control characters
  return prompt
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

async function simulateGeminiResponse(prompt: string, model?: string): Promise<GeminiCliResult> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

  // Generate a test response based on prompt
  let response = '';

  if (prompt.toLowerCase().includes('2+2') || prompt.toLowerCase().includes('2 + 2')) {
    response = '2 + 2 = 4';
  } else if (prompt.toLowerCase().includes('hello')) {
    response = 'Hello! How can I help you today?';
  } else if (prompt.toLowerCase().includes('test')) {
    response = `This is a test response from the MCP server. You asked: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`;
  } else {
    response = `I received your prompt: "${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}"${model ? ` (using model: ${model})` : ''}. This is a simulated response since Gemini CLI is in test mode.`;
  }

  return {
    success: true,
    output: response
  };
}