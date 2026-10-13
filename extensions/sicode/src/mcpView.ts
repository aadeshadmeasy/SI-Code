/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { applySecrets, enablePreset, mcpPresets, missingSecrets, presetButtonsHtml, presetById, secretStorageKey } from './mcpPresets.js';

const viewId = 'sicode.mcp';
const enabledKey = 'sicode.mcp.enabled';

export function registerMcpView(context: vscode.ExtensionContext): void {
	const changed = new vscode.EventEmitter<void>();
	context.subscriptions.push(
		changed,
		vscode.lm.registerMcpServerDefinitionProvider('sicode.presets', new PresetProvider(context, changed.event)),
		vscode.window.registerWebviewViewProvider(viewId, new McpViewProvider(context.extensionUri)),
		vscode.commands.registerCommand('sicode.mcp.add', () => vscode.commands.executeCommand('workbench.mcp.addConfiguration')),
		vscode.commands.registerCommand('sicode.mcp.browse', () => vscode.commands.executeCommand('workbench.mcp.browseServers')),
		vscode.commands.registerCommand('sicode.mcp.installed', () => vscode.commands.executeCommand('workbench.mcp.showInstalledServers')),
		vscode.commands.registerCommand('sicode.mcp.connect', () => vscode.commands.executeCommand('workbench.mcp.startServer', '*')),
		vscode.commands.registerCommand('sicode.mcp.workspace', () => vscode.commands.executeCommand('workbench.mcp.openWorkspaceMcpJson')),
		vscode.commands.registerCommand('sicode.mcp.preset', (id: string) => enableFromPrompt(context, String(id), changed)),
	);
}

class PresetProvider implements vscode.McpServerDefinitionProvider {
	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly onDidChangeMcpServerDefinitions: vscode.Event<void>,
	) { }

	provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
		const enabled = this.context.globalState.get<string[]>(enabledKey) ?? [];
		const definitions: vscode.McpServerDefinition[] = [];
		for (const id of enabled) {
			const preset = presetById(id);
			if (!preset) {
				continue;
			}
			if (preset.transport === 'http' && preset.url) {
				definitions.push(new vscode.McpHttpServerDefinition(preset.label, vscode.Uri.parse(preset.url)));
			} else {
				definitions.push(new vscode.McpStdioServerDefinition(preset.label, preset.command, [...preset.args]));
			}
		}
		return definitions;
	}

	async resolveMcpServerDefinition(server: vscode.McpServerDefinition): Promise<vscode.McpServerDefinition | undefined> {
		const preset = mcpPresets.find(item => item.label === server.label);
		if (!preset) {
			return server;
		}
		const secrets: Record<string, string> = {};
		for (const field of preset.secrets) {
			secrets[field.name] = await this.context.secrets.get(secretStorageKey(preset.id, field.name)) ?? '';
		}
		if (missingSecrets(preset, secrets).length > 0) {
			return undefined;
		}
		const applied = applySecrets(preset, secrets);
		if (preset.transport === 'http' && 'uri' in server) {
			server.headers = { ...server.headers, ...applied.headers };
			return server;
		}
		if ('command' in server) {
			server.env = { ...server.env, ...applied.env };
			server.args = applied.args;
		}
		return server;
	}
}

async function enableFromPrompt(context: vscode.ExtensionContext, id: string, changed: vscode.EventEmitter<void>): Promise<void> {
	const preset = presetById(id);
	if (!preset) {
		return;
	}
	for (const field of preset.secrets) {
		const value = await vscode.window.showInputBox({
			title: preset.label,
			prompt: field.prompt,
			password: field.password,
			ignoreFocusOut: true,
		});
		if (value === undefined || (!value && !field.optional)) {
			return;
		}
		if (value) {
			await context.secrets.store(secretStorageKey(preset.id, field.name), value);
		}
	}
	const enabled = context.globalState.get<string[]>(enabledKey) ?? [];
	await context.globalState.update(enabledKey, enablePreset(enabled, preset.id));
	changed.fire();
	void vscode.window.showInformationMessage(`${preset.label} is saved. The secret stays in secret storage and is applied when the server starts.`);
}

class McpViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly extensionUri: vscode.Uri) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		const nonce = Math.random().toString(36).slice(2);
		webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
		webviewView.webview.html = html(nonce);
		webviewView.webview.onDidReceiveMessage(message => {
			const command = typeof message?.command === 'string' ? message.command : '';
			if (command) {
				void vscode.commands.executeCommand(command, message.arg);
			}
		});
	}
}

function html(nonce: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: transparent; margin: 0; padding: 12px 14px 20px; line-height: 1.45; }
		h1 { font-size: 15px; margin: 0 0 6px; }
		p { margin: 0 0 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
		button { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, transparent); background: var(--vscode-button-secondaryBackground, #1F6F6A); color: var(--vscode-button-secondaryForeground, #F4F7F6); cursor: pointer; }
		button.primary { background: #1F6F6A; color: #F4F7F6; border-color: transparent; }
	</style>
</head>
<body>
	<h1>MCP servers</h1>
	<p>Add a server here or in mcp.json. A saved sign-in is reused and refreshed. A browser opens only when that sign-in is no longer valid. An Authorization header in mcp.json is sent as the API key or personal access token and does not open a sign-in window.</p>
	<p>If a server fails, its error is on the server in the MCP list. Retry starts it again.</p>
	<button class="primary" data-command="workbench.mcp.addConfiguration" type="button">Add a server</button>
	<button data-command="workbench.mcp.browseServers" type="button">Browse servers</button>
	<button data-command="workbench.mcp.showInstalledServers" type="button">Installed servers</button>
	<button data-command="workbench.mcp.startServer" data-arg="*" type="button">Retry servers</button>
	<button data-command="workbench.mcp.openUserMcpJson" type="button">Open user mcp.json</button>
	<button data-command="workbench.mcp.openWorkspaceMcpJson" type="button">Open workspace mcp.json</button>
	<h1>Presets</h1>
	<p>One click asks for the token once. It is stored in secret storage and sent only when that server starts.</p>
	${presetButtonsHtml()}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		for (const button of document.querySelectorAll('button')) {
			button.addEventListener('click', () => {
				vscode.postMessage({ command: button.getAttribute('data-command'), arg: button.getAttribute('data-arg') || undefined });
			});
		}
	</script>
</body>
</html>`;
}
