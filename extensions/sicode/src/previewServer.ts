/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { contentType, previewUrl, safeFile } from './preview.js';

interface Incoming {
	url?: string;
}

interface Outgoing {
	writeHead(code: number, headers: Record<string, string>): void;
	end(body?: Uint8Array | string): void;
}

interface Listening {
	listen(port: number, host: string, callback: () => void): void;
	close(callback?: () => void): void;
	address(): { port: number } | string | null;
}

declare function require(id: string): {
	createServer?(handler: (req: Incoming, res: Outgoing) => void): Listening;
	readFileSync?(file: string): Uint8Array;
};

let current: Listening | undefined;

export function startPreview(root: string): Promise<string> {
	const http = require('node:http');
	const fs = require('node:fs');
	if (!http.createServer || !fs.readFileSync) {
		return Promise.reject(new Error('The preview server is unavailable.'));
	}
	const createServer = http.createServer;
	const readFileSync = fs.readFileSync;
	current?.close();
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const file = safeFile(root, req.url || '/');
			if (!file) {
				res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
				res.end('Forbidden');
				return;
			}
			try {
				const body = readFileSync(file);
				res.writeHead(200, { 'content-type': contentType(file) });
				res.end(body);
			} catch {
				res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
				res.end('Not found');
			}
		});
		server.listen(0, '127.0.0.1', () => {
			current = server;
			const address = server.address();
			const port = address && typeof address === 'object' ? address.port : 0;
			if (!port) {
				reject(new Error('The preview server did not start.'));
				return;
			}
			resolve(previewUrl(port));
		});
	});
}
