/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type StarterKind = 'website' | 'landing' | 'whatsapp' | 'dashboard';

export interface ProjectFile {
	readonly path: string;
	readonly contents: string;
}

const KINDS: readonly StarterKind[] = ['website', 'landing', 'whatsapp', 'dashboard'];

export function isStarterKind(value: string): value is StarterKind {
	return (KINDS as readonly string[]).includes(value);
}

export function pickStarter(description: string): StarterKind {
	const text = description.toLowerCase();
	if (/\bwhatsapp\b|\bbot\b/.test(text)) {
		return 'whatsapp';
	}
	if (/\bdashboard\b|\bchart\b|\bdata\b/.test(text)) {
		return 'dashboard';
	}
	if (/\blanding\b|\bsignup\b|\bmarketing\b|\bwaitlist\b/.test(text)) {
		return 'landing';
	}
	return 'website';
}

export function slugify(description: string): string {
	const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
	return slug || 'my-app';
}

export function targetDir(description: string, rootNames: readonly string[]): string {
	const occupied = rootNames.some(name => name !== '.git' && name !== '.sicode' && name !== '.vscode');
	return occupied ? slugify(description) : '';
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => {
		switch (char) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
}

export function renderStarter(kind: StarterKind, description: string): ProjectFile[] {
	const title = escapeHtml(description.trim() || defaultTitle(kind));
	switch (kind) {
		case 'landing':
			return landing(title);
		case 'whatsapp':
			return whatsapp(title);
		case 'dashboard':
			return dashboard(title);
		default:
			return website(title);
	}
}

function defaultTitle(kind: StarterKind): string {
	switch (kind) {
		case 'landing': return 'Landing page';
		case 'whatsapp': return 'WhatsApp bot';
		case 'dashboard': return 'Data dashboard';
		default: return 'Website';
	}
}

function page(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${title}</title>
	<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
</body>
</html>
`;
}

const styles = `body { margin: 0; font-family: Georgia, serif; color: #14221f; background: #f4f7f6; }
a { color: #1f6f6a; }
header, main, footer { max-width: 880px; margin: 0 auto; padding: 24px; }
nav a { margin-right: 16px; }
.hero { padding: 64px 24px; background: #1f6f6a; color: #f4f7f6; }
.hero h1 { font-size: 48px; margin: 0 0 12px; }
button, .button { background: #f4f7f6; color: #1f6f6a; border: 0; border-radius: 999px; padding: 12px 18px; font: inherit; }
.card { background: white; border-radius: 16px; padding: 16px; margin: 12px 0; }
.bar { height: 18px; background: #1f6f6a; border-radius: 9px; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 8px 0; border-bottom: 1px solid #d5dedb; }
`;

function website(title: string): ProjectFile[] {
	return [
		{
			path: 'index.html',
			contents: page(title, `	<header><nav><a href="index.html">Home</a><a href="about.html">About</a></nav></header>
	<main>
		<h1>${title}</h1>
		<p>This site was generated from your description.</p>
	</main>`),
		},
		{
			path: 'about.html',
			contents: page(`${title} — About`, `	<main><h1>About</h1><p>${title}</p><p><a href="index.html">Back home</a></p></main>`),
		},
		{ path: 'styles.css', contents: styles },
	];
}

function landing(title: string): ProjectFile[] {
	return [
		{
			path: 'index.html',
			contents: page(title, `	<section class="hero">
		<h1>${title}</h1>
		<p>Tell people what this is for, then invite them in.</p>
		<p><a class="button" href="#join">Join the list</a></p>
	</section>
	<main id="join" class="card"><h2>Get started</h2><p>Add your email form here when you are ready.</p></main>`),
		},
		{ path: 'styles.css', contents: styles },
	];
}

function whatsapp(title: string): ProjectFile[] {
	return [
		{
			path: 'index.html',
			contents: page(title, `	<main>
		<h1>${title}</h1>
		<div class="card"><p><strong>Bot:</strong> Hello. Send a message and I will reply.</p></div>
		<div class="card"><p><strong>You:</strong> ${title}</p></div>
		<p>This preview runs on your computer. The bot replies at <code>/webhook</code>.</p>
	</main>`),
		},
		{ path: 'styles.css', contents: styles },
		{
			path: 'server.js',
			contents: `const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT) || 8787;

http.createServer((req, res) => {
	if (req.method === 'POST' && req.url === '/webhook') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ reply: 'Hello from your bot' }));
		return;
	}
	const name = req.url === '/' ? 'index.html' : (req.url || '').replace(/^\\//, '');
	const file = path.join(__dirname, name);
	if (!file.startsWith(__dirname)) {
		res.writeHead(403);
		res.end();
		return;
	}
	fs.readFile(file, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(data);
	});
}).listen(port, '127.0.0.1');
`,
		},
		{
			path: 'package.json',
			contents: JSON.stringify({ name: slugify(title) || 'whatsapp-bot', private: true, scripts: { start: 'node server.js' } }, null, 2) + '\n',
		},
	];
}

function dashboard(title: string): ProjectFile[] {
	return [
		{
			path: 'index.html',
			contents: page(title, `	<main>
		<h1>${title}</h1>
		<div class="card"><div class="bar" style="width: 80%"></div><p>Visits</p></div>
		<div class="card"><div class="bar" style="width: 55%"></div><p>Signups</p></div>
		<table>
			<tr><th>Day</th><th>Visits</th></tr>
			<tr><td>Mon</td><td>120</td></tr>
			<tr><td>Tue</td><td>80</td></tr>
			<tr><td>Wed</td><td>140</td></tr>
		</table>
	</main>`),
		},
		{ path: 'styles.css', contents: styles },
	];
}
