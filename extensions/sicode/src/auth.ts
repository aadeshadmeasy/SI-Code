/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const SESSION_KEY = 'sicode.supabase.session';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

interface StoredSession {
	accessToken: string;
	refreshToken: string;
	email: string;
	expiresAt: number;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	user?: { email?: string };
	error_description?: string;
	msg?: string;
}

interface HttpResponse {
	writeHead(code: number, headers?: Record<string, string>): void;
	end(body?: string): void;
}

interface HttpRequest {
	url?: string;
}

interface HttpServer {
	listen(port: number, host: string): void;
	close(callback?: () => void): void;
	on(event: 'error', listener: (err: { code?: string }) => void): void;
}

declare function require(id: string): {
	createServer(listener: (req: HttpRequest, res: HttpResponse) => void): HttpServer;
};

function configValue(key: string): string {
	const value = vscode.workspace.getConfiguration('sicode').get<string>(key);
	return (value ?? '').trim().replace(/\/+$/, '');
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}

function waitForCode(timeoutMs: number): Promise<string> {
	const http = require('http');
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? '/', REDIRECT_URI);
			if (url.pathname !== CALLBACK_PATH) {
				res.writeHead(404);
				res.end();
				return;
			}
			const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<p>SI Code sign-in finished. You can close this window.</p>');
			clearTimeout(timer);
			server.close();
			if (oauthError) {
				reject(new Error(oauthError));
				return;
			}
			const code = url.searchParams.get('code');
			if (!code) {
				reject(new Error('Supabase did not return an authorization code.'));
				return;
			}
			resolve(code);
		});
		const timer = setTimeout(() => {
			server.close();
			reject(new Error('Sign-in timed out waiting for the browser.'));
		}, timeoutMs);
		server.on('error', err => {
			clearTimeout(timer);
			reject(err.code === 'EADDRINUSE'
				? new Error(`Port ${CALLBACK_PORT} is already in use.`)
				: err);
		});
		server.listen(CALLBACK_PORT, CALLBACK_HOST);
	});
}

async function exchangeCode(supabaseUrl: string, anonKey: string, code: string, verifier: string): Promise<StoredSession> {
	const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			apikey: anonKey,
			Authorization: `Bearer ${anonKey}`,
		},
		body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
	});
	const body = await response.json() as TokenResponse;
	if (!response.ok || !body.access_token || !body.refresh_token) {
		throw new Error(body.error_description || body.msg || `Supabase token exchange failed (${response.status}).`);
	}
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		email: body.user?.email ?? '',
		expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
	};
}

async function signIn(context: vscode.ExtensionContext): Promise<void> {
	const supabaseUrl = configValue('supabase.url');
	const anonKey = configValue('supabase.anonKey');
	if (!supabaseUrl || !anonKey) {
		void vscode.window.showInformationMessage('Set sicode.supabase.url and sicode.supabase.anonKey to your Supabase project, then sign in again.');
		return;
	}
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64Url(verifierBytes);
	const challenge = await createChallenge(verifier);
	const authorize = new URL(`${supabaseUrl}/auth/v1/authorize`);
	authorize.searchParams.set('provider', 'google');
	authorize.searchParams.set('redirect_to', REDIRECT_URI);
	authorize.searchParams.set('code_challenge', challenge);
	authorize.searchParams.set('code_challenge_method', 's256');
	const pending = waitForCode(3 * 60 * 1000);
	const opened = await vscode.env.openExternal(vscode.Uri.parse(authorize.toString()));
	if (!opened) {
		throw new Error('The browser did not open for Google sign-in.');
	}
	const code = await pending;
	const session = await exchangeCode(supabaseUrl, anonKey, code, verifier);
	await context.secrets.store(SESSION_KEY, JSON.stringify(session));
	const who = session.email || 'your Google account';
	void vscode.window.showInformationMessage(`Signed in to SI Code as ${who}.`);
}

async function signOut(context: vscode.ExtensionContext): Promise<void> {
	const raw = await context.secrets.get(SESSION_KEY);
	const supabaseUrl = configValue('supabase.url');
	const anonKey = configValue('supabase.anonKey');
	if (raw && supabaseUrl && anonKey) {
		const session = JSON.parse(raw) as StoredSession;
		await fetch(`${supabaseUrl}/auth/v1/logout`, {
			method: 'POST',
			headers: {
				apikey: anonKey,
				Authorization: `Bearer ${session.accessToken}`,
			},
		}).catch(() => undefined);
	}
	await context.secrets.delete(SESSION_KEY);
	void vscode.window.showInformationMessage('Signed out of SI Code.');
}

export function registerSupabaseAuth(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('sicode.signIn', () => signIn(context).catch(err => {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`SI Code sign-in failed. ${message}`);
		})),
		vscode.commands.registerCommand('sicode.signOut', () => signOut(context)),
	);
}
