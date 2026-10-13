/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface WirePart {
	readonly text: string;
	readonly calls: readonly { readonly id: string; readonly name: string; readonly input: object }[];
	readonly results: readonly { readonly id: string; readonly text: string }[];
}

export interface WireMessage {
	readonly role: 'system' | 'user' | 'assistant';
	readonly parts: WirePart;
}

export interface BedrockTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema?: object;
}

export interface BedrockSignInput {
	readonly accessKey: string;
	readonly secretKey: string;
	readonly sessionToken?: string;
	readonly region: string;
	readonly model: string;
	readonly body: string;
	readonly now?: Date;
}

export interface BedrockEvent {
	readonly text?: string;
	readonly toolStart?: { readonly id: string; readonly name: string };
	readonly toolInput?: string;
	readonly toolStop?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function converseBody(messages: readonly WireMessage[], tools: readonly BedrockTool[]): string {
	const system: string[] = [];
	const converseMessages: object[] = [];
	for (const message of messages) {
		if (message.role === 'system') {
			if (message.parts.text) {
				system.push(message.parts.text);
			}
			continue;
		}
		if (message.role === 'assistant') {
			const content: object[] = [];
			if (message.parts.text) {
				content.push({ text: message.parts.text });
			}
			for (const call of message.parts.calls) {
				content.push({ toolUse: { toolUseId: call.id, name: call.name, input: call.input } });
			}
			if (content.length) {
				converseMessages.push({ role: 'assistant', content });
			}
			continue;
		}
		if (message.parts.results.length) {
			converseMessages.push({
				role: 'user',
				content: message.parts.results.map(result => ({
					toolResult: { toolUseId: result.id, content: [{ text: result.text }] },
				})),
			});
		}
		if (message.parts.text) {
			converseMessages.push({ role: 'user', content: [{ text: message.parts.text }] });
		}
	}
	return JSON.stringify({
		...(system.length ? { system: [{ text: system.join('\n\n') }] } : {}),
		messages: converseMessages,
		inferenceConfig: { maxTokens: 4096 },
		...(tools.length ? {
			toolConfig: {
				tools: tools.map(tool => ({
					toolSpec: {
						name: tool.name,
						description: tool.description,
						inputSchema: { json: tool.inputSchema ?? { type: 'object', properties: {} } },
					},
				})),
			},
		} : {}),
	});
}

export async function signBedrock(input: BedrockSignInput): Promise<{ url: string; headers: Record<string, string> }> {
	const now = input.now ?? new Date();
	const amzDate = amzTimestamp(now);
	const dateStamp = amzDate.slice(0, 8);
	const host = `bedrock-runtime.${input.region}.amazonaws.com`;
	const canonicalUri = `/model/${encodePathSegment(input.model)}/converse-stream`;
	const payloadHash = await sha256Hex(input.body);
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
	};
	if (input.sessionToken) {
		headers['x-amz-security-token'] = input.sessionToken;
	}
	const signedHeaderNames = Object.keys(headers).sort();
	const canonicalHeaders = signedHeaderNames.map(name => `${name}:${headers[name].trim()}\n`).join('');
	const signedHeaders = signedHeaderNames.join(';');
	const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders + signedHeaders, payloadHash].join('\n');
	const scope = `${dateStamp}/${input.region}/bedrock/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
	const signingKey = await signatureKey(input.secretKey, dateStamp, input.region, 'bedrock');
	const signature = toHex(new Uint8Array(await hmac(signingKey, stringToSign)));
	return {
		url: `https://${host}${canonicalUri}`,
		headers: {
			'Content-Type': 'application/json',
			'X-Amz-Date': amzDate,
			'X-Amz-Content-Sha256': payloadHash,
			...(input.sessionToken ? { 'X-Amz-Security-Token': input.sessionToken } : {}),
			Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
	};
}

export class BedrockEventDecoder {
	private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	private tool: { id: string; name: string; args: string } | undefined;

