/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerChatParticipants } from './chat.js';
import { registerInlineCompletions } from './inline.js';
import { SicodeProvider } from './providers.js';
import { openSettings } from './settingsView.js';
import { vendors } from './vendors.js';

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
	context.subscriptions.push(
		vscode.commands.registerCommand('sicode.configure', () => openSettings(context)),
		vscode.commands.registerCommand('sicode.inlineEdit', () => vscode.commands.executeCommand('inlineChat.start')),
		vscode.commands.registerCommand('sicode.openMcp', () => vscode.commands.executeCommand('workbench.mcp.openUserMcpJson')),
	);
}

export function deactivate(): void { }
