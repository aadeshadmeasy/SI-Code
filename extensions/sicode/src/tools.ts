/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ToolSpec } from './toolLoop.js';

export const readTools: readonly ToolSpec[] = [
	{
		name: 'sicode_readFile',
		description: 'Read a text file from the workspace. Use this before editing so the change matches the real file.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Workspace-relative or absolute path.' },
			},
			required: ['path'],
		},
	},
	{
		name: 'sicode_listDirectory',
		description: 'List files and folders in a workspace directory.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Workspace-relative or absolute directory. Omit for the workspace root.' },
			},
		},
	},
	{
		name: 'sicode_diagnostics',
		description: 'Read editor diagnostics (errors and warnings) for one file or the whole workspace.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Optional workspace-relative or absolute file. Omit for every open diagnostic.' },
			},
		},
	},
];

export const agentTools: readonly ToolSpec[] = [
	...readTools,
	{
		name: 'sicode_writeFile',
		description: 'Create or replace a text file. Use this for new files. Prefer sicode_editFile for small changes.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Workspace-relative or absolute path.' },
				contents: { type: 'string', description: 'The full new contents of the file.' },
			},
			required: ['path', 'contents'],
		},
	},
	{
		name: 'sicode_editFile',
		description: 'Replace one exact snippet in a file. oldText must match the file exactly, including whitespace. You can edit several files by calling this tool more than once.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Workspace-relative or absolute path.' },
				oldText: { type: 'string', description: 'Exact text to replace. It must occur once in the file.' },
				newText: { type: 'string', description: 'Replacement text.' },
			},
			required: ['path', 'oldText', 'newText'],
		},
	},
	{
		name: 'sicode_runTerminal',
		description: 'Run a shell command in the integrated terminal. The user must approve it before it runs. Use this for builds, tests, linters, and Python (python3).',
		inputSchema: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'The shell command to run, for example npm test or python3 script.py.' },
				cwd: { type: 'string', description: 'Optional workspace-relative working directory.' },
			},
			required: ['command'],
		},
	},
];

export function registerAgentTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('sicode_readFile', new ReadFileTool()),
		vscode.lm.registerTool('sicode_listDirectory', new ListDirectoryTool()),
		vscode.lm.registerTool('sicode_diagnostics', new DiagnosticsTool()),
		vscode.lm.registerTool('sicode_writeFile', new WriteFileTool()),
		vscode.lm.registerTool('sicode_editFile', new EditFileTool()),
		vscode.lm.registerTool('sicode_runTerminal', new TerminalTool()),
	);
}

function textResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function stringField(input: unknown, key: string): string {
	if (!input || typeof input !== 'object') {
		return '';
	}
	const value = (input as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : '';
}

function workspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function resolveUri(input: string | undefined, fallbackToRoot: boolean): vscode.Uri {
	const root = workspaceRoot();
	const value = (input ?? '').trim();
	if (!value) {
		if (fallbackToRoot && root) {
			return root;
		}
		throw new Error('Open a folder, or pass an absolute path.');
	}
	if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
		return vscode.Uri.file(value);
	}
	if (!root) {
		throw new Error('Open a folder before using a relative path.');
	}
	return vscode.Uri.joinPath(root, value);
}

async function readText(uri: vscode.Uri): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder().decode(bytes);
}

class ReadFileTool implements vscode.LanguageModelTool<{ path: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string }>): Promise<vscode.LanguageModelToolResult> {
		const uri = resolveUri(stringField(options.input, 'path'), false);
		const text = await readText(uri);
		const clipped = text.length > 20_000 ? `${text.slice(0, 20_000)}\n…truncated` : text;
		return textResult(clipped);
	}
}

class ListDirectoryTool implements vscode.LanguageModelTool<{ path?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path?: string }>): Promise<vscode.LanguageModelToolResult> {
		const uri = resolveUri(stringField(options.input, 'path'), true);
		const entries = await vscode.workspace.fs.readDirectory(uri);
		const lines = entries
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([name, type]) => `${type === vscode.FileType.Directory ? 'dir' : 'file'}\t${name}`);
		return textResult(lines.join('\n') || '(empty)');
	}
}

class DiagnosticsTool implements vscode.LanguageModelTool<{ path?: string }> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path?: string }>): Promise<vscode.LanguageModelToolResult> {
		const requested = stringField(options.input, 'path');
		const diagnostics = requested
			? vscode.languages.getDiagnostics(resolveUri(requested, false))
			: vscode.languages.getDiagnostics().flatMap(([uri, items]) => items.map(item => ({ uri, item })));
		if (requested) {
			return textResult(formatDiagnostics(resolveUri(requested, false), diagnostics as vscode.Diagnostic[]));
		}
		const grouped = diagnostics as { uri: vscode.Uri; item: vscode.Diagnostic }[];
		if (grouped.length === 0) {
			return textResult('No diagnostics.');
		}
		const lines = grouped.slice(0, 80).map(({ uri, item }) => formatItem(uri, item));
		return textResult(lines.join('\n'));
	}
}

function formatDiagnostics(uri: vscode.Uri, items: readonly vscode.Diagnostic[]): string {
	if (items.length === 0) {
		return 'No diagnostics.';
	}
	return items.map(item => formatItem(uri, item)).join('\n');
}

