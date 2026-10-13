/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runToolLoop, type LoopMessage, type ToolCallRecord, type ToolSpec } from './toolLoop.js';

export interface FileChange {
	readonly path: string;
	readonly before: string | null;
	readonly after: string;
}

export interface CheckCommand {
	readonly command: string;
	readonly args: readonly string[];
}

export interface CheckResult {
	readonly ok: boolean;
	readonly errors: string;
}

const pending = new Map<string, { before: string | null; after: string }>();
const reviews = new Map<string, FileChange[]>();
let reviewSeq = 0;

export function recordChange(path: string, before: string | null, after: string): void {
	const existing = pending.get(path);
	if (existing) {
		existing.after = after;
		return;
	}
	pending.set(path, { before, after });
}

export function listChanges(): FileChange[] {
	return [...pending.entries()]
		.filter(([, change]) => change.before !== change.after)
		.map(([path, change]) => ({ path, before: change.before, after: change.after }));
}

export function clearChanges(): void {
	pending.clear();
}

export function storeReview(changes: readonly FileChange[]): string {
	const id = String(++reviewSeq);
	reviews.set(id, changes.map(change => ({ ...change })));
	return id;
}

export function getReview(id: string): FileChange[] | undefined {
	return reviews.get(id);
}

export function dropReview(id: string): void {
	reviews.delete(id);
}

export function pickCheckCommand(rootNames: readonly string[], packageJson?: string): CheckCommand | undefined {
	if (packageJson) {
		try {
			const parsed = JSON.parse(packageJson) as { scripts?: { test?: unknown; build?: unknown } };
			const test = parsed.scripts?.test;
			if (typeof test === 'string' && test.trim() && !/no test specified/i.test(test)) {
				return { command: 'npm', args: ['--silent', 'test'] };
			}
			const build = parsed.scripts?.build;
			if (typeof build === 'string' && build.trim()) {
				return { command: 'npm', args: ['--silent', 'run', 'build'] };
			}
		} catch {
			// A broken package.json falls through to the other project markers.
		}
	}
	if (rootNames.includes('pyproject.toml') || rootNames.includes('pytest.ini')) {
		return { command: 'python3', args: ['-m', 'pytest', '-q'] };
	}
	if (rootNames.includes('go.mod')) {
		return { command: 'go', args: ['test', './...'] };
	}
	if (rootNames.includes('Cargo.toml')) {
		return { command: 'cargo', args: ['test', '--quiet'] };
	}
	return undefined;
}

export function interpretCheck(output: string, exitCode: number): CheckResult {
	if (exitCode === 0) {
		return { ok: true, errors: '' };
	}
	const lines = output.trim().split('\n');
	const tail = lines.slice(-40).join('\n');
	return { ok: false, errors: tail || `The check exited with code ${exitCode}.` };
}

export function selfFixMessage(errors: string): string {
	return [
		'The automatic check failed before review. Fix the errors below, then stop so the check can run again.',
		'Do not ask the user to run the check. Edit the files that failed.',
		errors,
	].join('\n\n');
}

export function decideAgentTurn(input: { edits: number; checkOk: boolean | undefined; fixRound: number; maxFixes: number }): 'skip' | 'review' | 'fix' {
	if (input.edits === 0) {
		return 'skip';
	}
	if (input.checkOk === undefined || input.checkOk || input.fixRound >= input.maxFixes) {
		return 'review';
	}
	return 'fix';
}

export function unifiedDiff(change: FileChange): string {
	const ops = lineDiff(change.before ?? '', change.after);
	const body = ops.map(op => `${op.kind}${op.line}`).join('\n');
	return `--- a/${change.path}\n+++ b/${change.path}\n${body}`;
}

export function reviewMarkdown(changes: readonly FileChange[], check?: CheckResult): string {
	const status = !check ? 'No automatic test or build script was found.'
		: check.ok ? 'Automatic check passed.'
			: `Automatic check failed.\n\n\`\`\`\n${check.errors}\n\`\`\``;
	const diffs = changes.map(change => `\`\`\`diff\n${unifiedDiff(change)}\n\`\`\``).join('\n\n');
	const clipped = diffs.length > 12_000 ? `${diffs.slice(0, 12_000)}\n…diff truncated` : diffs;
	return `### Review\n\n${changes.length} file${changes.length === 1 ? '' : 's'} changed. ${status}\n\n${clipped}`;
}

export async function runAgentWithReview(options: {
	messages: LoopMessage[];
	tools: ToolSpec[];
	complete: (messages: LoopMessage[], tools: ToolSpec[]) => Promise<import('./toolLoop.js').ModelPart[]>;
	invokeTool: (name: string, input: unknown) => Promise<string>;
	maxRounds?: number;
	listChanges: () => FileChange[];
	checkCommand?: CheckCommand;
	runCheck: (command: CheckCommand) => Promise<{ exitCode: number; output: string }>;
	maxFixes?: number;
}): Promise<{ text: string; calls: ToolCallRecord[]; changes: FileChange[]; check?: CheckResult; fixes: number }> {
	const maxFixes = options.maxFixes ?? 2;
	let messages = options.messages.slice();
	const calls: ToolCallRecord[] = [];
	let text = '';
	let fixes = 0;
	let check: CheckResult | undefined;

	for (;;) {
		const result = await runToolLoop({
			messages,
			tools: options.tools,
			complete: options.complete,
			invokeTool: options.invokeTool,
			maxRounds: options.maxRounds,
		});
		text = result.text;
		calls.push(...result.calls);
		messages = result.messages;
		const changes = options.listChanges();
		if (options.checkCommand && changes.length > 0) {
			const ran = await options.runCheck(options.checkCommand);
			check = interpretCheck(ran.output, ran.exitCode);
		}
		const turn = decideAgentTurn({
			edits: changes.length,
			checkOk: check?.ok,
			fixRound: fixes,
			maxFixes,
		});
		if (turn !== 'fix' || !check) {
			return { text, calls, changes, check, fixes };
		}
		fixes++;
		messages.push({ role: 'user', text: selfFixMessage(check.errors) });
	}
}

function lineDiff(before: string, after: string): { kind: ' ' | '+' | '-'; line: string }[] {
	const a = before.split('\n');
	const b = after.split('\n');
	if (a.length * b.length > 250_000) {
		return [
			...a.slice(0, 200).map(line => ({ kind: '-' as const, line })),
			...b.slice(0, 200).map(line => ({ kind: '+' as const, line })),
		];
	}
	const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out: { kind: ' ' | '+' | '-'; line: string }[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: ' ', line: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push({ kind: '-', line: a[i] });
			i++;
		} else {
			out.push({ kind: '+', line: b[j] });
			j++;
		}
	}
	while (i < a.length) {
		out.push({ kind: '-', line: a[i++] });
	}
	while (j < b.length) {
		out.push({ kind: '+', line: b[j++] });
	}
	return out;
}
