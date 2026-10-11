/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const viewId = 'sicode.mcp';

export function registerMcpView(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(viewId, new McpViewProvider(context.extensionUri)),
		vscode.commands.registerCommand('sicode.mcp.add', () => vscode.commands.executeCommand('workbench.mcp.addConfiguration')),
		vscode.commands.registerCommand('sicode.mcp.browse', () => vscode.commands.executeCommand('workbench.mcp.browseServers')),
		vscode.commands.registerCommand('sicode.mcp.installed', () => vscode.commands.executeCommand('workbench.mcp.showInstalledServers')),
		vscode.commands.registerCommand('sicode.mcp.connect', () => vscode.commands.executeCommand('workbench.mcp.startServer', '*')),
		vscode.commands.registerCommand('sicode.mcp.workspace', () => vscode.commands.executeCommand('workbench.mcp.openWorkspaceMcpJson')),
	);
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
	<p>Add a server here or in mcp.json. Connecting a server that requires a sign-in opens the editor's authentication screen.</p>
	<button class="primary" data-command="workbench.mcp.addConfiguration" type="button">Add a server</button>
	<button data-command="workbench.mcp.browseServers" type="button">Browse servers</button>
	<button data-command="workbench.mcp.showInstalledServers" type="button">Installed servers</button>
	<button data-command="workbench.mcp.startServer" data-arg="*" type="button">Connect and sign in</button>
	<button data-command="workbench.mcp.openUserMcpJson" type="button">Open user mcp.json</button>
	<button data-command="workbench.mcp.openWorkspaceMcpJson" type="button">Open workspace mcp.json</button>
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
