/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { vendors } from './vendors.js';

export async function openSettings(context: vscode.ExtensionContext): Promise<void> {
	const panel = vscode.window.createWebviewPanel('sicode.configure', 'Si Code AI', vscode.ViewColumn.Active, { enableScripts: true });
	const nonce = Math.random().toString(36).slice(2);
	panel.webview.html = await render(context, nonce);
	const subscription = panel.webview.onDidReceiveMessage(async message => {
		if (!message || message.type !== 'save') {
			return;
		}
		const config = vscode.workspace.getConfiguration('sicode');
		const secrets = message.secrets as Record<string, unknown> | undefined;
		const settings = message.settings as Record<string, unknown> | undefined;
		for (const spec of vendors) {
			const secret = secrets?.[spec.secretKey];
			if (typeof secret === 'string' && secret.trim()) {
				await context.secrets.store(spec.secretKey, secret.trim());
			} else if (secret === null) {
				await context.secrets.delete(spec.secretKey);
			}
			const model = settings?.[spec.modelSetting];
			if (typeof model === 'string' && model.trim()) {
				await config.update(spec.modelSetting, model.trim(), vscode.ConfigurationTarget.Global);
			}
			if (spec.baseSetting) {
				const baseUrl = settings?.[spec.baseSetting];
				if (typeof baseUrl === 'string' && baseUrl.trim()) {
					await config.update(spec.baseSetting, baseUrl.trim(), vscode.ConfigurationTarget.Global);
				}
			}
		}
		panel.webview.html = await render(context, nonce);
		void vscode.window.showInformationMessage('Si Code saved your AI settings.');
	});
	panel.onDidDispose(() => subscription.dispose());
}

async function render(context: vscode.ExtensionContext, nonce: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('sicode');
	const rows = await Promise.all(vendors.map(async spec => {
		const saved = !!(await context.secrets.get(spec.secretKey));
		const model = config.get<string>(spec.modelSetting) || spec.defaultModel;
		const baseUrl = spec.baseSetting ? (config.get<string>(spec.baseSetting) || spec.defaultBaseUrl) : '';
		return { spec, saved, model, baseUrl };
	}));
	const fields = rows.map(row => `
		<section>
			<h2>${escapeHtml(row.spec.label)}</h2>
			<label>API key <input data-secret="${escapeHtml(row.spec.secretKey)}" type="password" placeholder="${row.saved ? 'Saved — leave blank to keep it' : 'Paste your key'}"></label>
			<button type="button" data-clear="${escapeHtml(row.spec.secretKey)}">Clear key</button>
			<label>Model <input data-setting="${escapeHtml(row.spec.modelSetting)}" value="${escapeHtml(row.model)}"></label>
			${row.spec.baseSetting ? `<label>Base URL <input data-setting="${escapeHtml(row.spec.baseSetting)}" value="${escapeHtml(row.baseUrl)}"></label>` : ''}
		</section>`).join('');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 28px 32px 48px; line-height: 1.5; }
		h1 { font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
		.lede { max-width: 640px; color: var(--vscode-descriptionForeground); margin: 0 0 24px; }
		section { max-width: 640px; margin: 0 0 16px; padding: 16px 18px; border: 1px solid var(--vscode-widget-border, #2a3a38); border-radius: 12px; background: var(--vscode-sideBar-background, #141c1b); }
		h2 { margin: 0; font-size: 15px; }
		label { display: block; margin: 10px 0; font-size: 13px; }
		input { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
		button { background: #1F6F6A; color: #F4F7F6; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
		button[data-clear] { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border, #3c3c3c); margin-top: 4px; }
		#save { margin-top: 8px; }
	</style>
</head>
<body>
	<h1>Si Code AI</h1>
	<p class="lede">Keys stay in secret storage. Chat, inline edit, agent mode, and completions use the model you select in the chat picker. Sarvam uses its OpenAI-compatible chat completions endpoint.</p>
	${fields}
	<p><button id="save" type="button">Save</button></p>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const cleared = new Set();
		for (const button of document.querySelectorAll('[data-clear]')) {
			button.addEventListener('click', () => {
				cleared.add(button.getAttribute('data-clear'));
				const input = document.querySelector('[data-secret="' + button.getAttribute('data-clear') + '"]');
				if (input) { input.value = ''; input.placeholder = 'Key will be removed'; }
			});
		}
		document.getElementById('save').addEventListener('click', () => {
			const secrets = {};
			const settings = {};
			for (const input of document.querySelectorAll('[data-secret]')) {
				const key = input.getAttribute('data-secret');
				secrets[key] = cleared.has(key) && !input.value ? null : input.value;
			}
			for (const input of document.querySelectorAll('[data-setting]')) {
				settings[input.getAttribute('data-setting')] = input.value;
			}
			vscode.postMessage({ type: 'save', secrets, settings });
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] ?? char));
}
