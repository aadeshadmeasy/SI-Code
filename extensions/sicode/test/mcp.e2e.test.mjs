/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { runToolLoop } = require('../out/toolLoop.js');
const serverScript = fileURLToPath(import.meta.url);

if (process.argv.includes('--mcp-server')) {
	const mode = process.argv[process.argv.indexOf('--mcp-server') + 1];
	const prefix = process.argv[process.argv.indexOf('--mcp-server') + 2];
	if (mode === 'stdio') {
		await serveStdio(prefix);
	} else {
		await serveHttp(Number(mode), prefix);
	}
} else {
	test('stdio MCP tool result returns through the chat tool loop', async () => {
		const client = await StdioClient.start(serverScript, 'stdio');
		try {
			const result = await runEcho(client, 'stdio');
			assert.equal(result.calls[0].result, 'stdio:hello');
			assert.match(result.text, /stdio:hello/);
		} finally {
			client.stop();
		}
	});

	test('HTTP MCP tool result returns through the chat tool loop', async () => {
		const server = http.createServer((req, res) => handleHttp(req, res, 'http'));
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const port = server.address().port;
		const client = new HttpClient(`http://127.0.0.1:${port}/mcp`);
		try {
			const result = await runEcho(client, 'http');
			assert.equal(result.calls[0].result, 'http:hello');
			assert.match(result.text, /http:hello/);
		} finally {
			server.close();
		}
	});
}

async function runEcho(client, prefix) {
	await client.request('initialize', {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'sicode-test', version: '0.0.0' },
	});
	client.notify('notifications/initialized');
	const listed = await client.request('tools/list', {});
	const tools = listed.tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
	return runToolLoop({
		messages: [{ role: 'user', text: `Use echo for ${prefix}` }],
		tools,
		complete: scriptedComplete,
		invokeTool: async (name, input) => {
			const called = await client.request('tools/call', { name, arguments: input });
			return called.content.map(part => part.text ?? '').join('');
		},
	});
}

async function scriptedComplete(messages, tools) {
	const last = messages.at(-1);
	if (last?.toolResults) {
		return [{ type: 'text', text: `done ${last.toolResults.map(result => result.text).join(' ')}` }];
	}
	return [{ type: 'tool', callId: 'c1', name: tools[0].name, input: { text: 'hello' } }];
}

function mcpResult(message, prefix) {
	if (message.method === 'notifications/initialized') {
		return undefined;
	}
	if (message.method === 'initialize') {
		return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sicode-test', version: '0.0.1' } };
	}
	if (message.method === 'tools/list') {
		return {
			tools: [{
				name: 'echo',
				description: `Echo text with a ${prefix} prefix`,
				inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
			}],
		};
	}
	if (message.method === 'tools/call') {
		const text = message.params?.arguments?.text ?? '';
		return { content: [{ type: 'text', text: `${prefix}:${text}` }] };
	}
	return undefined;
}

function reply(message, prefix) {
	if (message.method === 'notifications/initialized') {
		return undefined;
	}
	const result = mcpResult(message, prefix);
	if (result === undefined && message.id !== undefined) {
		return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method ${message.method}` } };
	}
	if (message.id === undefined) {
		return undefined;
	}
	return { jsonrpc: '2.0', id: message.id, result };
}

async function serveStdio(prefix) {
	let buffer = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', chunk => {
		buffer += chunk;
		let newline = buffer.indexOf('\n');
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) {
				const response = reply(JSON.parse(line), prefix);
				if (response) {
					process.stdout.write(`${JSON.stringify(response)}\n`);
				}
			}
			newline = buffer.indexOf('\n');
		}
	});
	await new Promise(() => { });
}

function handleHttp(req, res, prefix) {
	const chunks = [];
	req.on('data', chunk => chunks.push(chunk));
	req.on('end', () => {
		const response = reply(JSON.parse(Buffer.concat(chunks).toString('utf8')), prefix);
		if (!response) {
			res.writeHead(202);
			res.end();
			return;
		}
		const body = JSON.stringify(response);
		res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
		res.end(body);
	});
}

async function serveHttp(port, prefix) {
	const server = http.createServer((req, res) => handleHttp(req, res, prefix));
	server.listen(port, '127.0.0.1');
	await once(server, 'listening');
}

class StdioClient {
	static async start(script, prefix) {
		const child = spawn(process.execPath, [script, '--mcp-server', 'stdio', prefix], { stdio: ['pipe', 'pipe', 'inherit'] });
		const client = new StdioClient(child);
		await client.ready;
		return client;
	}

	constructor(child) {
		this.child = child;
		this.next = 0;
		this.waiters = new Map();
		this.buffer = '';
		this.ready = new Promise(resolve => {
			child.stdout.on('data', chunk => {
				this.buffer += chunk.toString('utf8');
				let newline = this.buffer.indexOf('\n');
				while (newline >= 0) {
					const line = this.buffer.slice(0, newline).trim();
					this.buffer = this.buffer.slice(newline + 1);
					if (line) {
						const message = JSON.parse(line);
						this.waiters.get(message.id)?.(message);
						this.waiters.delete(message.id);
					}
					newline = this.buffer.indexOf('\n');
				}
			});
			resolve();
		});
	}

	request(method, params) {
		const id = ++this.next;
		this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 5000);
			this.waiters.set(id, message => {
				clearTimeout(timer);
				if (message.error) {
					reject(new Error(message.error.message));
				} else {
					resolve(message.result);
				}
			});
		});
	}

	notify(method) {
		this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
	}

	stop() {
		this.child.kill();
	}
}

class HttpClient {
	constructor(url) {
		this.url = url;
		this.next = 0;
	}

	async request(method, params) {
		const id = ++this.next;
		const response = await fetch(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
		});
		const message = await response.json();
		if (message.error) {
			throw new Error(message.error.message);
		}
		return message.result;
	}

	notify(method) {
		return fetch(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', method }),
		});
	}
}
