# Si Code

Si Code is an open-source desktop editor based on [Code - OSS](https://github.com/microsoft/vscode). It keeps the editor you already know and adds a small bring-your-own-key AI layer: chat, inline edit, and inline completions. You supply the API key. Si Code does not ship a hosted model.

The name, application id, and data folder live in [`product.json`](product.json). Packaged builds use `sicode` as the executable name and `.sicode` as the user data folder.

Si Code is licensed under the [MIT License](LICENSE.txt). It includes Code - OSS. Copyright (c) Microsoft Corporation.

## AI features

- **Chat.** Open the Chat view. The default participant is Si Code. It sees the active file and selection.
- **Inline edit.** Select code and run **Si Code: Inline Edit**, or press `Ctrl+I` (`Cmd+I` on macOS). Accept or reject the diff in the editor.
- **Completions.** With `sicode.completions.enabled` on, the first configured model can suggest text at the cursor.
- **Agent tools.** In agent mode, the model can call tools the editor already exposes, including tools from your MCP servers.

Keys are stored in secret storage. Run **Si Code: Configure AI** and paste a key for any of:

| Provider | Default model | Endpoint |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1` |
| Anthropic | `claude-sonnet-4-5` | `https://api.anthropic.com` |
| Google Gemini | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenRouter | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1` |
| OpenAI-compatible (Ollama and others) | `llama3.2` | `http://127.0.0.1:11434/v1` |

You can also add a key from the chat model picker with **Manage Models**. Those keys are stored by the editor as language-model secrets. Either path works.

## MCP servers

Si Code uses the editor's built-in MCP support. Put servers in `mcp.json`. The chat agent calls their tools through the same tool loop as any other editor tool, using the model selected for your key.

User config: **Si Code: Open MCP Configuration**. Workspace config can live in `.vscode/mcp.json` or, when `chat.mcp.workspaceRootConfig.enabled` is on, in `.mcp.json` at the workspace root.

```json
{
  "servers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"]
    },
    "remote-tools": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

Stdio servers speak newline-delimited JSON-RPC. HTTP servers use streamable HTTP. Both shapes above are the editor's schema (`servers`, not `mcpServers`).

## Marketplace and telemetry

The extension gallery points at [Open VSX](https://open-vsx.org). Product telemetry is off (`enableTelemetry` in `product.json`, and the telemetry level defaults to off).

## Build

Requirements: Node.js from [`.nvmrc`](.nvmrc), Python 3, and a C++ toolchain. On Linux, also install `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, and `libkrb5-dev`.

```bash
npm install
./scripts/code.sh
```

Packaged desktop builds are produced by the existing gulp tasks. [`.github/workflows/sicode-release.yml`](.github/workflows/sicode-release.yml) runs them for Windows (x64, arm64), macOS (x64, arm64), and Linux (x64, arm64) on a tag `v*` or a manual dispatch. Each job uploads the application folder (`VSCode-<platform>-<arch>`).

The Si Code extension typechecks on its own:

```bash
npx tsc -p extensions/sicode
node --test extensions/sicode/test/mcp.e2e.test.mjs
```

That test starts a real stdio MCP server and a real HTTP MCP server, then runs the chat tool loop against both.

## What is not in this pass

- Editing several files in one agent turn, beyond the tools your MCP servers already provide and the single selection diff.
- Signed installers (`.exe`, `.dmg`, `.deb`). The release workflow packages the application folders.
- A hosted model. Si Code only calls the endpoint for the key you provide.
