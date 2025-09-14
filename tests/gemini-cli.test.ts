import { executeGeminiCommand, sanitizePrompt, simulateGeminiResponse } from '../src/gemini-cli';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('gemini-cli', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    delete process.env.GEMINI_TEST_MODE;
  });

  describe('sanitizePrompt', () => {
    it('should remove null bytes', () => {
      const input = 'Hello\0World';
      const result = sanitizePrompt(input);
      expect(result).toBe('HelloWorld');
    });

    it('should remove control characters', () => {
      const input = 'Hello\x01\x02\x03World';
      const result = sanitizePrompt(input);
      expect(result).toBe('HelloWorld');
    });

    it('should trim whitespace', () => {
      const input = '  Hello World  ';
      const result = sanitizePrompt(input);
      expect(result).toBe('Hello World');
    });

    it('should preserve valid characters', () => {
      const input = 'Hello World! How are you? 123 @#$%';
      const result = sanitizePrompt(input);
      expect(result).toBe('Hello World! How are you? 123 @#$%');
    });
  });

  describe('simulateGeminiResponse', () => {
    it('should return simulated response for 2+2', async () => {
      const result = await simulateGeminiResponse('What is 2+2?');

      expect(result.success).toBe(true);
      expect(result.output).toBe('2 + 2 = 4');
    });

    it('should return simulated response for hello', async () => {
      const result = await simulateGeminiResponse('Hello');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello! How can I help you today?');
    });

    it('should return test response for test prompts', async () => {
      const result = await simulateGeminiResponse('This is a test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('This is a test response from the MCP server');
    });

    it('should return generic response with model info', async () => {
      const result = await simulateGeminiResponse('Random prompt', 'gemini-1.5-flash');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Random prompt');
      expect(result.output).toContain('(using model: gemini-1.5-flash)');
    });

    it('should handle long prompts by truncating', async () => {
      const longPrompt = 'a'.repeat(100);
      const result = await simulateGeminiResponse(longPrompt);

      expect(result.success).toBe(true);
      expect(result.output).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...');
    });
  });

  describe('executeGeminiCommand with real CLI', () => {
    let mockChildProcess: any;

    beforeEach(() => {
      // Don't set test mode
      delete process.env.GEMINI_TEST_MODE;

      // Create mock child process
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockChildProcess as any);
    });

    it('should validate prompt is required', async () => {
      await expect(executeGeminiCommand('')).rejects.toThrow('Prompt cannot be empty');
      await expect(executeGeminiCommand('   ')).rejects.toThrow('Prompt cannot be empty');
      await expect(executeGeminiCommand(null as any)).rejects.toThrow('Prompt is required and must be a string');
      await expect(executeGeminiCommand(undefined as any)).rejects.toThrow('Prompt is required and must be a string');
    });

    it('should validate prompt length', async () => {
      const longPrompt = 'a'.repeat(10001);
      await expect(executeGeminiCommand(longPrompt)).rejects.toThrow(/too long/i);
    });

    it('should execute with default model', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      // Simulate successful execution
      mockChildProcess.stdout.emit('data', 'Response from Gemini');
      mockChildProcess.emit('close', 0);

      const result = await executePromise;

      expect(mockSpawn).toHaveBeenCalledWith('gemini', ['-m', 'gemini-2.5-flash', '-p', 'test prompt'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Response from Gemini');
    });

    it('should execute with custom model', async () => {
      const executePromise = executeGeminiCommand('test prompt', 'gemini-1.5-flash');

      mockChildProcess.stdout.emit('data', 'Response from Gemini');
      mockChildProcess.emit('close', 0);

      await executePromise;

      expect(mockSpawn).toHaveBeenCalledWith('gemini', ['-m', 'gemini-1.5-flash', '-p', 'test prompt'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should handle empty response', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      mockChildProcess.stdout.emit('data', '   '); // Just whitespace
      mockChildProcess.emit('close', 0);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should handle non-zero exit code', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      mockChildProcess.stderr.emit('data', 'Error message');
      mockChildProcess.emit('close', 1);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error message');
      expect(result.exitCode).toBe(1);
    });

    it('should handle command not found', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      const error = new Error('Command not found');
      (error as any).code = 'ENOENT';
      mockChildProcess.emit('error', error);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle timeout error', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      // Simulate timeout by waiting longer than the timeout period
      setTimeout(() => {
        const timeoutError = new Error('Timeout');
        (timeoutError as any).code = 'ETIMEDOUT';
        mockChildProcess.emit('error', timeoutError);
      }, 50);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should handle generic errors', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      const error = new Error('Generic error');
      mockChildProcess.emit('error', error);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('error');
    });

    it('should accumulate stdout data correctly', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      // Send data in chunks
      mockChildProcess.stdout.emit('data', 'First ');
      mockChildProcess.stdout.emit('data', 'part of ');
      mockChildProcess.stdout.emit('data', 'response');
      mockChildProcess.emit('close', 0);

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('First part of response');
    });

    it('should handle timeout correctly', async () => {
      const executePromise = executeGeminiCommand('test prompt');

      // Manually trigger timeout after a short delay
      setTimeout(() => {
        mockChildProcess.emit('close', 124);
      }, 50);

      const result = await executePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('failed');
      expect(result.exitCode).toBe(124);
    });
  });
});