/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface Spawned {
	stdout: { on(event: 'data', listener: (chunk: unknown) => void): void } | null;
	stderr: { on(event: 'data', listener: (chunk: unknown) => void): void } | null;
	kill(): void;
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'close', listener: (code: number | null) => void): void;
}

declare const process: { env: Record<string, string | undefined> };
declare function require(id: string): { spawn(command: string, args: readonly string[], options: { cwd: string; shell: boolean; env: Record<string, string | undefined> }): Spawned };

export function runProcess(command: string, args: readonly string[], cwd: string): Promise<{ exitCode: number; output: string }> {
	return new Promise(resolve => {
		let output = '';
		let settled = false;
		const finish = (exitCode: number, extra?: string) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (extra) {
				output = output ? `${output}\n${extra}` : extra;
			}
			resolve({ exitCode, output: output.slice(0, 20_000) });
		};
		const child = require('node:child_process').spawn(command, args, { cwd, shell: false, env: process.env });
		const timer = setTimeout(() => {
			child.kill();
			finish(1, 'Timed out after 120 seconds.');
		}, 120_000);
		child.stdout?.on('data', chunk => { output += String(chunk); });
		child.stderr?.on('data', chunk => { output += String(chunk); });
		child.on('error', error => finish(1, error.message));
		child.on('close', code => finish(code ?? 1));
	});
}
