/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createClient, Session } from '@supabase/supabase-js';
import * as vscode from 'vscode';

const SUPABASE_URL = 'https://abtmqyqptjcmrplkkpii.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2MFaZ69JOF4iPiHrBM_ATw_s3AX2ijn';
const STORAGE_SECRET = 'sicode.supabase.auth';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
const AUTH_PROVIDER_ID = 'sicode';

const SYNC_KEYS = [
	'openai.model',
	'anthropic.model',
	'gemini.model',
	'sarvam.model',
	'openrouter.model',
	'compatible.model',
	'compatible.baseUrl',
	'completions.enabled',
] as const;

interface HttpResponse {
	writeHead(code: number, headers?: Record<string, string>): void;
	end(body?: string): void;
}

interface HttpRequest {
	url?: string;
}

interface HttpServer {
	listen(port: number, host: string): void;
	close(): void;
	on(event: 'error', listener: (err: { code?: string }) => void): void;
}

declare function require(id: string): {
	createServer(listener: (req: HttpRequest, res: HttpResponse) => void): HttpServer;
};

export function registerSupabaseAuth(context: vscode.ExtensionContext): void {
	const cache: Record<string, string> = {};
	let persistChain = Promise.resolve();
	const persist = () => {
		const snapshot = JSON.stringify(cache);
		persistChain = persistChain
			.catch(() => undefined)
			.then(() => context.secrets.store(STORAGE_SECRET, snapshot));
	};
	const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			flowType: 'pkce',
			detectSessionInUrl: false,
			autoRefreshToken: true,
			persistSession: true,
			skipAutoInitialize: true,
			storage: {
				getItem: key => cache[key] ?? null,
				setItem: (key, value) => {
					cache[key] = value;
					persist();
				},
				removeItem: key => {
					delete cache[key];
					persist();
				},
			},
		},
	});

	const sessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.show();
	let suppressPushUntil = 0;
	let pushTimer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<Session> | undefined;

	const ready = (async () => {
		try {
			const raw = await context.secrets.get(STORAGE_SECRET);
			if (raw) {
				const stored = JSON.parse(raw) as Record<string, unknown>;
				for (const [key, value] of Object.entries(stored)) {
					if (typeof value === 'string') {
						cache[key] = value;
					}
				}
			}
		} catch (err) {
			console.error(err);
		}
		await supabase.auth.initialize();
	})();

	const toAuthSession = (session: Session): vscode.AuthenticationSession => ({
		id: session.user.id,
		accessToken: session.access_token,
		account: { id: session.user.id, label: session.user.email || 'Google' },
		scopes: ['email'],
	});

	const showStatus = (session: Session | null) => {
		if (session?.user.email) {
			status.text = `$(account) ${session.user.email}`;
			status.tooltip = 'SI Code — Sign out';
			status.command = 'sicode.signOut';
		} else {
			status.text = '$(account) SI Code';
			status.tooltip = 'SI Code: Sign in with Google';
			status.command = 'sicode.signIn';
		}
	};

	const currentSession = async (): Promise<Session | null> => {
		await ready;
		const { data } = await supabase.auth.getSession();
		return data.session;
	};

	const pushSettings = async (session: Session) => {
		const config = vscode.workspace.getConfiguration('sicode');
		const settings: Record<string, string | boolean | undefined> = {};
		for (const key of SYNC_KEYS) {
			settings[key] = config.get(key);
		}
		const { error } = await supabase.from('user_settings').upsert({
			user_id: session.user.id,
			settings,
			updated_at: new Date().toISOString(),
		});
		if (error) {
			console.error(`SI Code settings sync failed: ${error.message}`);
		}
	};

	const pullSettings = async (session: Session) => {
		const { data, error } = await supabase.from('user_settings').select('settings').eq('user_id', session.user.id).maybeSingle();
		if (error) {
			console.error(`SI Code settings sync failed: ${error.message}`);
			return;
		}
		const remote = data?.settings;
		if (!remote || typeof remote !== 'object') {
			await pushSettings(session);
			return;
		}
		suppressPushUntil = Date.now() + 1500;
		const config = vscode.workspace.getConfiguration('sicode');
		const values = remote as Record<string, unknown>;
		for (const key of SYNC_KEYS) {
			if (key in values) {
				await config.update(key, values[key], vscode.ConfigurationTarget.Global);
			}
		}
	};

	const schedulePush = () => {
		if (Date.now() < suppressPushUntil) {
			return;
		}
		if (pushTimer) {
			clearTimeout(pushTimer);
		}
		pushTimer = setTimeout(() => {
			pushTimer = undefined;
			void currentSession().then(session => session && pushSettings(session));
		}, 400);
	};

	const signIn = (): Promise<Session> => {
		if (inFlight) {
			return inFlight;
		}
		inFlight = (async () => {
			await ready;
			const { data, error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: {
					redirectTo: REDIRECT_URI,
					skipBrowserRedirect: true,
				},
			});
			if (error || !data.url) {
				throw error ?? new Error('Supabase did not return a sign-in URL.');
			}
			const pending = waitForCode();
			const opened = await vscode.env.openExternal(vscode.Uri.parse(data.url));
			if (!opened) {
				throw new Error('The browser did not open for Google sign-in.');
			}
			const code = await pending;
			const exchanged = await supabase.auth.exchangeCodeForSession(code);
			if (exchanged.error || !exchanged.data.session) {
				throw exchanged.error ?? new Error('Supabase did not return a session.');
			}
			const session = exchanged.data.session;
			sessions.fire({ added: [toAuthSession(session)], removed: [], changed: [] });
			showStatus(session);
			await pullSettings(session);
			const who = session.user.email || 'your Google account';
			void vscode.window.showInformationMessage(`Signed in to SI Code as ${who}.`);
			return session;
		})().finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};

	const signOut = async () => {
		const existing = await currentSession();
		await supabase.auth.signOut({ scope: 'local' });
		showStatus(null);
		if (existing) {
			sessions.fire({ added: [], removed: [toAuthSession(existing)], changed: [] });
		}
		void vscode.window.showInformationMessage('Signed out of SI Code.');
	};

	context.subscriptions.push(
		status,
		sessions,
		vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, 'SI Code', {
			onDidChangeSessions: sessions.event,
			getSessions: async () => {
				const session = await currentSession();
				return session ? [toAuthSession(session)] : [];
			},
			createSession: async () => toAuthSession(await signIn()),
			removeSession: async () => { await signOut(); },
		}),
		vscode.commands.registerCommand('sicode.signIn', () => signIn().catch(err => {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`SI Code sign-in failed. ${message}`);
		})),
		vscode.commands.registerCommand('sicode.signOut', () => signOut()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (SYNC_KEYS.some(key => event.affectsConfiguration(`sicode.${key}`))) {
				schedulePush();
			}
		}),
	);

	void ready.then(async () => {
		const session = await currentSession();
		showStatus(session);
		if (session) {
			await pullSettings(session);
		}
	}).catch(err => {
		console.error(err);
		showStatus(null);
	});
}

function waitForCode(): Promise<string> {
	const http = require('http');
	return new Promise((resolve, reject) => {
		let server: HttpServer | undefined;
		const timer = setTimeout(() => {
			server?.close();
			reject(new Error('Sign-in timed out waiting for the browser.'));
		}, 3 * 60 * 1000);
		const created = http.createServer((req, res) => {
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
			created.close();
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
		server = created;
		created.on('error', err => {
			clearTimeout(timer);
			reject(err.code === 'EADDRINUSE' ? new Error(`Port ${CALLBACK_PORT} is already in use.`) : err);
		});
		server.listen(CALLBACK_PORT, CALLBACK_HOST);
	});
}
