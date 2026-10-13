/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { startPreview } from './previewServer.js';
import { isStarterKind, pickStarter, renderStarter, targetDir, type StarterKind } from './starters.js';

export function registerDescribe(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('sicode.describe', () => describeApp()),
		vscode.commands.registerCommand('sicode.template.website', () => createStarter('website')),
		vscode.commands.registerCommand('sicode.template.landing', () => createStarter('landing')),
		vscode.commands.registerCommand('sicode.template.whatsapp', () => createStarter('whatsapp')),
		vscode.commands.registerCommand('sicode.template.dashboard', () => createStarter('dashboard')),
	);
}

async function describeApp(): Promise<void> {
	const description = await vscode.window.showInputBox({
		title: 'Describe your app',
		prompt: 'For example: a landing page for a bakery, a WhatsApp bot, or a sales dashboard',
		ignoreFocusOut: true,
	});
	if (!description?.trim()) {
		return;
	}
	await writeProject(pickStarter(description), description.trim());
}

async function createStarter(kind: StarterKind): Promise<void> {
	const description = await vscode.window.showInputBox({
		title: 'Describe your app',
		prompt: 'A short description to put on the page',
		ignoreFocusOut: true,
	});
	if (description === undefined) {
		return;
	}
	await writeProject(kind, description.trim());
}

export async function writeProject(kind: StarterKind, description: string): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Open a folder, then describe the app again.');
		return;
	}
	let names: string[] = [];
	try {
		names = (await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name);
	} catch {
		names = [];
	}
	const dir = targetDir(description || kind, names);
	const base = dir ? vscode.Uri.joinPath(folder.uri, dir) : folder.uri;
	if (dir) {
		await vscode.workspace.fs.createDirectory(base);
	}
	const files = renderStarter(isStarterKind(kind) ? kind : 'website', description);
	const encoder = new TextEncoder();
	for (const file of files) {
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(base, file.path), encoder.encode(file.contents));
	}
	try {
		const url = await startPreview(base.fsPath);
		await vscode.env.openExternal(vscode.Uri.parse(url));
		void vscode.window.showInformationMessage(`Your app is running at ${url}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		void vscode.window.showErrorMessage(`The files are written. The preview did not start. ${message}`);
	}
}
