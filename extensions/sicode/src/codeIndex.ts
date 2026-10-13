/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildIndex, shouldIndex, whereIs, type IndexEntry } from './projectMemory.js';

const FILE_CAP = 1500;
const SIZE_CAP = 200_000;
let cached: IndexEntry[] | undefined;

export function clearCodeIndex(): void {
	cached = undefined;
}

export async function searchWorkspace(question: string): Promise<IndexEntry[]> {
	if (!cached) {
		cached = buildIndex(await collectFiles());
	}
	return whereIs(cached, question);
}

async function collectFiles(): Promise<{ path: string; text: string }[]> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) {
		return [];
	}
	const files: { path: string; text: string }[] = [];
	await walk(root, '', files, 0);
	return files;
}

async function walk(dir: vscode.Uri, prefix: string, files: { path: string; text: string }[], depth: number): Promise<void> {
	if (files.length >= FILE_CAP || depth > 8) {
		return;
	}
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return;
	}
	for (const [name, type] of entries) {
		if (files.length >= FILE_CAP) {
			return;
		}
		const relative = prefix ? `${prefix}/${name}` : name;
		if (type === vscode.FileType.Directory) {
			if (!shouldIndex(`${relative}/file.ts`)) {
				continue;
			}
			await walk(vscode.Uri.joinPath(dir, name), relative, files, depth + 1);
			continue;
		}
		if (!shouldIndex(relative)) {
			continue;
		}
		const uri = vscode.Uri.joinPath(dir, name);
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > SIZE_CAP) {
				continue;
			}
			const bytes = await vscode.workspace.fs.readFile(uri);
			files.push({ path: relative, text: new TextDecoder().decode(bytes) });
		} catch {
			// Unreadable files are left out of the index.
		}
	}
}
