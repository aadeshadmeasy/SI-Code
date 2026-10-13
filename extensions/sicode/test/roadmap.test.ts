import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearChanges, decideAgentTurn, interpretCheck, listChanges, pickCheckCommand, recordChange, reviewMarkdown, runAgentWithReview, selfFixMessage, unifiedDiff } from '../src/agentReview.ts';
import { applySecrets, enablePreset, mcpPresets, missingSecrets, presetButtonsHtml, requiredSecretNames } from '../src/mcpPresets.ts';
import { buildIndex, isWhereQuestion, rulesPrompt, shouldIndex, whereIs } from '../src/projectMemory.ts';
import { estimateCost, formatMeter, pickModel, routeTask, userConfiguredModels } from '../src/routing.ts';
import { awsPlan, extractPreviewUrl, vercelPlan } from '../src/ship.ts';
import type { LoopMessage, ModelPart } from '../src/toolLoop.ts';

test('agent review diffs several files and self-fixes before review', async () => {
	clearChanges();
	recordChange('src/a.ts', 'export const a = 1;\n', 'export const a = 2;\n');
	recordChange('src/b.ts', null, 'export const b = 1;\n');
	recordChange('src/a.ts', 'ignored', 'export const a = 3;\n');
	const changes = listChanges();
	assert.equal(changes.length, 2);
	assert.equal(changes.find(change => change.path === 'src/a.ts')?.before, 'export const a = 1;\n');
	assert.equal(changes.find(change => change.path === 'src/a.ts')?.after, 'export const a = 3;\n');
	const diff = unifiedDiff(changes[0]);
	assert.match(diff, /--- a\/src\/a\.ts/);
	assert.match(diff, /\+export const a = 3;/);
	const markdown = reviewMarkdown(changes, { ok: false, errors: 'fail' });
	assert.match(markdown, /2 files changed/);
	assert.match(markdown, /src\/b\.ts/);

	assert.equal(decideAgentTurn({ edits: 0, checkOk: false, fixRound: 0, maxFixes: 2 }), 'skip');
	assert.equal(decideAgentTurn({ edits: 2, checkOk: false, fixRound: 0, maxFixes: 2 }), 'fix');
	assert.equal(decideAgentTurn({ edits: 2, checkOk: false, fixRound: 2, maxFixes: 2 }), 'review');
	assert.equal(decideAgentTurn({ edits: 2, checkOk: true, fixRound: 0, maxFixes: 2 }), 'review');
	assert.match(selfFixMessage('boom'), /boom/);
	assert.deepEqual(interpretCheck('ok', 0), { ok: true, errors: '' });
	assert.equal(interpretCheck('Error: bad', 1).ok, false);

	assert.deepEqual(pickCheckCommand(['package.json'], '{"scripts":{"test":"node --test"}}'), { command: 'npm', args: ['--silent', 'test'] });
	assert.equal(pickCheckCommand(['package.json'], '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}'), undefined);
	assert.deepEqual(pickCheckCommand(['pyproject.toml']), { command: 'python3', args: ['-m', 'pytest', '-q'] });

	let checks = 0;
	const seen: string[] = [];
	const outcome = await runAgentWithReview({
		messages: [{ role: 'user', text: 'fix the files' }],
		tools: [],
		maxFixes: 2,
		listChanges: () => [{ path: 'src/a.ts', before: 'old', after: 'new' }],
		checkCommand: { command: 'npm', args: ['--silent', 'test'] },
		runCheck: async () => {
			checks++;
			return checks === 1 ? { exitCode: 1, output: 'Error: bad' } : { exitCode: 0, output: 'pass' };
		},
		complete: async (messages: LoopMessage[]): Promise<ModelPart[]> => {
			seen.push(messages.at(-1)?.text ?? '');
			return [{ type: 'text', text: checks === 0 ? 'edited' : 'fixed' }];
		},
		invokeTool: async () => '',
	});
	assert.equal(checks, 2);
	assert.equal(outcome.fixes, 1);
	assert.equal(outcome.check?.ok, true);
	assert.match(seen[1] ?? '', /Error: bad/);
	assert.match(reviewMarkdown(outcome.changes, outcome.check), /Automatic check passed/);
});

test('routing picks cheap, strong, and local models and prices the reply', () => {
	assert.equal(routeTask('where is the login handler'), 'cheap');
	assert.equal(routeTask('explain this function'), 'cheap');
	assert.equal(routeTask('refactor the auth module across files'), 'strong');
	assert.equal(routeTask('rename a variable', { mode: 'agent' }), 'strong');
	assert.equal(routeTask('use ollama for this'), 'local');
	assert.equal(routeTask('edit the file', { preferLocal: true, mode: 'agent' }), 'local');

	const available = [
		{ vendor: 'sicode-openai', id: 'gpt-4o-mini' },
		{ vendor: 'sicode-openai', id: 'gpt-4o' },
		{ vendor: 'sicode-ollama', id: 'llama3.2' },
	];
	assert.equal(pickModel('cheap', available, {})?.id, 'gpt-4o-mini');
	assert.equal(pickModel('strong', available, {})?.id, 'gpt-4o');
	assert.equal(pickModel('local', available, {})?.id, 'llama3.2');
	assert.equal(pickModel('strong', available, { strong: 'sicode-openai/gpt-4o-mini' })?.id, 'gpt-4o-mini');

	const cheap = estimateCost('gpt-4o-mini', 'sicode-openai', 1_000_000, 0);
	assert.equal(cheap.known, true);
	assert.equal(cheap.usd, 0.15);
	const local = estimateCost('llama3.2', 'sicode-ollama', 5000, 5000);
	assert.deepEqual(local, { usd: 0, known: true });
	assert.equal(estimateCost('custom-model', 'sicode-compatible', 10, 10).known, false);
	const line = formatMeter({ kind: 'cheap', modelId: 'gpt-4o-mini', inputTokens: 100, outputTokens: 40, chatUsd: cheap.usd, known: true, totalUsd: cheap.usd });
	assert.match(line, /cheap model `gpt-4o-mini`/);
	assert.match(line, /100 in \/ 40 out tokens/);
});

