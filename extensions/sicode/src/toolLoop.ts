/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ToolSpec {
	name: string;
	description: string;
	inputSchema?: object;
}

export type ModelPart =
	| { type: 'text'; text: string }
	| { type: 'tool'; callId: string; name: string; input: unknown };

export interface LoopMessage {
	role: 'system' | 'user' | 'assistant';
	text?: string;
	parts?: ModelPart[];
	toolResults?: { callId: string; text: string }[];
}

export interface ToolCallRecord {
	name: string;
	input: unknown;
	result: string;
}

const TOOL_RESULT_LIMIT = 20_000;

/**
 * Runs a model until it stops calling tools. The chat participant uses this with
 * `vscode.lm.invokeTool`, which the workbench routes to MCP servers from mcp.json.
 * The extension test drives the same loop against live stdio and HTTP servers.
 */
export async function runToolLoop(options: {
	messages: LoopMessage[];
	tools: ToolSpec[];
	complete: (messages: LoopMessage[], tools: ToolSpec[]) => Promise<ModelPart[]>;
	invokeTool: (name: string, input: unknown) => Promise<string>;
	maxRounds?: number;
}): Promise<{ text: string; calls: ToolCallRecord[]; messages: LoopMessage[] }> {
	const messages = options.messages.slice();
	const calls: ToolCallRecord[] = [];
	const maxRounds = options.maxRounds ?? 8;
	let text = '';

	for (let round = 0; round < maxRounds; round++) {
		const parts = await options.complete(messages, options.tools);
		const toolParts = parts.filter((part): part is Extract<ModelPart, { type: 'tool' }> => part.type === 'tool');
		text = parts.filter((part): part is Extract<ModelPart, { type: 'text' }> => part.type === 'text').map(part => part.text).join('');
		if (toolParts.length === 0) {
			if (text) {
				messages.push({ role: 'assistant', text });
			}
			return { text, calls, messages };
		}

		messages.push({ role: 'assistant', parts });
		const toolResults: { callId: string; text: string }[] = [];
		for (const part of toolParts) {
			let result: string;
			try {
				const input = typeof part.input === 'string' ? JSON.parse(part.input) as unknown : part.input;
				result = await options.invokeTool(part.name, input);
			} catch (err) {
				result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
			}
			if (result.length > TOOL_RESULT_LIMIT) {
				result = `${result.slice(0, TOOL_RESULT_LIMIT)}\n…truncated`;
			}
			calls.push({ name: part.name, input: part.input, result });
			toolResults.push({ callId: part.callId, text: result });
		}
		messages.push({ role: 'user', toolResults });
	}

	return { text: text || 'Stopped after the tool-call limit.', calls, messages };
}
