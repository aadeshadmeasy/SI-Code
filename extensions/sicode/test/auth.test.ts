import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { accountLabel, createSicodeAuthClient, credentialError, parseAuthCallback, REDIRECT_URI, renderAccountPage, type AuthStorage } from '../src/authFlow.ts';

test('the account page offers GitHub, Google, and email', () => {
	const html = renderAccountPage('nonce', undefined);
	assert.match(html, /data-action="github"/);
	assert.match(html, /data-action="google"/);
	assert.match(html, /data-mode="signIn"/);
	assert.match(html, /data-mode="signUp"/);
	assert.match(html, /data-mode="reset"/);
	assert.match(html, /type="password"/);
	const signedIn = renderAccountPage('nonce', 'person@example.com');
	assert.match(signedIn, /person@example.com/);
	assert.match(signedIn, /data-action="signOut"/);
	assert.equal(signedIn.includes('data-action="github"'), false);
});

test('callback parsing and password checks', () => {
	assert.deepEqual(parseAuthCallback('/auth/callback?code=abc'), { kind: 'code', code: 'abc' });
	assert.equal(parseAuthCallback('/auth/callback?error_description=access%20denied').kind, 'error');
	assert.equal(parseAuthCallback('/other').kind, 'ignore');
	assert.equal(credentialError({ email: 'not-an-email', password: 'secret1', mode: 'signIn' }), 'Enter an email address.');
	assert.equal(credentialError({ email: 'a@example.com', password: 'short', mode: 'signUp' }), 'Use a password of at least 6 characters.');
	assert.equal(credentialError({ email: 'a@example.com', mode: 'reset' }), undefined);
	assert.equal(credentialError({ password: 'long-enough', mode: 'newPassword' }), undefined);
	assert.equal(accountLabel({ email: null, user_metadata: { user_name: 'octocat' } }), 'octocat');
});

