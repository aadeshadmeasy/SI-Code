# SI Code

SI Code (Super Intelligence Code) is a free, open-source desktop editor. You bring your own API key. Chat, inline edit, completions, and agent mode use that key. It includes [Code - OSS](https://github.com/microsoft/vscode) under the [MIT License](LICENSE.txt). Copyright (c) Microsoft Corporation.

The executable and CLI name stay `sicode`. User data is stored in `.sicode`. The window title, About dialog, and welcome page say SI Code.

## Download

[SI Code v0.1.0](https://github.com/aadeshadmeasy/SI-Code/releases/tag/v0.1.0)

| Platform | Archive |
| --- | --- |
| Linux x64 | [SiCode-linux-x64.tar.gz](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SiCode-linux-x64.tar.gz) |
| Linux arm64 | [SiCode-linux-arm64.tar.gz](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SiCode-linux-arm64.tar.gz) |
| macOS Apple silicon | [SI-Code-darwin-arm64.dmg](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SI-Code-darwin-arm64.dmg) |
| macOS Intel | [SI-Code-darwin-x64.dmg](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SI-Code-darwin-x64.dmg) |
| Windows x64 | [SiCode-win32-x64.zip](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SiCode-win32-x64.zip) |
| Windows arm64 | [SiCode-win32-arm64.zip](https://github.com/aadeshadmeasy/SI-Code/releases/download/v0.1.0/SiCode-win32-arm64.zip) |

On macOS, open the disk image and drag `SI Code.app` to Applications. The app is ad-hoc signed and not notarized. First launch: right-click `SI Code.app` and choose Open, or run `xattr -dr com.apple.quarantine "/Applications/SI Code.app"`. On Windows, SmartScreen warns because the zip is unsigned. Choose More info, then Run anyway. Linux and macOS archives start with `sicode`. Windows starts with `SI Code.exe`.

## Bring your own key

Run **SI Code: Configure AI** and paste a key. The key stays in the editor's secret storage on this machine.

**SI Code: Sign in with Google** opens the browser, listens on `127.0.0.1:33418`, and keeps the session in secret storage. The signed-in email shows in the status bar and the Accounts menu. Provider and model choices sync to your account. API keys stay on this machine.

| Provider | Default model | Endpoint |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1` |
| Anthropic | `claude-sonnet-4-5` | `https://api.anthropic.com` |
| Google Gemini | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| Sarvam | `sarvam-105b` | `https://api.sarvam.ai/v1` |
| OpenRouter | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1` |
| OpenAI-compatible (Ollama and others) | `llama3.2` | `http://127.0.0.1:11434/v1` |

Sarvam's chat completions API is OpenAI-compatible. SI Code sends the key as `Authorization: Bearer` and as `api-subscription-key`. `sarvam-105b-conversations` can be set as the model for dialogue.

- **Chat.** Open the Chat view. It sees the active file and selection.
- **Inline edit.** Select code and run **SI Code: Inline Edit**, or press `Ctrl+I` (`Cmd+I` on macOS). Accept or reject the diff in the editor.
- **Completions.** With `sicode.completions.enabled` on, the first configured model can suggest text at the cursor.
- **Agent.** In agent mode the model reads and edits files, checks diagnostics, and runs builds, tests, and linters. Terminal commands ask you to approve them before they run.

You can also add a key from the chat model picker with **Manage Models**. Those keys are stored by the editor as language-model secrets. Either path works.

## MCP servers

The SI Code activity-bar view adds a server, browses the gallery, opens installed servers, and connects them. Connecting a server that needs a sign-in uses the editor's MCP authentication screen.

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

Python files are highlighted by the built-in Python grammar. **SI Code: Run Python File** runs the active file with `python3` (`py -3` on Windows) in the terminal. Opening a Python file recommends the Python extension from Open VSX (`ms-python.python`) so a language server can be installed. Agent mode can run Python through the terminal tool.

## Marketplace and telemetry

The extension gallery points at [Open VSX](https://open-vsx.org). Product telemetry is off (`enableTelemetry` in `product.json`, and the telemetry level defaults to off). There is no update service and no crash-upload URL. Report a problem from Help, which opens [this repository's issues](https://github.com/aadeshadmeasy/SI-Code/issues/new).

## Build

Requirements: Node.js from [`.nvmrc`](.nvmrc), Python 3, and a C++ toolchain. On Linux, also install `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, and `libkrb5-dev`.

```bash
npm install
./scripts/code.sh
```

[`.github/workflows/sicode-release.yml`](.github/workflows/sicode-release.yml) packages Windows (x64, arm64), macOS (x64, arm64), and Linux (x64, arm64). A tag `v*` publishes a GitHub Release named `SI Code <tag>` whose assets are `SiCode-<platform>-<arch>` archives (`.tar.gz` on Linux and macOS, `.zip` on Windows).

The SI Code extension typechecks on its own:

```bash
npx tsc -p extensions/sicode
node --test extensions/sicode/test/mcp.e2e.test.mjs
```

That test starts a real stdio MCP server and a real HTTP MCP server, then runs the chat tool loop against both.
