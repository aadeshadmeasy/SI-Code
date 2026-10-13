/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { clearChanges, dropReview, getReview, listChanges, pickCheckCommand, reviewMarkdown, runAgentWithReview, storeReview } from './agentReview.js';
import { explainChange, explainError } from './explain.js';
import { searchWorkspace } from './codeIndex.js';
import { runProcess } from './proc.js';
import { formatWhereHits, isWhereQuestion, rulesPrompt } from './projectMemory.js';
import { estimateCost, estimateTokens, formatMeter, messageChars, pickModel, routeTask, userConfiguredModels, type RouteKind } from './routing.js';
import { agentTools, readTools } from './tools.js';
import { runToolLoop, type LoopMessage, type ModelPart, type ToolSpec } from './toolLoop.js';

export type SiCodeMode = 'ask' | 'edit' | 'agent' | 'inline';

export function registerChatParticipants(context: vscode.ExtensionContext): void {
	const iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
	for (const mode of ['ask', 'edit', 'agent', 'inline'] as const) {
		const participant = vscode.chat.createChatParticipant(`sicode.${mode}`, createHandler(mode, context));
		participant.iconPath = iconPath;
		if (mode === 'ask' || mode === 'agent') {
			participant.additionalWelcomeMessage = new vscode.MarkdownString(mode === 'agent'
				? 'Agent mode reads and edits files, then runs builds, tests, and linters. Terminal commands ask you before they run.'
				: 'Ask about the open file, or switch to Agent to let SI Code change the project.');
		}
		context.subscriptions.push(participant);
	}
	registerReviewCommands(context);
}

function createHandler(mode: SiCodeMode, context: vscode.ExtensionContext): vscode.ChatRequestHandler {
	return async (request, _chatContext, response, token) => {
		const tools = toolsFor(mode, request);
		const rules = await readProjectRules();
		let where = '';
		if (isWhereQuestion(request.prompt)) {
			try {
				where = formatWhereHits(await searchWorkspace(request.prompt));
			} catch {
				where = '';
			}
		}
		const messages = buildMessages(mode, request, _chatContext, rules, where);
		const routed = await resolveModel(request.model, request.prompt, mode);
		try {
			let text = '';
			let calls = 0;
			if (mode === 'agent') {
				clearChanges();
				const checkCommand = await detectCheckCommand();
				const outcome = await runAgentWithReview({
					messages,
					tools,
					maxRounds: 24,
					listChanges,
					checkCommand,
					runCheck: command => runProcess(command.command, command.args, workspaceDir()),
					complete: (next, toolDefs) => completeWithModel(routed.model, next, toolDefs, token),
					invokeTool: (name, input) => invokeChatTool(name, input, request, token),
				});
				text = outcome.text;
				calls = outcome.calls.length;
				if (text) {
					response.markdown(text);
				}
				if (outcome.changes.length > 0) {
					const id = storeReview(outcome.changes);
					clearChanges();
					response.markdown(reviewMarkdown(outcome.changes, outcome.check));
					response.markdown(outcome.changes.map(change => explainChange(change.path, change.before === null)).join('\n\n'));
					response.button({ command: 'sicode.review.keep', title: 'Keep', arguments: [id] });
					response.button({ command: 'sicode.review.revert', title: 'Revert', arguments: [id] });
					if (outcome.check && !outcome.check.ok) {
						response.markdown(explainError(outcome.check.errors));
						response.button({ command: 'sicode.fixIt', title: 'Fix it', arguments: [outcome.check.errors] });
					}
				}
			} else {
				const result = await runToolLoop({
					messages,
					tools,
					maxRounds: tools.length ? 8 : 1,
					complete: (next, toolDefs) => completeWithModel(routed.model, next, toolDefs, token),
					invokeTool: (name, input) => invokeChatTool(name, input, request, token),
				});
				text = result.text;
				calls = result.calls.length;
				if (mode === 'edit' || mode === 'inline') {
					await applyEdit(text, response);
				} else if (text) {
					response.markdown(text);
				}
			}
			if (!text && calls === 0 && mode !== 'edit' && mode !== 'inline') {
				response.markdown('The model returned an empty response.');
			}
			response.markdown(usageLine(context, routed.kind, routed.model, messages, text));
		} catch (err) {
			if (token.isCancellationRequested) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			response.markdown(`SI Code could not complete the request. ${message}`);
		}
	};
}

function registerReviewCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('sicode.review.keep', (id: string) => {
			dropReview(String(id));
			void vscode.window.showInformationMessage('Kept the agent edits.');
		}),
		vscode.commands.registerCommand('sicode.review.revert', async (id: string) => {
			const changes = getReview(String(id));
			if (!changes) {
				void vscode.window.showInformationMessage('Those edits are no longer available to revert.');
				return;
			}
			for (const change of changes) {
				const uri = vscode.Uri.file(change.path);
				if (change.before === null) {
					await vscode.workspace.fs.delete(uri);
				} else {
					await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(change.before));
				}
			}
			dropReview(String(id));
			void vscode.window.showInformationMessage(`Reverted ${changes.length} file${changes.length === 1 ? '' : 's'}.`);
		}),
	);
}