test('Google and GitHub PKCE sign-in persist a session', async () => {
	const seen: { provider?: string; redirect?: string; code?: string; verifier?: string } = {};
	const server = await listen(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		if (req.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
			const body = await readBody(req);
			seen.code = typeof body.auth_code === 'string' ? body.auth_code : undefined;
			seen.verifier = typeof body.code_verifier === 'string' && body.code_verifier.length > 0 ? 'present' : undefined;
			send(res, sessionBody('a@example.com'));
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	const storage = memoryStorage();
	const client = createSicodeAuthClient(origin(server), 'test-anon-key', storage);
	try {
		await client.auth.initialize();
		for (const provider of ['google', 'github'] as const) {
			const started = await client.auth.signInWithOAuth({
				provider,
				options: { redirectTo: REDIRECT_URI, skipBrowserRedirect: true },
			});
			assert.equal(started.error, null);
			const oauth = new URL(started.data.url);
			assert.equal(oauth.searchParams.get('provider'), provider);
			assert.equal(oauth.searchParams.get('redirect_to'), REDIRECT_URI);
			assert.ok(oauth.searchParams.get('code_challenge'));
			seen.provider = provider;
			seen.redirect = oauth.searchParams.get('redirect_to') ?? undefined;
		}
		const exchanged = await client.auth.exchangeCodeForSession('auth-code');
		assert.equal(exchanged.error, null);
		assert.equal(exchanged.data.session?.user.email, 'a@example.com');
		assert.equal(seen.code, 'auth-code');
		assert.equal(seen.verifier, 'present');
		assert.equal(seen.provider, 'github');
		assert.equal(seen.redirect, REDIRECT_URI);

		const restored = await restore(server, storage);
		assert.equal(restored, 'a@example.com');
	} finally {
		await client.auth.stopAutoRefresh();
		await close(server);
	}
});

test('email sign-in, sign-up, and password reset use Supabase and keep the session', async () => {
	const seen: { path?: string; email?: string; grant?: string; redirect?: string; updated?: boolean } = {};
	const server = await listen(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const body = req.method === 'GET' ? {} : await readBody(req);
		seen.path = url.pathname;
		seen.grant = url.searchParams.get('grant_type') ?? undefined;
		seen.redirect = url.searchParams.get('redirect_to') ?? undefined;
		seen.email = typeof body.email === 'string' ? body.email : undefined;
		if (req.method === 'POST' && url.pathname === '/auth/v1/token' && seen.grant === 'password') {
			assert.equal(typeof body.password, 'string');
			send(res, sessionBody('a@example.com'));
			return;
		}
		if (req.method === 'POST' && url.pathname === '/auth/v1/signup') {
			send(res, { id: 'user-1', email: 'a@example.com', aud: 'authenticated', role: 'authenticated' });
			return;
		}
		if (req.method === 'POST' && url.pathname === '/auth/v1/recover') {
			send(res, {});
			return;
		}
		if (req.method === 'POST' && url.pathname === '/auth/v1/token' && seen.grant === 'pkce') {
			send(res, sessionBody('a@example.com'));
			return;
		}
		if (req.method === 'PUT' && url.pathname === '/auth/v1/user') {
			assert.equal(typeof body.password, 'string');
			assert.equal(typeof req.headers.authorization, 'string');
			seen.updated = true;
			send(res, sessionBody('a@example.com').user);
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	const storage = memoryStorage();
	const client = createSicodeAuthClient(origin(server), 'test-anon-key', storage);
	try {
		await client.auth.initialize();
		const signedUp = await client.auth.signUp({
			email: 'a@example.com',
			password: 'correct-horse',
			options: { emailRedirectTo: REDIRECT_URI },
		});
		assert.equal(signedUp.error, null);
		assert.equal(signedUp.data.session, null);
		assert.equal(seen.path, '/auth/v1/signup');
		assert.equal(seen.redirect, REDIRECT_URI);

		const signedIn = await client.auth.signInWithPassword({ email: 'a@example.com', password: 'correct-horse' });
		assert.equal(signedIn.error, null);
		assert.equal(signedIn.data.session?.user.email, 'a@example.com');
		assert.equal(seen.grant, 'password');
		const restored = await restore(server, storage);
		assert.equal(restored, 'a@example.com');

		const reset = await client.auth.resetPasswordForEmail('a@example.com', { redirectTo: REDIRECT_URI });
		assert.equal(reset.error, null);
		assert.equal(seen.path, '/auth/v1/recover');
		assert.equal(seen.email, 'a@example.com');
		assert.equal(seen.redirect, REDIRECT_URI);
		const exchanged = await client.auth.exchangeCodeForSession('reset-code');
		assert.equal(exchanged.error, null);
		const updated = await client.auth.updateUser({ password: 'new-password' });
		assert.equal(updated.error, null);
		assert.equal(seen.updated, true);
		const { data } = await client.auth.getSession();
		assert.equal(data.session?.user.email, 'a@example.com');
	} finally {
		await client.auth.stopAutoRefresh();
		await close(server);
	}
});

function sessionBody(email: string) {
	return {
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		expires_in: 360000,
		expires_at: Math.floor(Date.now() / 1000) + 360000,
		token_type: 'bearer',
		user: {
			id: 'user-1',
			aud: 'authenticated',
			role: 'authenticated',
			email,
			app_metadata: { provider: 'email', providers: ['email'] },
			user_metadata: {},
			created_at: '2026-10-13T00:00:00Z',
		},
	};
}

function memoryStorage(): AuthStorage & { dump(): Record<string, string> } {
	const cache: Record<string, string> = {};
	return {
		getItem: key => cache[key] ?? null,
		setItem: (key, value) => { cache[key] = value; },
		removeItem: key => { delete cache[key]; },
		dump: () => ({ ...cache }),
	};
}

async function restore(server: Server, storage: AuthStorage & { dump(): Record<string, string> }): Promise<string | undefined> {
	const copy = memoryStorage();
	for (const [key, value] of Object.entries(storage.dump())) {
		copy.setItem(key, value);
	}
	const again = createSicodeAuthClient(origin(server), 'test-anon-key', copy);
	try {
		await again.auth.initialize();
		const { data } = await again.auth.getSession();
		return data.session?.user.email ?? undefined;
	} finally {
		await again.auth.stopAutoRefresh();
	}
}

function origin(server: Server): string {
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function send(res: ServerResponse, body: unknown): void {
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', chunk => chunks.push(chunk as Buffer));
		req.on('end', () => {
			const text = Buffer.concat(chunks).toString();
			resolve(text ? JSON.parse(text) as Record<string, unknown> : {});
		});
		req.on('error', reject);
	});
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<Server> {
	const server = createServer((req, res) => {
		void handler(req, res).catch(() => {
			res.statusCode = 500;
			res.end();
		});
	});
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
