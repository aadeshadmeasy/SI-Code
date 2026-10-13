/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function previewUrl(port: number): string {
	return `http://127.0.0.1:${port}/`;
}

export function contentType(filePath: string): string {
	const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
	switch (ext) {
		case 'html': return 'text/html; charset=utf-8';
		case 'css': return 'text/css; charset=utf-8';
		case 'js': return 'text/javascript; charset=utf-8';
		case 'json': return 'application/json; charset=utf-8';
		case 'svg': return 'image/svg+xml';
		default: return 'text/plain; charset=utf-8';
	}
}

export function safeFile(root: string, urlPath: string): string | undefined {
	const name = decodeURIComponent((urlPath.split('?')[0] || '/')).replace(/^\/+/, '');
	const relative = name === '' ? 'index.html' : name;
	if (relative.split(/[\\/]/).includes('..')) {
		return undefined;
	}
	const separator = root.endsWith('/') || root.endsWith('\\') ? '' : '/';
	return `${root}${separator}${relative}`;
}
