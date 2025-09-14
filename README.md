# Gemini CLI MCP Server

A Model Context Protocol (MCP) server that integrates the local `gemini` CLI tool with Claude Code. This server acts as a bridge, allowing Claude Code to execute Gemini AI queries through the standardized MCP protocol.

## How It Works

This MCP server provides a simple interface between Claude Code and the Gemini CLI tool:

1. Claude Code sends a prompt via MCP protocol
2. The server receives the prompt through stdio JSON-RPC communication
3. Server executes `gemini -p "<prompt>"` as a child process
4. Gemini CLI response is captured and returned to Claude Code
5. Claude Code displays the result to the user

```
Claude Code ↔ [JSON-RPC stdio] ↔ MCP Server ↔ [child_process] ↔ gemini CLI
```

## Prerequisites

- **Node.js** v18+ installed
- **Gemini CLI** tool installed and available in your PATH
  - Test with: `gemini -p "Hello world"`
- **Claude Code** installed and configured

## Installation

1. Clone or download this repository:
   ```bash
   git clone <repository-url>
   cd gemini-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Claude Code Configuration

### Method 1: Using Claude Code CLI (Recommended)

```bash
claude mcp add gemini-cli node /absolute/path/to/gemini-mcp-server/dist/index.js
```

### Method 2: Manual Configuration

Edit your Claude Code configuration file (`~/.claude.json`):

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

**Important**: Use the absolute path to your built `index.js` file.

### Method 3: Development Mode

For development, you can run directly with ts-node:

```json
{
  "mcpServers": {
    "gemini-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["ts-node", "/absolute/path/to/gemini-mcp-server/src/index.ts"]
    }
  }
}
```

## Setup Verification

1. **Restart Claude Code** after configuration changes

2. **Check MCP server status**:
   ```bash
   claude mcp list
   ```

3. **Verify in Claude Code**:
   - Run `/mcp` command
   - Should show `gemini-cli: connected`

4. **Test the integration**:
   ```
   Hey Claude, use the gemini-cli tool to ask: "What is TypeScript?"
   ```

## Available Tools

### `gemini_query`
Executes a query using the local Gemini CLI tool.

**Parameters:**
- `prompt` (string, required): The text prompt to send to Gemini
- `model` (string, optional): Gemini model to use (defaults to `gemini-2.5-flash`)

**Example usage in Claude Code:**
```
Please use the gemini_query tool with prompt: "Explain the difference between async and await"

# With model selection (otherwise defaults to gemini-2.5-flash)
Please use the gemini_query tool with prompt: "What is TypeScript?" and model: "gemini-1.5-flash"
```

## Development

### Project Structure
```
gemini-mcp-server/
├── src/
│   ├── index.ts          # Main MCP server
│   ├── gemini-cli.ts     # CLI wrapper
│   └── types.ts          # TypeScript interfaces
├── dist/                 # Compiled output
├── package.json
├── tsconfig.json
├── PLAN.md              # Implementation details
└── README.md            # This file
```

### Development Commands

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Development with auto-reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Development Mode
For active development, you can run the server directly:

```bash
npm run dev
```

Then configure Claude Code to use `ts-node` as shown in Method 3 above.

## Troubleshooting

### Common Issues

1. **"Connection closed" error**
   - Ensure you're using absolute paths in configuration
   - Check that Node.js can execute the built file
   - Verify the gemini CLI is in your PATH

2. **"Command not found: gemini"**
   - Install the Gemini CLI tool
   - Ensure it's in your system PATH
   - Test manually: `gemini -p "test"`

3. **Server not appearing in /mcp**
   - Restart Claude Code after configuration changes
   - Check the configuration file syntax
   - Verify absolute paths are correct

4. **Tool not available**
   - Run `claude mcp list` to check server status
   - Look for connection errors in Claude Code logs

### Debugging

1. **Test the server manually**:
   ```bash
   node dist/index.js
   # Send JSON-RPC messages via stdin for testing
   ```

2. **Test with simulated responses** (when Gemini CLI quota is exhausted):
   ```bash
   GEMINI_TEST_MODE=true node dist/index.js
   # Uses simulated responses instead of calling Gemini CLI
   ```

3. **Check Gemini CLI directly**:
   ```bash
   # Test with default model (gemini-2.5-flash)
   gemini -m gemini-2.5-flash -p "Hello world"
   ```

4. **Verify Claude Code configuration**:
   ```bash
   claude mcp list
   ```

## Testing the MCP Server

### Test 1: Basic Server Test

```bash
cd /Users/zain/code/mcp/gemini-mcp-claude
node dist/index.js
```

Then send these JSON-RPC messages one by one:

```json
# 1. Initialize the server
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}

# 2. List available tools
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}

# 3. Test basic query (uses gemini-2.5-flash by default)
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gemini_query","arguments":{"prompt":"What is 2+2?"}}}

# 4. Test with model override
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"gemini_query","arguments":{"prompt":"Hello world","model":"gemini-1.5-flash"}}}
```

Press `Ctrl+C` to exit when done.

### Test 2: Test Mode (If Quota Exhausted)

```bash
cd /Users/zain/code/mcp/gemini-mcp-claude
GEMINI_TEST_MODE=true node dist/index.js
```

Send the same JSON-RPC messages as above. You'll get simulated responses instead of hitting the Gemini API.

### Test 3: Verify Gemini CLI Directly

```bash
# Test default model
gemini -m gemini-2.5-flash -p "What is 2+2?"

# Test alternative model
gemini -m gemini-1.5-flash -p "Hello world"
```

### Test 4: Configure in Claude Code

```bash
# Add to Claude Code
claude mcp add gemini-cli node $(pwd)/dist/index.js

# Verify configuration
claude mcp list

# Test in Claude Code
# Run /mcp command to see connection status
```

### Expected Results

- **Initialize**: Returns server info with protocol version
- **List tools**: Shows `gemini_query` tool with model parameter support
- **Tool calls**: Return Gemini responses or proper error messages
- **Test mode**: Returns simulated responses immediately
- **Claude Code**: Shows `gemini-cli: connected` status

If you hit quota limits, the server will timeout after 5 minutes (or 10 seconds in test mode) and return a proper error message.

## Testing

The project includes comprehensive test suites:

### Running Tests
```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (for development)
npm run test:watch
```

### Test Coverage
- **Unit Tests**: `tests/gemini-cli.test.ts` - Tests for CLI wrapper functions
- **Integration Tests**: `tests/mcp-server.test.ts` - Full MCP server testing
- **JSON Error Handling**: Tests for robust JSON parsing
- **Model Selection**: Tests for default and custom model usage
- **Validation**: Tests for input validation and error cases

The test suite provides:
- **92%+ coverage** of the CLI module
- **Full MCP protocol compliance** testing
- **Error scenario** testing (invalid JSON, timeouts, etc.)
- **Both test and production mode** validation

## Security Notes

- The server validates input to prevent command injection
- Prompts are properly escaped when passed to the shell
- Command execution is limited by timeout (5 minutes for production, 10 seconds for test mode)
- Only stderr is used for logging (stdout reserved for MCP protocol)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Claude Code
5. Submit a pull request

## License

MIT License - see LICENSE file for details.