function usageLine(context: vscode.ExtensionContext, kind: RouteKind, model: vscode.LanguageModelChat, messages: LoopMessage[], text: string): string {
	const inputTokens = Math.ceil(messageChars(messages) / 4);
	const outputTokens = estimateTokens(text);
	const cost = estimateCost(model.id, model.vendor, inputTokens, outputTokens);
	const key = 'sicode.meter';
	const prev = context.workspaceState.get<{ usd: number }>(key) ?? { usd: 0 };
	const totalUsd = prev.usd + cost.usd;
	void context.workspaceState.update(key, { usd: totalUsd });
	return formatMeter({ kind, modelId: model.id, inputTokens, outputTokens, chatUsd: cost.usd, known: cost.known, totalUsd });
}

async function resolveModel(fallback: vscode.LanguageModelChat, prompt: string, mode: SiCodeMode): Promise<{ model: vscode.LanguageModelChat; kind: RouteKind }> {
	const config = vscode.workspace.getConfiguration('sicode.routing');
	const kind = routeTask(prompt, { mode, preferLocal: config.get<boolean>('preferLocal') === true });
	let available: vscode.LanguageModelChat[] = [];
	try {
		available = userConfiguredModels(await vscode.lm.selectChatModels());
	} catch {
		available = [];
	}
	if (available.length === 0) {
		if (fallback.vendor.startsWith('sicode-')) {
			return { model: fallback, kind };
		}
		throw new Error('No SI Code model is configured. Run SI Code: Get Free API Keys, add the model, and try again.');
	}
	const picked = pickModel(kind, available.map(model => ({ vendor: model.vendor, id: model.id })), {
		cheap: config.get<string>('cheapModel') ?? '',
		strong: config.get<string>('strongModel') ?? '',
		local: config.get<string>('localModel') ?? '',
	});
	const match = picked ? available.find(model => model.vendor === picked.vendor && model.id === picked.id) : undefined;
	return { model: match ?? fallback, kind };
}

async function readProjectRules(): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return '';
	}
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.sicode', 'rules.md'));
		return rulesPrompt(new TextDecoder().decode(bytes));
	} catch {
		return '';
	}
}

async function detectCheckCommand() {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return undefined;
	}
	let names: string[] = [];
	try {
		names = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name);
	} catch {
		return undefined;
	}
	let packageJson: string | undefined;
	if (names.includes('package.json')) {
		try {
			packageJson = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'package.json')));
		} catch {
			packageJson = undefined;
		}
	}
	return pickCheckCommand(names, packageJson);
}

function workspaceDir(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

async function completeWithModel(model: vscode.LanguageModelChat, messages: LoopMessage[], tools: ToolSpec[], token: vscode.CancellationToken): Promise<ModelPart[]> {
	const response = await model.sendRequest(toLanguageMessages(messages), {
		tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
	}, token);
	const parts: ModelPart[] = [];
	for await (const part of response.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			const last = parts.at(-1);
			if (last?.type === 'text') {
				last.text += part.value;
			} else {
				parts.push({ type: 'text', text: part.value });
			}
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			parts.push({ type: 'tool', callId: part.callId, name: part.name, input: part.input });
		}
	}
	return parts;
}

async function invokeChatTool(name: string, input: unknown, request: vscode.ChatRequest, token: vscode.CancellationToken): Promise<string> {
	const result = await vscode.lm.invokeTool(name, {
		input: asObject(input),
		toolInvocationToken: request.toolInvocationToken,
	}, token);
	return result.content.map(part => part instanceof vscode.LanguageModelTextPart ? part.value : '').join('') || JSON.stringify(result.content);
}

function toolsFor(mode: SiCodeMode, request: vscode.ChatRequest): ToolSpec[] {
	if (mode !== 'ask' && mode !== 'agent') {
		return [];
	}
	const own = mode === 'agent' ? agentTools : readTools;
	const names = new Set(own.map(tool => tool.name));
	return [...own, ...enabledTools(request).filter(tool => !names.has(tool.name))];
}

function enabledTools(request: vscode.ChatRequest): ToolSpec[] {
	const tools: ToolSpec[] = [];
	for (const [info, enabled] of request.tools) {
		if (enabled && info.description) {
			tools.push({ name: info.name, description: info.description, inputSchema: info.inputSchema });
		}
	}
	return tools;
}

