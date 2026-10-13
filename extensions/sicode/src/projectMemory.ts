/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RULES_PATH = '.sicode/rules.md';

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.sicode', 'coverage', '.next', 'build', 'vendor']);
const INDEX_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'md', 'json', 'html', 'css', 'yml', 'yaml', 'toml', 'sql', 'sh']);
const STOP = new Set(['where', 'is', 'the', 'a', 'an', 'file', 'code', 'find', 'which', 'does', 'for', 'of', 'in', 'to', 'and', 'my', 'me']);

export interface IndexEntry {
	readonly path: string;
	readonly symbols: readonly string[];
}

export function rulesPrompt(rules: string | undefined): string {
	const text = rules?.trim();
	if (!text) {
		return '';
	}
	return `Always follow these project rules from .sicode/rules.md:\n${text}`;
}

export function shouldIndex(path: string): boolean {
	const parts = path.split(/[\\/]/).filter(Boolean);
	if (parts.some(part => SKIP_DIRS.has(part))) {
		return false;
	}
	const file = parts.at(-1) ?? '';
	if (!file || file.startsWith('.')) {
		return false;
	}
	const dot = file.lastIndexOf('.');
	const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
	return INDEX_EXT.has(ext);
}

export function extractSymbols(path: string, text: string): string[] {
	const found = new Set<string>();
	const patterns = [
		/^#{1,6}\s+(.+)$/gm,
		/\b(?:function|class|interface|type|struct|fn|def)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
		/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const name = match[1].trim().replace(/[`*_]+/g, '');
			if (name.length > 1 && name.length < 80) {
				found.add(name);
			}
		}
	}
	const base = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '');
	if (base) {
		found.add(base);
	}
	return [...found].slice(0, 40);
}

export function buildIndex(files: readonly { path: string; text: string }[]): IndexEntry[] {
	return files.filter(file => shouldIndex(file.path)).map(file => ({
		path: file.path,
		symbols: extractSymbols(file.path, file.text),
	}));
}

export function isWhereQuestion(prompt: string): boolean {
	return /\bwhere\b|\bfind the\b|\bwhich file\b/i.test(prompt);
}

export function whereIs(index: readonly IndexEntry[], question: string, limit = 8): IndexEntry[] {
	const tokens = question.toLowerCase().split(/[^a-z0-9_]+/).filter(token => token.length > 1 && !STOP.has(token));
	if (tokens.length === 0) {
		return [];
	}
	const scored = index.map(entry => {
		const hay = `${entry.path} ${entry.symbols.join(' ')}`.toLowerCase();
		let score = 0;
		for (const token of tokens) {
			if (hay.includes(token)) {
				score += token.length;
			}
		}
		return { entry, score };
	}).filter(row => row.score > 0);
	scored.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
	return scored.slice(0, limit).map(row => row.entry);
}

export function formatWhereHits(hits: readonly IndexEntry[]): string {
	if (hits.length === 0) {
		return '';
	}
	return `Codebase index matches:\n${hits.map(hit => `- ${hit.path} (${hit.symbols.slice(0, 6).join(', ')})`).join('\n')}`;
}
