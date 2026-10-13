/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { addVendorModel } from './addModel.js';
import { freeVendors, vendorById } from './catalog.js';

export function openFreeModels(): void {
	const panel = vscode.window.createWebviewPanel('sicode.freeModels', 'Free API Keys', vscode.ViewColumn.Active, { enableScripts: true });
	const nonce = Math.random().toString(36).slice(2);
	panel.webview.html = render(nonce);
	const subscription = panel.webview.onDidReceiveMessage(async message => {
		if (!message || typeof message !== 'object') {
			return;
		}
		if (message.type === 'open' && typeof message.url === 'string' && message.url.startsWith('https://')) {
			await vscode.env.openExternal(vscode.Uri.parse(message.url));
			return;
		}
		if (message.type !== 'add' || typeof message.vendor !== 'string') {
			return;
		}
		const spec = vendorById(message.vendor);
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
	const cards = freeVendors().map(spec => {
		const link = spec.free?.keyUrl
			? `<button type="button" class="link" data-url="${escapeHtml(spec.free.keyUrl)}">Get a key</button>`
			: '<span class="quiet">No key</span>';
		return `<section>
			<h2>${escapeHtml(spec.label)}</h2>
			<p>${escapeHtml(spec.free?.summary ?? '')}</p>
			<p class="meta">Endpoint <code>${escapeHtml(spec.defaultBaseUrl)}</code></p>
			<p class="meta">Suggested model <code>${escapeHtml(spec.defaultModel)}</code></p>
			<p class="actions">${link}<button type="button" data-vendor="${escapeHtml(spec.vendor)}">Add</button></p>
		</section>`;
	}).join('');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 28px 32px 64px; line-height: 1.5; }
		h1 { font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
		.lede, .note { max-width: 720px; color: var(--vscode-descriptionForeground); }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 20px; }
		section { padding: 16px 18px; border: 1px solid var(--vscode-widget-border, #2a3a38); border-radius: 12px; background: var(--vscode-sideBar-background, #141c1b); }
		h2 { margin: 0 0 6px; font-size: 15px; }
		p { margin: 0 0 8px; }
		.meta { font-size: 12px; color: var(--vscode-descriptionForeground); }
		code { font-family: var(--vscode-editor-font-family); }
		.actions { display: flex; gap: 12px; align-items: center; margin: 12px 0 0; }
		button { background: #1F6F6A; color: #F4F7F6; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
		button.link { background: transparent; color: #8FDED3; padding: 6px 0; }
		.quiet { color: var(--vscode-descriptionForeground); }
	</style>
</head>
<body>
	<h1>Get free API keys</h1>
	<p class="lede">Add a provider and SI Code asks for the key, fills in the endpoint, and lets you pick a model. The key stays in secret storage. Quotas change, so confirm the current free tier on the provider's site.</p>
	<div class="grid">${cards}</div>
	<p class="note">GitHub Models retired on July 30, 2026. The inference API is no longer available. Use Google AI Studio, Groq, OpenRouter, Cerebras, Mistral, Hugging Face, NVIDIA NIM, Cloudflare Workers AI, or Sarvam instead. Paid providers (OpenAI, Anthropic, Amazon Bedrock, Azure OpenAI, and others) are under SI Code: Configure AI.</p>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		for (const button of document.querySelectorAll('button[data-vendor]')) {
			button.addEventListener('click', () => vscode.postMessage({ type: 'add', vendor: button.getAttribute('data-vendor') }));
		}
		for (const button of document.querySelectorAll('button[data-url]')) {
			button.addEventListener('click', () => vscode.postMessage({ type: 'open', url: button.getAttribute('data-url') }));
		}
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] ?? char));
}
