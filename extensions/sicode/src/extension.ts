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
import { runProcess } from './proc.js';
import { awsPlan, extractPreviewUrl, vercelPlan, type ShipPlan } from './ship.js';

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
		vscode.commands.registerCommand('sicode.ship.vercel', () => ship('vercel')),
		vscode.commands.registerCommand('sicode.ship.aws', () => ship('aws')),
	);
}

let shipChannel: vscode.OutputChannel | undefined;

async function ship(kind: 'vercel' | 'aws'): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Open a folder before shipping.');
		return;
	}
	let names: string[] = [];
	try {
		names = (await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name);
	} catch {
		names = [];
	}
	const plan = kind === 'vercel' ? vercelPlan() : awsPlan(names);
	if (!isShipPlan(plan)) {
		void vscode.window.showInformationMessage(plan.message);
		return;
	}
	const channel = shipChannel ?? (shipChannel = vscode.window.createOutputChannel('SI Code Ship'));
	channel.show();
	channel.appendLine(`$ ${plan.command} ${plan.args.join(' ')}`);
	const result = await runProcess(plan.command, plan.args, folder.uri.fsPath);
	channel.append(result.output);
	const url = extractPreviewUrl(result.output);
	if (url) {
		const open = await vscode.window.showInformationMessage(`Preview: ${url}`, 'Open');
		if (open === 'Open') {
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}
		return;
	}
	void vscode.window.showInformationMessage(result.exitCode === 0
		? 'The deploy command finished. No preview link was found in the output.'
		: 'The deploy command failed. The SI Code Ship output has the log.');
}

function isShipPlan(plan: ShipPlan | { message: string }): plan is ShipPlan {
	return 'command' in plan;
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
