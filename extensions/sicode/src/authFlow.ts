/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const CALLBACK_HOST = '127.0.0.1';
export const CALLBACK_PORT = 33418;
export const CALLBACK_PATH = '/auth/callback';
export const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

export type OAuthProvider = 'github' | 'google';
export type PasswordMode = 'signIn' | 'signUp' | 'reset' | 'newPassword';

export interface AuthStorage {
	getItem(key: string): string | null | Promise<string | null>;
	setItem(key: string, value: string): void | Promise<void>;
	removeItem(key: string): void | Promise<void>;
}

export function createSicodeAuthClient(url: string, anonKey: string, storage: AuthStorage): SupabaseClient {
	return createClient(url, anonKey, {
		auth: {
			flowType: 'pkce',
			detectSessionInUrl: false,
			autoRefreshToken: true,
			persistSession: true,
			skipAutoInitialize: true,
			storage,
		},
	});
}

export function credentialError(input: { email?: string; password?: string; mode: PasswordMode }): string | undefined {
	if (input.mode !== 'newPassword') {
		const email = input.email?.trim() ?? '';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return 'Enter an email address.';
		}
	}
	if (input.mode !== 'reset' && (!input.password || input.password.length < 6)) {
		return 'Use a password of at least 6 characters.';
	}
	return undefined;
}

export function accountLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
	if (user.email) {
		return user.email;
	}
	const metadata = user.user_metadata ?? {};
	for (const key of ['user_name', 'preferred_username', 'full_name', 'name']) {
		const value = metadata[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return 'SI Code';
}

export type AuthCallback = { kind: 'ignore' } | { kind: 'code'; code: string } | { kind: 'error'; message: string };

export function parseAuthCallback(requestUrl: string): AuthCallback {
	const url = new URL(requestUrl, REDIRECT_URI);
	if (url.pathname !== CALLBACK_PATH) {
		return { kind: 'ignore' };
	}
	const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
	if (oauthError) {
		return { kind: 'error', message: oauthError };
	}
	const code = url.searchParams.get('code');
	if (!code) {
		return { kind: 'error', message: 'Supabase did not return an authorization code.' };
	}
	return { kind: 'code', code };
}

export function renderAccountPage(nonce: string, email: string | undefined): string {
	const body = email
		? `<h1>SI Code account</h1>
			<p class="lede">Signed in as <strong>${escapeHtml(email)}</strong>. Model choices sync to this account. API keys stay on this machine.</p>
			<p><button type="button" data-action="signOut">Sign out</button></p>`
		: `<h1>Sign in to SI Code</h1>
			<p class="lede">Use GitHub, Google, or your email. The session stays on this machine and syncs your model choices. API keys stay on this machine.</p>
			<p class="actions">
				<button type="button" data-action="github">Continue with GitHub</button>
				<button type="button" data-action="google">Continue with Google</button>
			</p>
			<form>
				<label>Email <input name="email" type="email" autocomplete="username"></label>
				<label>Password <input name="password" type="password" autocomplete="current-password"></label>
				<p class="actions">
					<button type="submit" data-mode="signIn">Sign in</button>
					<button type="button" data-mode="signUp">Create account</button>
					<button type="button" class="quiet" data-mode="reset">Reset password</button>
				</p>
			</form>
			<p id="note" class="note"></p>`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
	<style>
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 28px 32px 48px; line-height: 1.5; }
		h1 { font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
		.lede, .note { max-width: 560px; color: var(--vscode-descriptionForeground); }
		form, .actions { max-width: 420px; }
		label { display: block; margin: 12px 0; font-size: 13px; }
		input { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
		.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
		button { background: #1F6F6A; color: #F4F7F6; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
		button.quiet { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border, #3c3c3c); }
	</style>
</head>
<body>
	${body}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const send = (message) => vscode.postMessage(message);
		for (const button of document.querySelectorAll('[data-action]')) {
			button.addEventListener('click', () => send({ type: button.getAttribute('data-action') }));
		}
		const form = document.querySelector('form');
		const email = () => (form && form.email.value || '').trim();
		const password = () => form ? form.password.value : '';
		const passwordAction = (mode) => send({ type: mode, email: email(), password: password() });
		if (form) {
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				passwordAction('signIn');
			});
			for (const button of form.querySelectorAll('[data-mode]')) {
				if (button.getAttribute('data-mode') === 'signIn') {
					continue;
				}
				button.addEventListener('click', () => passwordAction(button.getAttribute('data-mode')));
			}
		}
		window.addEventListener('message', (event) => {
			const note = document.getElementById('note');
			if (note && event.data && typeof event.data.notice === 'string') {
				note.textContent = event.data.notice;
			}
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] ?? char));
}
