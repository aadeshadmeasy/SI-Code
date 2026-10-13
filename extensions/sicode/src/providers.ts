/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BedrockEventDecoder, converseBody, signBedrock, type WireMessage } from './bedrock.js';
import { hasSavedModelConfiguration, resolveCredentials, type VendorSpec } from './catalog.js';
import { postJson, readSse } from './http.js';
import { authHeaders, noteOpenAIDelta, type ToolCallState } from './openaiWire.js';

const credKey = Symbol('sicode.credentials');

type RequestMessage = vscode.LanguageModelChatRequestMessage;

export class SicodeProvider implements vscode.LanguageModelChatProvider {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly spec: VendorSpec,
		readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>,
	) { }

	async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const extensionSecret = await this.context.secrets.get(this.spec.secretKey);
		if (!hasSavedModelConfiguration(options.configuration) && !extensionSecret) {
			return [];
		}
		const settings = vscode.workspace.getConfiguration('sicode');
		const fromSettings: Record<string, unknown> = {};
		const settingsModel = settings.get<string>(this.spec.modelSetting);
		if (settingsModel) {
			fromSettings.model = settingsModel;
		}
		if (this.spec.vendor === 'sicode-compatible') {
			const baseUrl = settings.get<string>('compatible.baseUrl');
			if (baseUrl) {
				fromSettings.endpoint = baseUrl;
			}
		}
		const credentials = resolveCredentials(this.spec, { ...fromSettings, ...options.configuration }, extensionSecret);
		if (!credentials) {
			return [];
		}
		const label = this.spec.models.find(model => model.id === credentials.model)?.label ?? credentials.model;
		const model: vscode.LanguageModelChatInformation = {
			id: credentials.model,
			name: label,
			family: this.spec.label,
			version: '1',
			tooltip: `${this.spec.label} · ${credentials.baseUrl}`,
			maxInputTokens: credentials.maxInputTokens,
			maxOutputTokens: 4096,
			capabilities: { toolCalling: true },
			isDefault: this.spec.vendor === 'sicode-openai',
			isUserSelectable: true,
			isBYOK: true,
		};
		Object.defineProperty(model, credKey, { value: credentials });
		return [model];
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly RequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const credentials = (model as { [credKey]?: ReturnType<typeof resolveCredentials> })[credKey];
		if (!credentials) {
			throw new Error('SI Code could not find the API key for this model. Add the model again from SI Code: Get Free API Keys.');
		}
		const tools = (options as { tools?: vscode.LanguageModelChatTool[] }).tools ?? [];
		const abort = new AbortController();
		const subscription = token.onCancellationRequested(() => abort.abort());
		try {
			if (credentials.kind === 'anthropic') {
				await this.completeAnthropic(credentials, messages, tools, progress, abort.signal);
			} else if (credentials.kind === 'gemini') {
				await this.completeGemini(credentials, messages, tools, progress, abort.signal);
			} else if (credentials.kind === 'bedrock') {
				await this.completeBedrock(credentials, messages, tools, progress, abort.signal);
			} else {
				await this.completeOpenAI(credentials, messages, tools, progress, abort.signal);
			}
		} catch (err) {
			if (token.isCancellationRequested) {
				return;
			}
			throw err;
		} finally {
			subscription.dispose();
		}
	}

	provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | RequestMessage, _token: vscode.CancellationToken): Thenable<number> {
		const value = typeof text === 'string' ? text : text.content.map(part => part instanceof vscode.LanguageModelTextPart ? part.value : '').join('');
		return Promise.resolve(Math.max(1, Math.ceil(value.length / 4)));
	}

	private async completeOpenAI(credentials: NonNullable<ReturnType<typeof resolveCredentials>>, messages: readonly RequestMessage[], tools: readonly vscode.LanguageModelChatTool[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, signal: AbortSignal): Promise<void> {
		const pending = new Map<number, ToolCallState>();
		const response = await postJson(`${credentials.baseUrl}/chat/completions`, authHeaders(credentials.auth === 'bedrock' ? 'bearer' : credentials.auth, credentials.apiKey, credentials.extraHeaders), {
			model: credentials.model,
			messages: toOpenAIMessages(messages),
			stream: true,
			...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: 'object', properties: {} } } })) } : {}),
		}, signal);
		await readSse(response, data => {
			const parsed = parseJson(data) as { choices?: { delta?: Parameters<typeof noteOpenAIDelta>[1] }[] } | undefined;
			const text = noteOpenAIDelta(pending, parsed?.choices?.[0]?.delta);
			if (text) {
				progress.report(new vscode.LanguageModelTextPart(text));
			}
		});
		reportToolCalls(progress, [...pending.values()]);
	}

	private async completeAnthropic(credentials: NonNullable<ReturnType<typeof resolveCredentials>>, messages: readonly RequestMessage[], tools: readonly vscode.LanguageModelChatTool[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, signal: AbortSignal): Promise<void> {
		const converted = toAnthropicMessages(messages);
		const blocks = new Map<number, { type: string; id: string; name: string; args: string }>();
		const response = await postJson(`${credentials.baseUrl}/v1/messages`, {
			'x-api-key': credentials.apiKey,
			'anthropic-version': '2023-06-01',
		}, {
			model: credentials.model,
			max_tokens: 4096,
			stream: true,
			...(converted.system ? { system: converted.system } : {}),
			messages: converted.messages,
			...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema ?? { type: 'object', properties: {} } })) } : {}),
		}, signal);
		await readSse(response, data => {
			const parsed = parseJson(data) as {
				type?: string;
				index?: number;
				content_block?: { type?: string; id?: string; name?: string };
				delta?: { type?: string; text?: string; partial_json?: string };
			} | undefined;
			if (!parsed) {
				return;
			}
			if (parsed.type === 'content_block_start' && parsed.content_block) {
				blocks.set(parsed.index ?? 0, {
					type: parsed.content_block.type ?? 'text',
					id: parsed.content_block.id ?? '',
					name: parsed.content_block.name ?? '',
					args: '',
				});
			} else if (parsed.type === 'content_block_delta' && parsed.delta) {
				if (parsed.delta.type === 'text_delta' && parsed.delta.text) {
					progress.report(new vscode.LanguageModelTextPart(parsed.delta.text));
				} else if (parsed.delta.type === 'input_json_delta' && parsed.delta.partial_json) {
					const block = blocks.get(parsed.index ?? 0);
					if (block) {
						block.args += parsed.delta.partial_json;
					}
				}
			}
		});
		reportToolCalls(progress, [...blocks.values()].filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, args: block.args })));
	}

	private async completeGemini(credentials: NonNullable<ReturnType<typeof resolveCredentials>>, messages: readonly RequestMessage[], tools: readonly vscode.LanguageModelChatTool[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, signal: AbortSignal): Promise<void> {
		const converted = toGeminiContents(messages);
		const model = credentials.model.replace(/^models\//, '');
		const url = `${credentials.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
		const response = await postJson(url, { 'x-goog-api-key': credentials.apiKey }, {
			...(converted.system ? { systemInstruction: { parts: [{ text: converted.system }] } } : {}),
			contents: converted.contents,
			...(tools.length ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: 'object', properties: {} } })) }] } : {}),
		}, signal);
		await readSse(response, data => {
			const parsed = parseJson(data) as { candidates?: { content?: { parts?: { text?: string; functionCall?: { name?: string; args?: object } }[] } }[] } | undefined;
			for (const part of parsed?.candidates?.[0]?.content?.parts ?? []) {
				if (part.text) {
					progress.report(new vscode.LanguageModelTextPart(part.text));
				}
				if (part.functionCall?.name) {
					progress.report(new vscode.LanguageModelToolCallPart(newId(), part.functionCall.name, part.functionCall.args ?? {}));
				}
			}
		});
	}

	private async completeBedrock(credentials: NonNullable<ReturnType<typeof resolveCredentials>>, messages: readonly RequestMessage[], tools: readonly vscode.LanguageModelChatTool[], progress: vscode.Progress<vscode.LanguageModelResponsePart>, signal: AbortSignal): Promise<void> {
		if (!credentials.accessKey || !credentials.secretKey || !credentials.region) {
			throw new Error('Amazon Bedrock needs an access key, secret key, and region.');
		}
		const body = converseBody(toWire(messages), tools.map(tool => ({
			name: tool.name,
			description: tool.description ?? '',
			inputSchema: tool.inputSchema,
		})));
		const signed = await signBedrock({
			accessKey: credentials.accessKey,
			secretKey: credentials.secretKey,
			sessionToken: credentials.sessionToken,
			region: credentials.region,
			model: credentials.model,
			body,
		});
		const response = await fetch(signed.url, {
			method: 'POST',
			headers: signed.headers,
			body,
			signal,
		});
		if (!response.ok) {
			const detail = await response.text();
			throw new Error(`HTTP ${response.status}: ${detail.slice(0, 500)}`);
		}
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('The model response was empty.');
		}
		const events = new BedrockEventDecoder();
		const toolsSeen: ToolCallState[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (!value) {
					continue;
				}
				const parsed = events.push(value);
				if (parsed.text) {
					progress.report(new vscode.LanguageModelTextPart(parsed.text));
				}
				toolsSeen.push(...parsed.tools);
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}
		toolsSeen.push(...events.flush());
		reportToolCalls(progress, toolsSeen);
	}
}

function reportToolCalls(progress: vscode.Progress<vscode.LanguageModelResponsePart>, calls: readonly ToolCallState[]): void {
	for (const call of calls) {
		if (!call.name) {
			continue;
		}
		progress.report(new vscode.LanguageModelToolCallPart(call.id || newId(), call.name, parseObject(call.args)));
	}
}

function toWire(messages: readonly RequestMessage[]): WireMessage[] {
	return messages.map(message => ({ role: roleName(message.role), parts: readParts(message) }));
}

function toOpenAIMessages(messages: readonly RequestMessage[]): object[] {
	const out: object[] = [];
	for (const message of messages) {
		const parts = readParts(message);
		const role = roleName(message.role);
		if (role === 'assistant') {
			out.push({
				role: 'assistant',
				content: parts.text || null,
				...(parts.calls.length ? { tool_calls: parts.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}),
			});
		} else if (parts.results.length) {
			for (const result of parts.results) {
				out.push({ role: 'tool', tool_call_id: result.id, content: result.text });
			}
			if (parts.text) {
				out.push({ role: 'user', content: parts.text });
			}
		} else {
			out.push({ role, content: parts.text });
		}
	}
	return out;
}

function toAnthropicMessages(messages: readonly RequestMessage[]): { system: string; messages: object[] } {
	const system: string[] = [];
	const out: object[] = [];
	for (const message of messages) {
		const parts = readParts(message);
		if (roleName(message.role) === 'system') {
			if (parts.text) {
				system.push(parts.text);
			}
			continue;
		}
		if (roleName(message.role) === 'assistant') {
			const content: object[] = [];
			if (parts.text) {
				content.push({ type: 'text', text: parts.text });
			}
			for (const call of parts.calls) {
				content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
			}
			out.push({ role: 'assistant', content });
		} else if (parts.results.length) {
			out.push({
				role: 'user',
				content: parts.results.map(result => ({ type: 'tool_result', tool_use_id: result.id, content: result.text })),
			});
		} else if (parts.text) {
			out.push({ role: 'user', content: parts.text });
		}
	}
	return { system: system.join('\n\n'), messages: out };
}

function toGeminiContents(messages: readonly RequestMessage[]): { system: string; contents: object[] } {
	const system: string[] = [];
	const contents: object[] = [];
	const names = new Map<string, string>();
	for (const message of messages) {
		const parts = readParts(message);
		if (roleName(message.role) === 'system') {
			if (parts.text) {
				system.push(parts.text);
			}
			continue;
		}
		for (const call of parts.calls) {
			names.set(call.id, call.name);
		}
		if (roleName(message.role) === 'assistant') {
			const geminiParts: object[] = [];
			if (parts.text) {
				geminiParts.push({ text: parts.text });
			}
			for (const call of parts.calls) {
				geminiParts.push({ functionCall: { name: call.name, args: call.input } });
			}
			if (geminiParts.length) {
				contents.push({ role: 'model', parts: geminiParts });
			}
		} else if (parts.results.length) {
			contents.push({
				role: 'user',
				parts: parts.results.map(result => ({ functionResponse: { name: names.get(result.id) ?? 'tool', response: { result: result.text } } })),
			});
		} else if (parts.text) {
			contents.push({ role: 'user', parts: [{ text: parts.text }] });
		}
	}
	return { system: system.join('\n\n'), contents };
}

function readParts(message: RequestMessage): { text: string; calls: { id: string; name: string; input: object }[]; results: { id: string; text: string }[] } {
	let text = '';
	const calls: { id: string; name: string; input: object }[] = [];
	const results: { id: string; text: string }[] = [];
	for (const part of message.content) {
		if (typeof part === 'string') {
			text += part;
		} else if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			calls.push({ id: part.callId, name: part.name, input: part.input });
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			results.push({
				id: part.callId,
				text: part.content.map(item => item instanceof vscode.LanguageModelTextPart ? item.value : '').join(''),
			});
		}
	}
	return { text, calls, results };
}

function roleName(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
	if (role === vscode.LanguageModelChatMessageRole.Assistant) {
		return 'assistant';
	}
	if (role === vscode.LanguageModelChatMessageRole.System) {
		return 'system';
	}
	return 'user';
}

function parseObject(raw: string): object {
	if (!raw) {
		return {};
	}
	try {
		const value = JSON.parse(raw) as unknown;
		return value && typeof value === 'object' ? value as object : { value };
	} catch {
		return { raw };
	}
}

function parseJson(data: string): unknown {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}

function newId(): string {
	return `call_${Math.random().toString(36).slice(2, 10)}`;
}
