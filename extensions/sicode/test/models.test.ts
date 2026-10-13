import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BedrockEventDecoder, converseBody, encodeEventMessage, signBedrock } from '../src/bedrock.ts';
import { languageModelContribution, resolveCredentials, vendorById, vendors } from '../src/catalog.ts';
import { postJson, readSse } from '../src/http.ts';
import { fetchListedModels } from '../src/modelsFetch.ts';
import { defaultsFromVendorSchemas, mergeModelIds, planModelMigration } from '../src/modelPlan.ts';
import { authHeaders, noteOpenAIDelta, type ToolCallState } from '../src/openaiWire.ts';

const root = new URL('../../..', import.meta.url);

test('migration helpers stay in sync with the workbench copy', () => {
	const extension = readFileSync(new URL('./extensions/sicode/src/modelPlan.ts', root), 'utf8');
	const workbench = readFileSync(new URL('./src/vs/workbench/contrib/chat/common/sicodeModelMigration.ts', root), 'utf8');
	assert.equal(extension, workbench);
});

test('package.json contributions match the provider catalog', () => {
	const pkg = JSON.parse(readFileSync(new URL('./extensions/sicode/package.json', root), 'utf8'));
	assert.deepEqual(pkg.contributes.languageModelChatProviders, vendors.map(spec => languageModelContribution(spec)));
});

test('broken Sarvam groups gain an endpoint and model, and duplicates are removed', () => {
	const groups = [
		{ name: 'SI Code Sarvam', vendor: 'sicode-sarvam', apiKey: '${input:chat.lm.secret.4639ca72}' },
		{ name: 'SI Code Sarvam main', vendor: 'sicode-sarvam', apiKey: '${input:chat.lm.secret.65a458cc}' },
		{ name: 'SI Code Sarvam – main', vendor: 'sicode-sarvam', apiKey: '${input:chat.lm.secret.5ddd0e94}' },
		{ name: 'SI Code', vendor: 'sicode-sarvam', apiKey: '${input:chat.lm.secret.1211ed51}' },
	];
	const pkg = JSON.parse(readFileSync(new URL('./extensions/sicode/package.json', root), 'utf8'));
	const plan = planModelMigration(groups, defaultsFromVendorSchemas(pkg.contributes.languageModelChatProviders));
	assert.equal(plan.changed, true);
	assert.equal(plan.updates.length, 1);
	assert.equal(plan.updates[0].to.name, 'SI Code Sarvam');
	assert.equal(plan.updates[0].to.endpoint, 'https://api.sarvam.ai/v1');
	assert.equal(plan.updates[0].to.model, 'sarvam-105b');
	assert.equal(plan.updates[0].to.apiKey, groups[0].apiKey);
	assert.deepEqual(plan.removals.map(group => group.name), ['SI Code Sarvam main', 'SI Code Sarvam – main', 'SI Code']);
	const again = planModelMigration([plan.updates[0].to], defaultsFromVendorSchemas(pkg.contributes.languageModelChatProviders));
	assert.equal(again.changed, false);
});

test('credentials fall back to the preset endpoint and model', () => {
	const sarvam = vendorById('sicode-sarvam');
	assert.ok(sarvam);
	const resolved = resolveCredentials(sarvam, { apiKey: '${input:chat.lm.secret.example}' }, 'stored-key');
	assert.ok(resolved);
	assert.equal(resolved.baseUrl, 'https://api.sarvam.ai/v1');
	assert.equal(resolved.model, 'sarvam-105b');
	assert.equal(resolved.apiKey, 'stored-key');
	assert.equal(resolveCredentials(sarvam, {}, undefined), undefined);

	const bedrock = vendorById('sicode-bedrock');
	assert.ok(bedrock);
	assert.equal(resolveCredentials(bedrock, { accessKey: 'AKIAEXAMPLE' }, undefined), undefined);
	const signed = resolveCredentials(bedrock, { accessKey: 'AKIAEXAMPLE', secretKey: 'secret-example', model: 'custom-model' }, undefined);
	assert.ok(signed);
	assert.equal(signed.baseUrl, 'https://bedrock-runtime.us-east-1.amazonaws.com');
	assert.equal(signed.model, 'custom-model');
	assert.equal(signed.region, 'us-east-1');
});