test('mcp presets persist auth names and do not duplicate or embed secrets', () => {
	assert.deepEqual(mcpPresets.map(preset => preset.id), ['supabase', 'github', 'figma', 'aws', 'postgres', 'chrome']);
	assert.equal(mcpPresets.find(preset => preset.id === 'chrome')?.secrets.length, 0);
	const published = JSON.stringify(mcpPresets);
	assert.equal(published.includes('Bearer '), false);
	assert.equal(published.includes('postgres://'), false);
	assert.equal(published.includes('AKIA'), false);
	for (const preset of mcpPresets) {
		for (const field of preset.secrets) {
			assert.match(field.name, /^[A-Z0-9_]+$/);
		}
		assert.equal(preset.args.includes('secret'), false);
	}
	assert.deepEqual(requiredSecretNames(mcpPresets[3]), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
	assert.deepEqual(missingSecrets(mcpPresets[0], {}), ['SUPABASE_ACCESS_TOKEN']);
	const token = 'test-token';
	const supabase = applySecrets(mcpPresets[0], { SUPABASE_ACCESS_TOKEN: token });
	assert.deepEqual(supabase.headers, { Authorization: `Bearer ${token}` });
	assert.deepEqual(supabase.env, {});
	const github = applySecrets(mcpPresets[1], { GITHUB_PERSONAL_ACCESS_TOKEN: token });
	assert.equal(github.env.GITHUB_PERSONAL_ACCESS_TOKEN, token);
	assert.deepEqual([...github.args], [...mcpPresets[1].args]);
	const postgres = applySecrets(mcpPresets[4], { POSTGRES_CONNECTION_STRING: 'postgres://db.example/app' });
	assert.equal(postgres.args.at(-1), 'postgres://db.example/app');
	assert.equal(mcpPresets[4].args.includes('postgres://db.example/app'), false);
	const aws = applySecrets(mcpPresets[3], { AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret-test' });
	assert.equal(aws.env.AWS_REGION, 'us-east-1');
	assert.equal(Object.hasOwn(aws.env, 'AWS_SESSION_TOKEN'), false);
	assert.deepEqual(enablePreset(enablePreset([], 'github'), 'github'), ['github']);
	const buttons = presetButtonsHtml();
	for (const id of ['supabase', 'github', 'figma', 'aws', 'postgres', 'chrome']) {
		assert.match(buttons, new RegExp(`data-arg="${id}"`));
		assert.match(buttons, new RegExp(`Connect ${mcpPresets.find(preset => preset.id === id)?.label}`));
	}
	assert.equal(buttons.includes(token), false);
	assert.deepEqual(userConfiguredModels([
		{ vendor: 'copilot', id: 'MAI-Code-1.1-Flash' },
		{ vendor: 'sicode-sarvam', id: 'sarvam-105b' },
	]).map(model => model.id), ['sarvam-105b']);
});

test('project rules and the codebase index answer where-is questions', () => {
	assert.match(rulesPrompt('# Use tabs'), /Always follow these project rules/);
	assert.equal(rulesPrompt('  '), '');
	assert.equal(shouldIndex('node_modules/pkg/index.js'), false);
	assert.equal(shouldIndex('.git/config'), false);
	assert.equal(shouldIndex('src/auth.ts'), true);
	const index = buildIndex([
		{ path: 'node_modules/skip.js', text: 'function skip() {}' },
		{ path: 'src/auth.ts', text: 'export function signIn() {}\nclass Session {}' },
		{ path: 'src/ship.ts', text: 'function vercelPlan() {}' },
		{ path: 'docs/login.md', text: '# Login flow\nThe account page.' },
	]);
	assert.equal(index.some(entry => entry.path.includes('node_modules')), false);
	assert.equal(isWhereQuestion('where is the login flow'), true);
	assert.equal(isWhereQuestion('rewrite the parser'), false);
	const hits = whereIs(index, 'where is the login flow');
	assert.equal(hits[0]?.path, 'docs/login.md');
	const code = whereIs(index, 'where is signIn');
	assert.equal(code[0]?.path, 'src/auth.ts');
});

test('ship commands extract preview links and keep secrets out of argv', () => {
	const vercel = vercelPlan();
	assert.deepEqual(vercel, { command: 'npx', args: ['--yes', 'vercel', 'deploy'] });
	assert.equal(JSON.stringify(vercel).toLowerCase().includes('token'), false);
	const cdk = awsPlan(['cdk.json', 'package.json']);
	assert.deepEqual(cdk, { command: 'npx', args: ['--yes', 'aws-cdk', 'deploy', '--require-approval', 'never'] });
	assert.equal(JSON.stringify(cdk).includes('AKIA'), false);
	const sam = awsPlan(['template.yaml']);
	assert.equal('command' in sam && sam.command, 'sam');
	const missing = awsPlan(['README.md']);
	assert.equal('message' in missing, true);
	const vercelUrl = extractPreviewUrl('Production: https://my-app-abc.vercel.app [3s]\nDocs: https://vercel.com/docs');
	assert.equal(vercelUrl, 'https://my-app-abc.vercel.app');
	const awsUrl = extractPreviewUrl('Stack output PreviewUrl = https://d111111abcdef8.cloudfront.net/');
	assert.equal(awsUrl, 'https://d111111abcdef8.cloudfront.net/');
});