function buildMessages(mode: SiCodeMode, request: vscode.ChatRequest, context: vscode.ChatContext, rules: string, where: string): LoopMessage[] {
	const messages: LoopMessage[] = [{ role: 'system', text: systemPrompt(mode, request, rules) }];
	for (const turn of context.history) {
		if (turn instanceof vscode.ChatRequestTurn) {
			messages.push({ role: 'user', text: turn.prompt });
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const text = turn.response.map(part => part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : '').join('');
			if (text) {
				messages.push({ role: 'assistant', text });
			}
		}
	}
	const fileContext = activeFileContext();
	const parts = [where, fileContext, request.prompt].filter(Boolean);
	messages.push({ role: 'user', text: parts.join('\n\n') });
	return messages;
}

function systemPrompt(mode: SiCodeMode, request: vscode.ChatRequest, rules: string): string {
	const lines = [
		'You are SI Code, a coding assistant inside the editor. Answer using the open file, the selection, and the conversation.',
		'When tools are listed, call them to read real data instead of guessing. Tools include the user\'s MCP servers and the built-in editor tools.',
	];
	if (mode === 'edit' || mode === 'inline') {
		lines.push('Rewrite the selected code. Return one fenced code block and nothing else. The block replaces the selection.');
	} else if (mode === 'agent') {
		lines.push([
			'You are in agent mode. Keep going until the task is done or you are blocked.',
			'Read the relevant files with sicode_readFile before you edit them. Change as many files as the task needs with sicode_editFile and sicode_writeFile.',
			'Check sicode_diagnostics. Use sicode_whereIs for "where is" questions. Run the project build, tests, and linters with sicode_runTerminal, and run Python with python3 when the task involves Python.',
			'SI Code runs the project test or build after your edits and sends failures back to you before the user reviews the diff.',
			'If a command fails or diagnostics report errors you introduced, fix them and run the checks again.',
			'Every terminal command asks the user before it runs. If the user declines, say so and pick another approach.',
			'Do not claim a file changed or a command succeeded unless a tool result says so.',
		].join('\n'));
	}
	const instructions = request.modeInstructions2?.content || request.modeInstructions;
	if (instructions) {
		lines.push(instructions);
	}
	if (rules) {
		lines.push(rules);
	}
	return lines.join('\n\n');
}

function activeFileContext(): string {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return '';
	}
	const document = editor.document;
	const selection = editor.selection;
	const selected = document.getText(selection);
	if (selected) {
		return `Active file: ${document.uri.fsPath}\nSelection:\n${selected}`;
	}
	const start = Math.max(0, selection.active.line - 30);
	const end = Math.min(document.lineCount - 1, selection.active.line + 10);
	const nearby = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
	return `Active file: ${document.uri.fsPath}\nAround the cursor:\n${nearby}`;
}

async function applyEdit(text: string, response: vscode.ChatResponseStream): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const code = extractCode(text);
	if (!editor || editor.selection.isEmpty) {
		response.markdown(text);
		response.markdown('\n\nSelect the code to rewrite, then run **SI Code: Inline Edit** (`Ctrl+I` or `Cmd+I`).');
		return;
	}
	response.textEdit(editor.document.uri, vscode.TextEdit.replace(editor.selection, code));
	response.textEdit(editor.document.uri, true);
	response.markdown('Review the edit, then accept or reject it.');
}

function extractCode(text: string): string {
	const fence = /```[^\n]*\n([\s\S]*?)```/.exec(text);
	return (fence ? fence[1] : text).replace(/\s+$/, '');
}

function toLanguageMessages(messages: LoopMessage[]): vscode.LanguageModelChatMessage[] {
	const out: vscode.LanguageModelChatMessage[] = [];
	for (const message of messages) {
		if (message.toolResults) {
			out.push(vscode.LanguageModelChatMessage.User(message.toolResults.map(result =>
				new vscode.LanguageModelToolResultPart(result.callId, [new vscode.LanguageModelTextPart(result.text)])
			)));
			continue;
		}
		if (message.role === 'assistant' && message.parts) {
			out.push(vscode.LanguageModelChatMessage.Assistant(message.parts.map(part => part.type === 'text'
				? new vscode.LanguageModelTextPart(part.text)
				: new vscode.LanguageModelToolCallPart(part.callId, part.name, asObject(part.input))
			)));
			continue;
		}
		const text = message.text ?? '';
		if (message.role === 'system') {
			const system = vscode.LanguageModelChatMessage.User(text);
			system.role = vscode.LanguageModelChatMessageRole.System;
			out.push(system);
		} else if (message.role === 'assistant') {
			out.push(vscode.LanguageModelChatMessage.Assistant(text));
		} else {
			out.push(vscode.LanguageModelChatMessage.User(text));
		}
	}
	return out;
}

function asObject(input: unknown): object {
	if (input && typeof input === 'object') {
		return input;
	}
	return { value: input };
}