	push(chunk: Uint8Array<ArrayBufferLike>): { text: string; tools: { id: string; name: string; args: string }[] } {
		this.buffer = concat(this.buffer, chunk);
		let text = '';
		const tools: { id: string; name: string; args: string }[] = [];
		while (this.buffer.length >= 12) {
			const total = readUint32(this.buffer, 0);
			if (total < 16 || this.buffer.length < total) {
				break;
			}
			const message = this.buffer.slice(0, total);
			this.buffer = this.buffer.slice(total);
			const parsed = parseMessage(message);
			if (!parsed) {
				continue;
			}
			if (parsed.eventType === 'contentBlockStart') {
				const toolUse = asRecord(asRecord(parsed.payload.start)?.toolUse);
				const id = stringField(toolUse, 'toolUseId');
				const name = stringField(toolUse, 'name');
				if (id && name) {
					this.tool = { id, name, args: '' };
				}
			} else if (parsed.eventType === 'contentBlockDelta') {
				const delta = asRecord(parsed.payload.delta);
				const deltaText = stringField(delta, 'text');
				if (deltaText) {
					text += deltaText;
				}
				const input = stringField(asRecord(delta?.toolUse), 'input');
				if (input && this.tool) {
					this.tool.args += input;
				}
			} else if (parsed.eventType === 'contentBlockStop' && this.tool) {
				tools.push(this.tool);
				this.tool = undefined;
			}
		}
		return { text, tools };
	}

	flush(): { id: string; name: string; args: string }[] {
		if (!this.tool?.name) {
			this.tool = undefined;
			return [];
		}
		const tool = this.tool;
		this.tool = undefined;
		return [tool];
	}
}

export function encodeEventMessage(eventType: string, payload: object): Uint8Array {
	const headers = encodeHeaders({ ':event-type': eventType, ':content-type': 'application/json' });
	const body = encoder.encode(JSON.stringify(payload));
	const total = 12 + headers.length + body.length + 4;
	const message = new Uint8Array(total);
	const view = new DataView(message.buffer);
	view.setUint32(0, total);
	view.setUint32(4, headers.length);
	view.setUint32(8, 0);
	message.set(headers, 12);
	message.set(body, 12 + headers.length);
	view.setUint32(total - 4, 0);
	return message;
}

function parseMessage(message: Uint8Array): { eventType: string; payload: Record<string, unknown> } | undefined {
	if (message.length < 16) {
		return undefined;
	}
	const headersLength = readUint32(message, 4);
	const headersEnd = 12 + headersLength;
	if (headersEnd > message.length - 4) {
		return undefined;
	}
	const headers = decodeHeaders(message.slice(12, headersEnd));
	const eventType = headers[':event-type'];
	if (typeof eventType !== 'string') {
		return undefined;
	}
	const payloadBytes = message.slice(headersEnd, message.length - 4);
	if (!payloadBytes.length) {
		return { eventType, payload: {} };
	}
	try {
		const payload = JSON.parse(decoder.decode(payloadBytes)) as unknown;
		return { eventType, payload: payload && typeof payload === 'object' ? payload as Record<string, unknown> : {} };
	} catch {
		return undefined;
	}
}

function encodeHeaders(headers: Record<string, string>): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const [name, value] of Object.entries(headers)) {
		const nameBytes = encoder.encode(name);
		const valueBytes = encoder.encode(value);
		const part = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
		part[0] = nameBytes.length;
		part.set(nameBytes, 1);
		part[1 + nameBytes.length] = 7;
		const view = new DataView(part.buffer);
		view.setUint16(2 + nameBytes.length, valueBytes.length);
		part.set(valueBytes, 4 + nameBytes.length);
		parts.push(part);
	}
	return concat(...parts);
}

function decodeHeaders(bytes: Uint8Array): Record<string, string | boolean> {
	const headers: Record<string, string | boolean> = {};
	let pos = 0;
	while (pos < bytes.length) {
		const nameLength = bytes[pos];
		pos += 1;
		const name = decoder.decode(bytes.slice(pos, pos + nameLength));
		pos += nameLength;
		const type = bytes[pos];
		pos += 1;
		if (type === 0 || type === 1) {
			headers[name] = type === 0;
			continue;
		}
		if (type === 2) {
			pos += 1;
			continue;
		}
		if (type === 3) {
			pos += 2;
			continue;
		}
		if (type === 4) {
			pos += 4;
			continue;
		}
		if (type === 5 || type === 8) {
			pos += 8;
			continue;
		}
		if (type === 9) {
			pos += 16;
			continue;
		}
		if (type === 6 || type === 7) {
			const length = (bytes[pos] << 8) | bytes[pos + 1];
			pos += 2;
			if (type === 7) {
				headers[name] = decoder.decode(bytes.slice(pos, pos + length));
			}
			pos += length;
			continue;
		}
		break;
	}
	return headers;
}

async function signatureKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
	const dateKey = await hmac(encoder.encode(`AWS4${secret}`), dateStamp);
	const regionKey = await hmac(dateKey, region);
	const serviceKey = await hmac(regionKey, service);
	return hmac(serviceKey, 'aws4_request');
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function amzTimestamp(date: Date): string {
	return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePathSegment(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const size = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === 'string' ? value : undefined;
}
