# Si Code

Si Code is an open-source desktop editor. It includes [Code - OSS](https://github.com/microsoft/vscode) under the [MIT License](LICENSE.txt). Copyright (c) Microsoft Corporation.

The name, application id, and data folder live in [`product.json`](product.json). Packaged builds use `sicode` as the executable and CLI name, and `.sicode` as the user data folder. The default theme is Si Code.

## AI features

- **Chat.** Open the Chat view. The default participant is Si Code. It sees the active file and selection.
- **Inline edit.** Select code and run **Si Code: Inline Edit**, or press `Ctrl+I` (`Cmd+I` on macOS). Accept or reject the diff in the editor.
- **Completions.** With `sicode.completions.enabled` on, the first configured model can suggest text at the cursor.
- **Agent.** In agent mode the model reads and edits files, checks diagnostics, and runs builds, tests, and linters. Terminal commands ask you to approve them before they run. The loop continues until the task is done or it is blocked.

Keys are stored in secret storage. Run **Si Code: Configure AI** and paste a key for any of:

| Provider | Default model | Endpoint |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1` |
| Anthropic | `claude-sonnet-4-5` | `https://api.anthropic.com` |
| Google Gemini | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| Sarvam | `sarvam-105b` | `https://api.sarvam.ai/v1` |
| OpenRouter | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1` |
| OpenAI-compatible (Ollama and others) | `llama3.2` | `http://127.0.0.1:11434/v1` |

Sarvam's chat completions API is OpenAI-compatible. Si Code sends the key as `Authorization: Bearer` and as `api-subscription-key`. `sarvam-105b-conversations` can be set as the model for dialogue.

You can also add a key from the chat model picker with **Manage Models**. Those keys are stored by the editor as language-model secrets. Either path works.

## MCP servers

The Si Code activity-bar view adds a server, browses the gallery, opens installed servers, and connects them. Connecting a server that needs a sign-in uses the editor's MCP authentication screen.

User config is still a plain `mcp.json`. Workspace config can live in `.vscode/mcp.json` or, when `chat.mcp.workspaceRootConfig.enabled` is on, in `.mcp.json` at the workspace root.

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

Stdio servers speak newline-delimited JSON-RPC. HTTP servers use streamable HTTP. The schema key is `servers`.

## Python

Python files are highlighted by the built-in Python grammar. **Si Code: Run Python File** runs the active file with `python3` (`py -3` on Windows) in the terminal. Opening a Python file recommends the Python extension from Open VSX (`ms-python.python`) so a language server can be installed. Agent mode can run Python through the terminal tool.

## Marketplace and telemetry

The extension gallery points at [Open VSX](https://open-vsx.org). Product telemetry is off (`enableTelemetry` in `product.json`, and the telemetry level defaults to off).

## Build

Requirements: Node.js from [`.nvmrc`](.nvmrc), Python 3, and a C++ toolchain. On Linux, also install `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, and `libkrb5-dev`.

```bash
npm install
./scripts/code.sh
```

[`.github/workflows/sicode-release.yml`](.github/workflows/sicode-release.yml) packages Windows (x64, arm64), macOS (x64, arm64), and Linux (x64, arm64). A tag `v*` publishes a GitHub Release whose assets are `SiCode-<platform>-<arch>` archives (`.tar.gz` on Linux and macOS, `.zip` on Windows).

The Si Code extension typechecks on its own:

```bash
npx tsc -p extensions/sicode
node --test extensions/sicode/test/mcp.e2e.test.mjs
```

That test starts a real stdio MCP server and a real HTTP MCP server, then runs the chat tool loop against both.
