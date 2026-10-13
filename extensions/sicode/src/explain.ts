/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function explainError(message: string, file?: string): string {
	const where = file ? ` in ${file}` : '';
	const text = message.trim();
	if (/cannot find module|module not found/i.test(text)) {
		return `A package this file needs is not installed${where}. Fix it will ask the agent to install it or correct the import.`;
	}
	if (/not assignable|type error|\bTS\d{3,5}\b/i.test(text)) {
		return `A value has the wrong type${where}. Fix it will ask the agent to correct it.`;
	}
	if (/syntaxerror|unexpected token|parsing error/i.test(text)) {
		return `The code has a typo or a missing character${where}. Fix it will ask the agent to repair it.`;
	}
	if (/enoent|no such file/i.test(text)) {
		return `A file the program expected is missing${where}. Fix it will ask the agent to create it or use the right path.`;
	}
	const first = text.split('\n').map(line => line.trim()).find(Boolean) ?? 'Something went wrong.';
	const clipped = first.length > 180 ? `${first.slice(0, 180)}…` : first;
	return `Something failed${where}: ${clipped} Fix it will ask the agent to repair it.`;
}

export function explainChange(path: string, created: boolean): string {
	const name = path.split(/[\\/]/).pop() || path;
	return created
		? `Added ${name}. This is a new file.`
		: `Updated ${name}. Review the difference, then keep or revert it.`;
}

export function fixPrompt(message: string, file?: string): string {
	const where = file ? `File: ${file}\n` : '';
	return `Fix this error and change the project so it is resolved.\n${where}${message.trim()}`;
}
