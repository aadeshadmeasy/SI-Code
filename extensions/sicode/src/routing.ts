/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LoopMessage } from './toolLoop.js';

export type RouteKind = 'cheap' | 'strong' | 'local';

export interface ModelRef {
	readonly vendor: string;
	readonly id: string;
}

const CHEAP_IDS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gemini-2.5-flash', 'gemini-2.0-flash', 'claude-haiku-4-5', 'claude-3-5-haiku-latest', 'llama-3.1-8b-instant', 'llama3.1-8b', 'openrouter/free'];
const STRONG_IDS = ['gpt-4o', 'gpt-4.1', 'claude-sonnet-4-5', 'claude-opus-4-5', 'gemini-2.5-pro', 'llama-3.3-70b-versatile'];
const LOCAL_VENDORS = ['sicode-ollama', 'sicode-lmstudio'];

const RATES: readonly { test: (id: string) => boolean; input: number; output: number }[] = [
	{ test: id => /gpt-4o-mini|gpt-4\.1-mini|o4-mini|o3-mini/.test(id), input: 0.15, output: 0.6 },
	{ test: id => /gpt-4o|gpt-4\.1/.test(id), input: 2.5, output: 10 },
	{ test: id => /haiku/.test(id), input: 1, output: 5 },
	{ test: id => /opus/.test(id), input: 5, output: 25 },
	{ test: id => /sonnet|claude/.test(id), input: 3, output: 15 },
	{ test: id => /flash/.test(id), input: 0.15, output: 0.6 },
];

export function routeTask(prompt: string, options: { mode?: string; preferLocal?: boolean } = {}): RouteKind {
	const text = prompt.toLowerCase();
	if (options.preferLocal || /\bollama\b|\blm studio\b|\blocal model\b/.test(text)) {
		return 'local';
	}
	if (options.mode === 'agent' || options.mode === 'edit' || options.mode === 'inline') {
		return 'strong';
	}
	if (/\b(refactor|implement|rewrite|migrate|multi-file|across files)\b/.test(text)) {
		return 'strong';
	}
	return 'cheap';
}

export function pickModel(kind: RouteKind, available: readonly ModelRef[], prefs: { cheap?: string; strong?: string; local?: string }): ModelRef | undefined {
	const pref = kind === 'cheap' ? prefs.cheap : kind === 'strong' ? prefs.strong : prefs.local;
	const parsed = parsePref(pref ?? '');
	if (parsed) {
		const match = available.find(model => parsed.vendor ? model.vendor === parsed.vendor && model.id === parsed.id : model.id === parsed.id);
		if (match) {
			return match;
		}
	}
	if (kind === 'local') {
		return available.find(model => LOCAL_VENDORS.includes(model.vendor));
	}
	const ids = kind === 'cheap' ? CHEAP_IDS : STRONG_IDS;
	for (const id of ids) {
		const match = available.find(model => model.id === id);
		if (match) {
			return match;
		}
	}
	if (kind === 'cheap') {
		return available.find(model => /mini|flash|haiku|8b/i.test(model.id));
	}
	return available.find(model => !LOCAL_VENDORS.includes(model.vendor));
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function messageChars(messages: readonly LoopMessage[]): number {
	let chars = 0;
	for (const message of messages) {
		chars += message.text?.length ?? 0;
		for (const part of message.parts ?? []) {
			chars += part.type === 'text' ? part.text.length : part.name.length;
		}
		for (const result of message.toolResults ?? []) {
			chars += result.text.length;
		}
	}
	return chars;
}

export function estimateCost(modelId: string, vendor: string, inputTokens: number, outputTokens: number): { usd: number; known: boolean } {
	if (/ollama|lmstudio/.test(vendor) || /llama3\.2|local-model/.test(modelId)) {
		return { usd: 0, known: true };
	}
	const rate = RATES.find(entry => entry.test(modelId));
	if (!rate) {
		return { usd: 0, known: false };
	}
	const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
	return { usd, known: true };
}

export function formatMeter(input: { kind: RouteKind; modelId: string; inputTokens: number; outputTokens: number; chatUsd: number; known: boolean; totalUsd: number }): string {
	const price = input.known ? formatUsd(input.chatUsd) : 'unlisted';
	return `${input.kind} model \`${input.modelId}\` · ${input.inputTokens} in / ${input.outputTokens} out tokens · ${price} this reply · ${formatUsd(input.totalUsd)} this workspace`;
}

export function formatUsd(value: number): string {
	if (value === 0) {
		return '$0';
	}
	if (value < 0.01) {
		return `$${value.toFixed(4)}`;
	}
	return `$${value.toFixed(2)}`;
}

function parsePref(value: string): { vendor: string; id: string } | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const slash = trimmed.indexOf('/');
	if (slash > 0 && trimmed.slice(0, slash).startsWith('sicode-')) {
		return { vendor: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
	}
	return { vendor: '', id: trimmed };
}
