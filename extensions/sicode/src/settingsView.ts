/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { addVendorModel } from './addModel.js';
import { vendors } from './catalog.js';
import { openFreeModels } from './freeModels.js';

export async function openSettings(_context: vscode.ExtensionContext): Promise<void> {
	const panel = vscode.window.createWebviewPanel('sicode.configure', 'SI Code AI', vscode.ViewColumn.Active, { enableScripts: true });
	const nonce = Math.random().toString(36).slice(2);
	panel.webview.html = render(nonce);
	const subscription = panel.webview.onDidReceiveMessage(async message => {
		if (!message || typeof message !== 'object') {
			return;
		}
		if (message.type === 'free') {
			openFreeModels();
			return;
		}
		if (message.type !== 'add' || typeof message.vendor !== 'string') {
			return;
		}
		const spec = vendors.find(entry => entry.vendor === message.vendor);
		if (!spec) {
			return;
		}
		try {
			await addVendorModel(spec, spec.defaultModel);
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(text);
		}
	});
	panel.onDidDispose(() => subscription.dispose());
}

function render(nonce: string): string {
	const rows = vendors.map(spec => `
		<section>
			<h2>${escapeHtml(spec.label)}</h2>
			<p class="meta">${escapeHtml(spec.defaultBaseUrl)}</p>
			<p class="meta">Default model <code>${escapeHtml(spec.defaultModel)}</code></p>
			<button type="button" data-vendor="${escapeHtml(spec.vendor)}">Add</button>
		</section>`).join('');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 28px 32px 48px; line-height: 1.5; }
		h1 { font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
		.lede { max-width: 720px; color: var(--vscode-descriptionForeground); margin: 0 0 16px; }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
		section { padding: 16px 18px; border: 1px solid var(--vscode-widget-border, #2a3a38); border-radius: 12px; background: var(--vscode-sideBar-background, #141c1b); }
		h2 { margin: 0; font-size: 15px; }
		.meta { margin: 6px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); word-break: break-all; }
		code { font-family: var(--vscode-editor-font-family); }
		button { background: #1F6F6A; color: #F4F7F6; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; margin-top: 12px; }
		#free { margin-bottom: 16px; }
	</style>
</head>
<body>
	<h1>SI Code AI</h1>
	<p class="lede">Add a provider and SI Code asks for the key, fills in the endpoint, and lets you pick a model. The key stays in secret storage. The model then shows in the chat picker and the Language Models view.</p>
	<p><button id="free" type="button">Get free API keys</button></p>
	<div class="grid">${rows}</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('free').addEventListener('click', () => vscode.postMessage({ type: 'free' }));
		for (const button of document.querySelectorAll('button[data-vendor]')) {
			button.addEventListener('click', () => vscode.postMessage({ type: 'add', vendor: button.getAttribute('data-vendor') }));
		}
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] ?? char));
}
