/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Session } from '@supabase/supabase-js';
import * as vscode from 'vscode';
import { accountLabel, CALLBACK_HOST, CALLBACK_PORT, createSicodeAuthClient, credentialError, parseAuthCallback, REDIRECT_URI, renderAccountPage, type OAuthProvider } from './authFlow.js';

const SUPABASE_URL = 'https://abtmqyqptjcmrplkkpii.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2MFaZ69JOF4iPiHrBM_ATw_s3AX2ijn';
const STORAGE_SECRET = 'sicode.supabase.auth';
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
	const supabase = createSicodeAuthClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		getItem: key => cache[key] ?? null,
		setItem: (key, value) => {
			cache[key] = value;
			persist();
		},
		removeItem: key => {
			delete cache[key];
			persist();
		},
	});

	const sessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.show();
	let suppressPushUntil = 0;
	let pushTimer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<Session | undefined> | undefined;
	let panel: vscode.WebviewPanel | undefined;
	let sessionResolve: ((session: Session) => void) | undefined;
	let sessionReject: ((err: Error) => void) | undefined;

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
		account: { id: session.user.id, label: accountLabel(session.user) },
		scopes: ['email'],
	});

	const showStatus = (session: Session | null) => {
		if (session) {
			status.text = `$(account) ${accountLabel(session.user)}`;
			status.tooltip = 'SI Code — Sign out';
			status.command = 'sicode.signOut';
		} else {
			status.text = '$(account) SI Code';
			status.tooltip = 'SI Code account';
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

	const finish = async (session: Session): Promise<Session> => {
		sessions.fire({ added: [toAuthSession(session)], removed: [], changed: [] });
		showStatus(session);
		sessionResolve?.(session);
		sessionResolve = undefined;
		sessionReject = undefined;
		void vscode.window.showInformationMessage(`Signed in to SI Code as ${accountLabel(session.user)}.`);
		await pullSettings(session);
		render();
		return session;
	};

	const signInWithProvider = (provider: OAuthProvider): Promise<Session | undefined> => {
		if (inFlight) {
			return inFlight;
		}
		const label = provider === 'github' ? 'GitHub' : 'Google';
		inFlight = (async () => {
			await ready;
			const { data, error } = await supabase.auth.signInWithOAuth({
				provider,
				options: {
					redirectTo: REDIRECT_URI,
					skipBrowserRedirect: true,
				},
			});
			if (error || !data.url) {
				throw error ?? new Error('Supabase did not return a sign-in URL.');
			}
			const pending = waitForCode(3 * 60 * 1000);
			const opened = await vscode.env.openExternal(vscode.Uri.parse(data.url));
			if (!opened) {
				throw new Error(`The browser did not open for ${label} sign-in.`);
			}
			const code = await pending;
			const exchanged = await supabase.auth.exchangeCodeForSession(code);
			if (exchanged.error || !exchanged.data.session) {
				throw exchanged.error ?? new Error('Supabase did not return a session.');
			}
			return finish(exchanged.data.session);
		})().finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};

	const signInWithEmail = async (email: string, password: string, mode: 'signIn' | 'signUp' | 'reset'): Promise<Session | undefined> => {
		const problem = credentialError({ email, password, mode });
		if (problem) {
			throw new Error(problem);
		}
		await ready;
		if (mode === 'reset') {
			return resetPassword(email.trim());
		}
		if (mode === 'signUp') {
			const { data, error } = await supabase.auth.signUp({
				email: email.trim(),
				password,
				options: { emailRedirectTo: REDIRECT_URI },
			});
			if (error) {
				throw error;
			}
			if (!data.session) {
				panel?.webview.postMessage({ notice: 'Account created. Confirm the email, then sign in.' });
				void vscode.window.showInformationMessage('Account created. Confirm the email, then sign in.');
				return undefined;
			}
			return finish(data.session);
		}
		const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
		if (error || !data.session) {
			throw error ?? new Error('Supabase did not return a session.');
		}
		return finish(data.session);
	};

	const resetPassword = (email: string): Promise<Session | undefined> => {
		if (inFlight) {
			return inFlight;
		}
		inFlight = (async () => {
			const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URI });
			if (error) {
				throw error;
			}
			panel?.webview.postMessage({ notice: 'Check your email for the reset link. Keep SI Code open, then choose a new password.' });
			const code = await waitForCode(10 * 60 * 1000);
			const exchanged = await supabase.auth.exchangeCodeForSession(code);
			if (exchanged.error || !exchanged.data.session) {
				throw exchanged.error ?? new Error('Supabase did not return a session.');
			}
			const next = await vscode.window.showInputBox({
				title: 'SI Code',
				prompt: 'New password',
				password: true,
				ignoreFocusOut: true,
				validateInput: value => credentialError({ password: value, mode: 'newPassword' }),
			});
			if (!next) {
				await supabase.auth.signOut({ scope: 'local' });
				throw new Error('Password reset was cancelled.');
			}
			const updated = await supabase.auth.updateUser({ password: next });
			if (updated.error) {
				throw updated.error;
			}
			const session = (await currentSession()) ?? exchanged.data.session;
			return finish(session);
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
		render();
		void vscode.window.showInformationMessage('Signed out of SI Code.');
	};

	const render = () => {
		if (!panel) {
			return;
		}
		const target = panel;
		const nonce = Math.random().toString(36).slice(2);
		void currentSession().then(session => {
			if (panel === target) {
				target.webview.html = renderAccountPage(nonce, session ? accountLabel(session.user) : undefined);
			}
		});
	};

	const openAccount = async () => {
		if (panel) {
			panel.reveal();
			render();
			return;
		}
		panel = vscode.window.createWebviewPanel('sicode.account', 'SI Code account', vscode.ViewColumn.Active, { enableScripts: true });
		const current = panel;
		context.subscriptions.push(current);
		context.subscriptions.push(current.onDidDispose(() => {
			if (panel === current) {
				panel = undefined;
			}
			sessionReject?.(new Error('Sign-in was cancelled.'));
			sessionResolve = undefined;
			sessionReject = undefined;
		}));
		context.subscriptions.push(current.webview.onDidReceiveMessage(async message => {
			if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
				return;
			}
			try {
				if (message.type === 'signOut') {
					await signOut();
					return;
				}
				if (message.type === 'github' || message.type === 'google') {
					await signInWithProvider(message.type);
					return;
				}
				if (message.type === 'signIn' || message.type === 'signUp' || message.type === 'reset') {
					await signInWithEmail(typeof message.email === 'string' ? message.email : '', typeof message.password === 'string' ? message.password : '', message.type);
				}
			} catch (err) {
				const text = err instanceof Error ? err.message : String(err);
				current.webview.postMessage({ notice: text });
				void vscode.window.showErrorMessage(`SI Code account: ${text}`);
			}
		}));
		render();
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
			createSession: async () => {
				const existing = await currentSession();
				if (existing) {
					return toAuthSession(existing);
				}
				const signedIn = new Promise<Session>((resolve, reject) => {
					sessionResolve = resolve;
					sessionReject = reject;
				});
				await openAccount();
				return toAuthSession(await signedIn);
			},
			removeSession: async () => { await signOut(); },
		}),
		vscode.commands.registerCommand('sicode.signIn', () => openAccount()),
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

function waitForCode(timeoutMs: number): Promise<string> {
	const http = require('http');
	return new Promise((resolve, reject) => {
		let server: HttpServer | undefined;
		const timer = setTimeout(() => {
			server?.close();
			reject(new Error('Sign-in timed out waiting for the browser.'));
		}, timeoutMs);
		const created = http.createServer((req, res) => {
			const parsed = parseAuthCallback(req.url ?? '/');
			if (parsed.kind === 'ignore') {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<p>SI Code sign-in finished. You can close this window.</p>');
			clearTimeout(timer);
			created.close();
			if (parsed.kind === 'error') {
				reject(new Error(parsed.message));
				return;
			}
			resolve(parsed.code);
		});
		server = created;
		created.on('error', err => {
			clearTimeout(timer);
			reject(err.code === 'EADDRINUSE' ? new Error(`Port ${CALLBACK_PORT} is already in use.`) : err);
		});
		server.listen(CALLBACK_PORT, CALLBACK_HOST);
	});
}