test('a mock OpenAI-compatible server registers a model and streams a tool call', async () => {
	const seen: { authorization?: string; model?: string; path?: string } = {};
	const server = await listen(async (req, res) => {
		if (req.method === 'GET' && req.url === '/v1/models') {
			seen.authorization = req.headers.authorization;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'text-embedding-3-small' }] }));
			return;
		}
		if (req.method === 'POST' && req.url === '/v1/chat/completions') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk as Buffer);
			}
			seen.model = JSON.parse(Buffer.concat(chunks).toString()).model;
			seen.path = req.url;
			res.setHeader('content-type', 'text/event-stream');
			res.end([
				'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"readFile","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
				'data: [DONE]\n\n',
			].join(''));
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	try {
		const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
		const spec = vendorById('sicode-openai');
		assert.ok(spec);
		const credentials = resolveCredentials(spec, { endpoint: base, apiKey: 'test-key', model: 'gpt-test' }, undefined);
		assert.ok(credentials);
		const registered = { id: credentials.model, vendor: spec.vendor, endpoint: credentials.baseUrl };
		assert.deepEqual(registered, { id: 'gpt-test', vendor: 'sicode-openai', endpoint: base });

		const listed = mergeModelIds(spec.models.map(model => model.id), await fetchListedModels('openai', credentials.baseUrl, credentials.apiKey));
		assert.equal(listed[0], 'gpt-4o-mini');
		assert.ok(listed.includes('gpt-test'));
		assert.equal(listed.includes('text-embedding-3-small'), false);
		assert.equal(seen.authorization, 'Bearer test-key');

		const pending = new Map<number, ToolCallState>();
		let text = '';
		const response = await postJson(`${credentials.baseUrl}/chat/completions`, authHeaders('bearer', credentials.apiKey), {
			model: credentials.model,
			messages: [{ role: 'user', content: 'hi' }],
			stream: true,
		}, new AbortController().signal);
		await readSse(response, data => {
			const parsed = JSON.parse(data) as { choices?: { delta?: Parameters<typeof noteOpenAIDelta>[1] }[] };
			text += noteOpenAIDelta(pending, parsed.choices?.[0]?.delta);
		});
		assert.equal(text, 'Hello');
		assert.equal(seen.model, 'gpt-test');
		assert.equal(pending.get(0)?.name, 'readFile');
		assert.equal(pending.get(0)?.args, '{"path":"a.ts"}');
	} finally {
		await close(server);
	}
});

test('Bedrock Converse event stream yields text and a tool call', () => {
	const decoder = new BedrockEventDecoder();
	const bytes = concat(
		encodeEventMessage('contentBlockDelta', { delta: { text: 'Hi' } }),
		encodeEventMessage('contentBlockStart', { start: { toolUse: { toolUseId: 'tool-1', name: 'listDirectory' } } }),
		encodeEventMessage('contentBlockDelta', { delta: { toolUse: { input: '{"path":"."}' } } }),
		encodeEventMessage('contentBlockStop', {}),
	);
	const parsed = decoder.push(bytes);
	assert.equal(parsed.text, 'Hi');
	assert.deepEqual(parsed.tools, [{ id: 'tool-1', name: 'listDirectory', args: '{"path":"."}' }]);
	const body = JSON.parse(converseBody([
		{ role: 'user', parts: { text: 'list the folder', calls: [], results: [] } },
	], [{ name: 'listDirectory', description: 'List a directory' }]));
	assert.equal(body.messages[0].content[0].text, 'list the folder');
	assert.equal(body.toolConfig.tools[0].toolSpec.name, 'listDirectory');
});

test('Bedrock SigV4 matches an independent signer', async () => {
	const body = '{"messages":[]}';
	const now = new Date('2026-10-13T09:17:00.000Z');
	const signed = await signBedrock({
		accessKey: 'AKIAEXAMPLE',
		secretKey: 'secret-example',
		region: 'us-east-1',
		model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
		body,
		now,
	});
	assert.equal(signed.url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/global.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse-stream');
	const payloadHash = createHash('sha256').update(body).digest('hex');
	const canonicalHeaders = [
		'content-type:application/json',
		'host:bedrock-runtime.us-east-1.amazonaws.com',
		`x-amz-content-sha256:${payloadHash}`,
		'x-amz-date:20261013T091700Z',
	].map(line => `${line}\n`).join('');
	const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
	const canonical = ['POST', '/model/global.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse-stream', '', canonicalHeaders + signedHeaders, payloadHash].join('\n');
	const scope = '20261013/us-east-1/bedrock/aws4_request';
	const stringToSign = ['AWS4-HMAC-SHA256', '20261013T091700Z', scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
	const dateKey = createHmac('sha256', 'AWS4secret-example').update('20261013').digest();
	const regionKey = createHmac('sha256', dateKey).update('us-east-1').digest();
	const serviceKey = createHmac('sha256', regionKey).update('bedrock').digest();
	const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest();
	const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	assert.equal(signed.headers.Authorization, `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);
});

function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>): Promise<Server> {
	const server = createServer((req, res) => {
		void handler(req, res);
	});
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