function formatItem(uri: vscode.Uri, item: vscode.Diagnostic): string {
	const severity = item.severity === vscode.DiagnosticSeverity.Error ? 'error'
		: item.severity === vscode.DiagnosticSeverity.Warning ? 'warning'
			: 'info';
	return `${severity}\t${uri.fsPath}:${item.range.start.line + 1}:${item.range.start.character + 1}\t${item.message}`;
}

class WriteFileTool implements vscode.LanguageModelTool<{ path: string; contents: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; contents: string }>): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: `Write ${stringField(options.input, 'path')}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; contents: string }>): Promise<vscode.LanguageModelToolResult> {
		const uri = resolveUri(stringField(options.input, 'path'), false);
		const contents = stringField(options.input, 'contents');
		const edit = new vscode.WorkspaceEdit();
		let exists = true;
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			exists = false;
		}
		if (!exists) {
			edit.createFile(uri, { overwrite: true, contents: new TextEncoder().encode(contents) });
		} else {
			const document = await vscode.workspace.openTextDocument(uri);
			const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
			edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), end), contents);
		}
		const applied = await vscode.workspace.applyEdit(edit);
		return textResult(applied ? `Wrote ${uri.fsPath}` : `Could not write ${uri.fsPath}`);
	}
}

class EditFileTool implements vscode.LanguageModelTool<{ path: string; oldText: string; newText: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; oldText: string; newText: string }>): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: `Edit ${stringField(options.input, 'path')}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; oldText: string; newText: string }>): Promise<vscode.LanguageModelToolResult> {
		const uri = resolveUri(stringField(options.input, 'path'), false);
		const oldText = stringField(options.input, 'oldText');
		const newText = stringField(options.input, 'newText');
		if (!oldText) {
			return textResult('oldText is empty. Read the file and pass the exact snippet to replace.');
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const text = document.getText();
		const first = text.indexOf(oldText);
		if (first < 0) {
			return textResult('oldText was not found. Read the file and copy the exact snippet.');
		}
		if (text.indexOf(oldText, first + oldText.length) >= 0) {
			return textResult('oldText matches more than once. Include more surrounding lines so the match is unique.');
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(document.positionAt(first), document.positionAt(first + oldText.length)), newText);
		const applied = await vscode.workspace.applyEdit(edit);
		return textResult(applied ? `Edited ${uri.fsPath}` : `Could not edit ${uri.fsPath}`);
	}
}

class TerminalTool implements vscode.LanguageModelTool<{ command: string; cwd?: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ command: string; cwd?: string }>): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const command = stringField(options.input, 'command');
		return {
			invocationMessage: `Run \`${command}\``,
			confirmationMessages: {
				title: 'SI Code wants to run a command',
				message: command || '(empty command)',
			},
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ command: string; cwd?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const command = stringField(options.input, 'command').trim();
		if (!command) {
			return textResult('No command was provided.');
		}
		const cwdValue = stringField(options.input, 'cwd');
		const cwd = cwdValue ? resolveUri(cwdValue, false) : workspaceRoot();
		const output = await runInTerminal(command, cwd, token);
		return textResult(output);
	}
}

async function runInTerminal(command: string, cwd: vscode.Uri | undefined, token: vscode.CancellationToken): Promise<string> {
	const terminal = vscode.window.createTerminal({ name: 'SI Code', cwd });
	terminal.show();
	const integration = await waitForShellIntegration(terminal, token);
	if (!integration) {
		terminal.sendText(command, true);
		return 'The command was sent to the SI Code terminal. Shell integration did not become ready, so the output was not captured. Inspect the terminal before continuing.';
	}
	const execution = integration.executeCommand(command);
	let output = '';
	const deadline = Date.now() + 120_000;
	try {
		for await (const chunk of execution.read()) {
			if (token.isCancellationRequested) {
				return output ? `${output}\nCancelled.` : 'Cancelled.';
			}
			output += chunk;
			if (output.length > 20_000) {
				return `${output.slice(0, 20_000)}\n…truncated`;
			}
			if (Date.now() > deadline) {
				return `${output}\nTimed out after 120 seconds. The command may still be running in the SI Code terminal.`;
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return output ? `${output}\n${message}` : message;
	}
	return output.trim() || '(no output)';
}

function waitForShellIntegration(terminal: vscode.Terminal, token: vscode.CancellationToken): Promise<vscode.TerminalShellIntegration | undefined> {
	if (terminal.shellIntegration) {
		return Promise.resolve(terminal.shellIntegration);
	}
	return new Promise(resolve => {
		let settled = false;
		const timer = setTimeout(() => finish(undefined), 8_000);
		const subscription = vscode.window.onDidChangeTerminalShellIntegration(event => {
			if (event.terminal === terminal) {
				finish(event.shellIntegration);
			}
		});
		const cancel = token.onCancellationRequested(() => finish(undefined));
		function finish(value: vscode.TerminalShellIntegration | undefined): void {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			subscription.dispose();
			cancel.dispose();
			resolve(value ?? terminal.shellIntegration);
		}
	});
}
