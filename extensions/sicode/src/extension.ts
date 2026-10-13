/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerChatParticipants } from './chat.js';
import { registerInlineCompletions } from './inline.js';
import { registerMcpView } from './mcpView.js';
import { SicodeProvider } from './providers.js';
import { registerSupabaseAuth } from './auth.js';
import { openSettings } from './settingsView.js';
import { registerAgentTools } from './tools.js';
import { vendors } from './catalog.js';
import { openFreeModels } from './freeModels.js';

export function activate(context: vscode.ExtensionContext): void {
	const modelsChanged = new vscode.EventEmitter<void>();
	context.subscriptions.push(modelsChanged);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('sicode')) {
			modelsChanged.fire();
		}
	}));
	context.subscriptions.push(context.secrets.onDidChange(event => {
		if (event.key.startsWith('sicode.')) {
			modelsChanged.fire();
		}
	}));

	for (const spec of vendors) {
		context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(spec.vendor, new SicodeProvider(context, spec, modelsChanged.event)));
	}
	registerChatParticipants(context);
	registerInlineCompletions(context);
	registerAgentTools(context);
	registerMcpView(context);
	registerSupabaseAuth(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('sicode.configure', () => openSettings(context)),
		vscode.commands.registerCommand('sicode.freeModels', () => openFreeModels()),
		vscode.commands.registerCommand('sicode.inlineEdit', () => vscode.commands.executeCommand('inlineChat.start')),
		vscode.commands.registerCommand('sicode.openMcp', () => vscode.commands.executeCommand('workbench.mcp.openUserMcpJson')),
		vscode.commands.registerCommand('sicode.runPython', () => runPython()),
	);
}

async function runPython(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const document = editor?.document;
	if (!document || document.languageId !== 'python') {
		void vscode.window.showInformationMessage('Open a Python file to run it.');
		return;
	}
	if (document.isUntitled || document.isDirty) {
		await document.save();
	}
	const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
	const quoted = `'${document.uri.fsPath.replace(/'/g, `'\\''`)}'`;
	const command = platform === 'win32' ? `py -3 ${quoted}` : `python3 ${quoted}`;
	const terminal = vscode.window.createTerminal({ name: 'Python', cwd: vscode.workspace.workspaceFolders?.[0]?.uri });
	terminal.show();
	terminal.sendText(command, true);
}

export function deactivate(): void { }
