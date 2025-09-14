import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

describe('MCP Server Integration Tests', () => {
  let serverProcess: ChildProcess;
  const serverPath = join(__dirname, '../dist/index.js');

  const sendJsonRpc = (server: ChildProcess, message: any): Promise<string> => {
    return new Promise((resolve, reject) => {
      let response = '';
      let timeoutId: NodeJS.Timeout;

      const dataHandler = (data: Buffer) => {
        response += data.toString();
        // Check if we have a complete JSON response
        try {
          const lines = response.trim().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              JSON.parse(line.trim()); // Validate JSON
              clearTimeout(timeoutId);
              server.stdout?.removeListener('data', dataHandler);
              resolve(line.trim());
              return;
            }
          }
        } catch (e) {
          // Not complete JSON yet, continue listening
        }
      };

      server.stdout?.on('data', dataHandler);

      timeoutId = setTimeout(() => {
        server.stdout?.removeListener('data', dataHandler);
        reject(new Error(`Timeout waiting for response to: ${JSON.stringify(message)}`));
      }, 5000);

      server.stdin?.write(JSON.stringify(message) + '\n');
    });
  };

  beforeEach(async () => {
    // Start server in test mode
    serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GEMINI_TEST_MODE: 'true' }
    });

    // Wait for server to start
    await new Promise((resolve) => {
      serverProcess.stderr?.on('data', (data) => {
        if (data.toString().includes('Server started')) {
          resolve(void 0);
        }
      });
    });
  });

  afterEach(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  describe('Server Lifecycle', () => {
    it('should start and respond to initialize', async () => {
      const initMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      const response = await sendJsonRpc(serverProcess, initMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.serverInfo.name).toBe('gemini-cli-mcp');
      expect(parsed.result.protocolVersion).toBe('2024-11-05');
      expect(parsed.result.capabilities.tools).toBeDefined();
    });

    it('should handle graceful shutdown', (done) => {
      serverProcess.on('close', (code) => {
        expect(code).toBe(0);
        done();
      });

      serverProcess.kill('SIGTERM');
    });
  });

  describe('Tools API', () => {
    beforeEach(async () => {
      // Initialize server first
      const initMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };
      await sendJsonRpc(serverProcess, initMessage);
    });

    it('should list available tools', async () => {
      const listMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      const response = await sendJsonRpc(serverProcess, listMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(2);
      expect(parsed.result.tools).toHaveLength(1);

      const tool = parsed.result.tools[0];
      expect(tool.name).toBe('gemini_query');
      expect(tool.description).toContain('Execute a query using the local Gemini CLI tool');
      expect(tool.inputSchema.properties.prompt).toBeDefined();
      expect(tool.inputSchema.properties.model).toBeDefined();
      expect(tool.inputSchema.required).toContain('prompt');
    });

    it('should execute gemini_query tool successfully', async () => {
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'gemini_query',
          arguments: {
            prompt: 'What is 2+2?'
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(3);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.content).toHaveLength(1);
      expect(parsed.result.content[0].type).toBe('text');
      expect(parsed.result.content[0].text).toBe('2 + 2 = 4');
    });

    it('should execute gemini_query with model parameter', async () => {
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'gemini_query',
          arguments: {
            prompt: 'Hello',
            model: 'gemini-1.5-flash'
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(4);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.content[0].text).toBe('Hello! How can I help you today?');
    });

    it('should return error for unknown tool', async () => {
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {
            prompt: 'test'
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(5);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32601); // Method not found
      expect(parsed.error.message).toContain('Unknown tool');
    });

    it('should validate tool arguments', async () => {
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'gemini_query',
          arguments: {
            // Missing required prompt
            model: 'gemini-1.5-flash'
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(6);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32602); // Invalid params
      expect(parsed.error.message).toContain('Invalid');
    });

    it('should handle empty prompt', async () => {
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'gemini_query',
          arguments: {
            prompt: ''
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(7);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.message).toContain('Invalid');
    });

    it('should handle prompt too long', async () => {
      const longPrompt = 'a'.repeat(10001);
      const toolCallMessage = {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'gemini_query',
          arguments: {
            prompt: longPrompt
          }
        }
      };

      const response = await sendJsonRpc(serverProcess, toolCallMessage);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(8);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.message).toContain('Invalid');
    });
  });

  describe('JSON Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const invalidJson = '{"invalid": json missing bracket';

      const response = await new Promise<string>((resolve, reject) => {
        let responseData = '';
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for error response'));
        }, 2000);

        const dataHandler = (data: Buffer) => {
          responseData += data.toString();
          try {
            const parsed = JSON.parse(responseData.trim());
            clearTimeout(timeoutId);
            serverProcess.stdout?.removeListener('data', dataHandler);
            resolve(responseData.trim());
          } catch (e) {
            // Not complete JSON yet
          }
        };

        serverProcess.stdout?.on('data', dataHandler);
        serverProcess.stdin?.write(invalidJson + '\n');
      });

      const parsed = JSON.parse(response);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(null);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32700); // Parse error
      expect(parsed.error.message).toBe('Invalid JSON received');
      expect(parsed.error.data.received).toContain('{"invalid": json missing bracket');
    });

    it('should handle JSON with line breaks', async () => {
      const brokenJson = `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gemini_query
  ","arguments":{"prompt":"What is 2+2?"}}}`;

      const response = await new Promise<string>((resolve) => {
        let responseData = '';
        const dataHandler = (data: Buffer) => {
          responseData += data.toString();
          try {
            const lines = responseData.trim().split('\n');
            const firstLine = lines[0];
            if (firstLine) {
              const parsed = JSON.parse(firstLine);
              if (parsed.error) {
                serverProcess.stdout?.removeListener('data', dataHandler);
                resolve(firstLine);
              }
            }
          } catch (e) {
            // Continue listening
          }
        };

        serverProcess.stdout?.on('data', dataHandler);
        serverProcess.stdin?.write(brokenJson + '\n');
      });

      const parsed = JSON.parse(response);
      expect(parsed.error.code).toBe(-32700);
      expect(parsed.error.message).toBe('Invalid JSON received');
    });
  });
});