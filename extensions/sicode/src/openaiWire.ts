/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ToolCallState {
	id: string;
	name: string;
	args: string;
}

export interface OpenAIDelta {
	readonly content?: string;
	readonly tool_calls?: readonly {
		readonly index?: number;
		readonly id?: string;
		readonly function?: { readonly name?: string; readonly arguments?: string };
	}[];
}

/** Applies one streamed chat-completions delta. Returns text that should be shown. */
export function noteOpenAIDelta(pending: Map<number, ToolCallState>, delta: OpenAIDelta | undefined): string {
	if (!delta) {
		return '';
	}
	for (const call of delta.tool_calls ?? []) {
		const index = call.index ?? 0;
		const current = pending.get(index) ?? { id: '', name: '', args: '' };
		if (call.id) {
			current.id = call.id;
		}
		if (call.function?.name) {
			current.name += call.function.name;
		}
		if (call.function?.arguments) {
			current.args += call.function.arguments;
		}
		pending.set(index, current);
	}
	return delta.content ?? '';
}

export function authHeaders(auth: 'bearer' | 'api-key' | 'subscription', apiKey: string, extra?: Readonly<Record<string, string>>): Record<string, string> {
	const headers: Record<string, string> = { ...extra };
	if (auth === 'api-key') {
		headers['api-key'] = apiKey;
	} else {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	if (auth === 'subscription') {
		headers['api-subscription-key'] = apiKey;
	}
	return headers;
}
