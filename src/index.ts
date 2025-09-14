#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { executeGeminiCommand, sanitizePrompt } from './gemini-cli.js';
import type { GeminiQueryRequest } from './types.js';

// Input validation schema
const GeminiQuerySchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long'),
  model: z.string().optional()
});

class GeminiMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'gemini-cli-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'gemini_query',
            description: 'Execute a query using the local Gemini CLI tool',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The text prompt to send to Gemini AI',
                  minLength: 1,
                  maxLength: 10000
                },
                model: {
                  type: 'string',
                  description: 'Optional Gemini model to use (defaults to gemini-2.5-flash)',
                  examples: ['gemini-2.5-flash'],
                  default: 'gemini-2.5-flash'
                }
              },
              required: ['prompt'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name !== 'gemini_query') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }

      try {
        // Validate input
        const validatedArgs = GeminiQuerySchema.parse(args) as GeminiQueryRequest;
        const sanitizedPrompt = sanitizePrompt(validatedArgs.prompt);

        // Log to stderr (stdout is reserved for MCP protocol)
        const modelInfo = validatedArgs.model ? ` (model: ${validatedArgs.model})` : '';
        console.error(`[GeminiMCP] Executing query${modelInfo}: ${sanitizedPrompt.substring(0, 100)}...`);

        // Execute Gemini CLI command
        const result = await executeGeminiCommand(sanitizedPrompt, validatedArgs.model);

        if (!result.success) {
          throw new McpError(
            ErrorCode.InternalError,
            `Gemini CLI error: ${result.error || 'Unknown error'}`
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: result.output,
            },
          ],
        };
      } catch (error) {
        // Handle validation errors
        if (error instanceof z.ZodError) {
          const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${errorMessages}`
          );
        }

        // Handle MCP errors (re-throw)
        if (error instanceof McpError) {
          throw error;
        }

        // Handle other errors
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`[GeminiMCP] Error:`, errorMessage);

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute Gemini query: ${errorMessage}`
        );
      }
    });
  }

  async start(): Promise<void> {
    try {
      // Add JSON validation before MCP transport processes input
      this.setupJsonValidation();

      const transport = new StdioServerTransport();

      // Add global error handlers
      this.addGlobalErrorHandlers();

      await this.server.connect(transport);
      console.error('[GeminiMCP] Server started and listening on stdio');
    } catch (error) {
      console.error('[GeminiMCP] Failed to start server:', error);
      throw error;
    }
  }

  private setupJsonValidation(): void {
    let buffer = '';

    // Store original stdin data handler
    const originalDataListeners = process.stdin.listeners('data');

    // Remove all existing data listeners
    process.stdin.removeAllListeners('data');

    // Add our JSON validation handler first
    process.stdin.on('data', (chunk: Buffer) => {
      try {
        buffer += chunk.toString();

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            try {
              // Validate JSON
              JSON.parse(trimmed);

              // If valid, create new buffer and emit to original handlers
              const validData = Buffer.from(trimmed + '\n');
              for (const listener of originalDataListeners) {
                if (typeof listener === 'function') {
                  listener(validData);
                }
              }
            } catch (parseError) {
              // Send JSON-RPC error response for invalid JSON
              const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: -32700,
                  message: 'Invalid JSON received',
                  data: {
                    details: parseError instanceof Error ? parseError.message : 'JSON parsing failed',
                    received: trimmed.substring(0, 100) + (trimmed.length > 100 ? '...' : '')
                  }
                }
              };

              console.error(`[GeminiMCP] Invalid JSON received: ${trimmed.substring(0, 50)}...`);
              process.stdout.write(JSON.stringify(errorResponse) + '\n');
            }
          }
        }
      } catch (error) {
        console.error('[GeminiMCP] Error processing input:', error);

        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Internal error processing request'
          }
        };

        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });
  }

  private addGlobalErrorHandlers(): void {
    // Handle uncaught errors in the MCP server processing
    process.on('uncaughtException', (error) => {
      console.error('[GeminiMCP] Uncaught exception:', error);

      // Try to send error response if possible
      try {
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Internal server error',
            data: { details: error.message }
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      } catch (writeError) {
        console.error('[GeminiMCP] Failed to send error response:', writeError);
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[GeminiMCP] Unhandled rejection at:', promise, 'reason:', reason);

      // Try to send error response if possible
      try {
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Internal server error',
            data: { details: reason instanceof Error ? reason.message : String(reason) }
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      } catch (writeError) {
        console.error('[GeminiMCP] Failed to send error response:', writeError);
      }
    });
  }
}

// Start the server
async function main(): Promise<void> {
  const server = new GeminiMcpServer();
  await server.start();
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.error('[GeminiMCP] Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[GeminiMCP] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Global error handlers are now managed by the GeminiMcpServer class

// Start the server
if (require.main === module) {
  main().catch((error) => {
    console.error('[GeminiMCP] Failed to start server:', error);
    process.exit(1);
  });
}