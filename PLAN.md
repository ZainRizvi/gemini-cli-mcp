# Gemini CLI MCP Server Implementation Plan

## Overview
A Model Context Protocol (MCP) server that bridges Claude Code to the local `gemini` CLI tool. This server receives prompts via MCP and executes `gemini -p "<prompt>"` commands, returning responses through the standardized MCP protocol.

## Architecture

### Communication Flow
```
Claude Code ↔ [JSON-RPC via stdio] ↔ MCP Server ↔ [child_process] ↔ gemini CLI
```

### Project Structure
```
gemini-mcp-server/
├── src/
│   ├── index.ts          # Main MCP server entry point
│   ├── gemini-cli.ts     # CLI command wrapper
│   └── types.ts          # TypeScript interfaces
├── dist/                 # Compiled JavaScript
├── package.json
├── tsconfig.json
├── PLAN.md              # This file
└── README.md            # Setup and usage instructions
```

## Implementation Details

### Core Dependencies
- `@modelcontextprotocol/sdk` - Official MCP TypeScript SDK
- `zod` - Input validation and type safety
- TypeScript for development

### MCP Tool Definition

#### `gemini_query` Tool
- **Purpose**: Execute Gemini CLI with user prompt
- **Input Schema**:
  ```typescript
  {
    prompt: string (required) // The text prompt to send to Gemini
  }
  ```
- **Implementation**: Execute `gemini -p "<prompt>"` via Node.js `child_process`
- **Output**: Plain text response from Gemini CLI or error message

### Key Implementation Components

#### 1. MCP Server Setup (`index.ts`)
```typescript
const server = new Server({
  name: "gemini-cli-mcp",
  version: "1.0.0"
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "gemini_query",
    description: "Query Gemini AI via CLI",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" }
      },
      required: ["prompt"]
    }
  }]
}));
```

#### 2. CLI Execution (`gemini-cli.ts`)
```typescript
export async function executeGeminiCommand(prompt: string): Promise<string> {
  const command = 'gemini';
  const args = ['-p', prompt];

  // Use child_process.spawn for better control
  // Handle timeout, stderr, stdout
  // Return formatted response
}
```

#### 3. Error Handling
- CLI tool not found in PATH
- Command execution timeout (30s default)
- Non-zero exit codes
- Empty responses
- Malformed input validation

#### 4. Security Considerations
- Input sanitization for shell command injection
- Prompt length limits
- Command timeout enforcement
- Proper error message sanitization

### Development Approach

#### Phase 1: Core Implementation
1. Set up TypeScript project with MCP SDK
2. Implement basic MCP server structure
3. Add gemini CLI wrapper with error handling
4. Create single `gemini_query` tool

#### Phase 2: Validation & Testing
1. Add input validation with Zod schemas
2. Implement comprehensive error handling
3. Add unit tests for CLI wrapper
4. Test integration with Claude Code

#### Phase 3: Production Readiness
1. Add proper logging (to stderr only)
2. Performance optimization
3. Documentation completion
4. Installation scripts

## Configuration for Claude Code

### stdio Server Configuration
```json
{
  "mcpServers": {
    "gemini-cli": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/gemini-mcp-server/dist/index.js"]
    }
  }
}
```

## Testing Strategy

### Local Testing
1. Build and run server directly
2. Send JSON-RPC messages via stdin
3. Verify gemini CLI integration
4. Test error scenarios

### Claude Code Integration Testing
1. Configure server in Claude Code
2. Test via /mcp command
3. Verify tool availability and execution
4. Test various prompt types

## Future Enhancements
- Support for additional gemini CLI flags
- Streaming responses for long outputs
- Configuration file for default settings
- Multiple model support if available
- Batch prompt processing