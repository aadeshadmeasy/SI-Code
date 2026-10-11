/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface ByteReader {
	read(): Promise<{ done: boolean; value?: Uint8Array }>;
	cancel(): Promise<void>;
}

interface FetchResponse {
	ok: boolean;
	status: number;
	text(): Promise<string>;
	body: { getReader(): ByteReader } | null;
}

declare function fetch(input: string, init?: {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}): Promise<FetchResponse>;

export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<FetchResponse> {
	return fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...headers,
		},
		body: JSON.stringify(body),
		signal,
	});
}

export async function readSse(response: FetchResponse, onData: (data: string) => void): Promise<void> {
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`HTTP ${response.status}: ${detail.slice(0, 500)}`);
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('The model response was empty.');
	}
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let splitAt = buffer.indexOf('\n\n');
			while (splitAt >= 0) {
				const raw = buffer.slice(0, splitAt);
				buffer = buffer.slice(splitAt + 2);
				const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
				if (data && data !== '[DONE]') {
					onData(data);
				}
				splitAt = buffer.indexOf('\n\n');
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}
