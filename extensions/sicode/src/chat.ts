/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { agentTools, readTools } from './tools.js';
import { runToolLoop, type LoopMessage, type ModelPart, type ToolSpec } from './toolLoop.js';

export type SiCodeMode = 'ask' | 'edit' | 'agent' | 'inline';

export function registerChatParticipants(context: vscode.ExtensionContext): void {
	const iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
	for (const mode of ['ask', 'edit', 'agent', 'inline'] as const) {
		const participant = vscode.chat.createChatParticipant(`sicode.${mode}`, createHandler(mode));
		participant.iconPath = iconPath;
		if (mode === 'ask' || mode === 'agent') {
			participant.additionalWelcomeMessage = new vscode.MarkdownString(mode === 'agent'
				? 'Agent mode reads and edits files, then runs builds, tests, and linters. Terminal commands ask you before they run.'
				: 'Ask about the open file, or switch to Agent to let SI Code change the project.');
		}
		context.subscriptions.push(participant);
	}
}

function createHandler(mode: SiCodeMode): vscode.ChatRequestHandler {
	return async (request, context, response, token) => {
		const tools = toolsFor(mode, request);
		const messages = buildMessages(mode, request, context);
		try {
			const result = await runToolLoop({
				messages,
				tools,
				maxRounds: mode === 'agent' ? 24 : tools.length ? 8 : 1,
				complete: (next, toolDefs) => completeWithModel(request.model, next, toolDefs, token),
				invokeTool: (name, input) => invokeChatTool(name, input, request, token),
			});
			if (mode === 'edit' || mode === 'inline') {
				await applyEdit(result.text, response);
			} else if (result.text) {
				response.markdown(result.text);
			} else if (result.calls.length === 0) {
				response.markdown('The model returned an empty response.');
			}
		} catch (err) {
			if (token.isCancellationRequested) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			response.markdown(`SI Code could not complete the request. ${message}`);
		}
	};
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

function buildMessages(mode: SiCodeMode, request: vscode.ChatRequest, context: vscode.ChatContext): LoopMessage[] {
	const messages: LoopMessage[] = [{ role: 'system', text: systemPrompt(mode, request) }];
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
	messages.push({ role: 'user', text: fileContext ? `${fileContext}\n\n${request.prompt}` : request.prompt });
	return messages;
}

function systemPrompt(mode: SiCodeMode, request: vscode.ChatRequest): string {
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
			'Check sicode_diagnostics. Run the project build, tests, and linters with sicode_runTerminal, and run Python with python3 when the task involves Python.',
			'If a command fails or diagnostics report errors you introduced, fix them and run the checks again.',
			'Every terminal command asks the user before it runs. If the user declines, say so and pick another approach.',
			'Do not claim a file changed or a command succeeded unless a tool result says so.',
		].join('\n'));
	}
	const instructions = request.modeInstructions2?.content || request.modeInstructions;
	if (instructions) {
		lines.push(instructions);
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
