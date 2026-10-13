import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainChange, explainError, fixPrompt } from '../src/explain.ts';
import { shouldOfferFreeKeys } from '../src/firstRun.ts';
import { contentType, previewUrl, safeFile } from '../src/preview.ts';
import { simpleViewCommands, SIMPLE_HIDDEN } from '../src/simpleView.ts';
import { escapeHtml, pickStarter, renderStarter, slugify, targetDir } from '../src/starters.ts';

test('describe mode picks a starter and writes a previewable project', () => {
	assert.equal(pickStarter('a whatsapp bot for orders'), 'whatsapp');
	assert.equal(pickStarter('sales data dashboard'), 'dashboard');
	assert.equal(pickStarter('a landing page for the bakery'), 'landing');
	assert.equal(pickStarter('a site for my studio'), 'website');
	assert.equal(targetDir('Bakery site', []), '');
	assert.equal(targetDir('Bakery site', ['.git']), '');
	assert.equal(targetDir('Bakery site', ['README.md']), 'bakery-site');
	assert.equal(slugify(''), 'my-app');

	const attack = '<script>alert(1)</script>';
	const files = renderStarter('website', attack);
	const home = files.find(file => file.path === 'index.html')?.contents ?? '';
	assert.equal(home.includes(attack), false);
	assert.match(home, /&lt;script&gt;/);
	assert.equal(escapeHtml(`a&b"c'`), 'a&amp;b&quot;c&#39;');

	for (const kind of ['website', 'landing', 'whatsapp', 'dashboard'] as const) {
		const project = renderStarter(kind, 'Hello app');
		assert.ok(project.some(file => file.path === 'index.html'));
		assert.match(project.find(file => file.path === 'index.html')?.contents ?? '', /Hello app/);
		assert.equal(JSON.stringify(project).includes('sk-'), false);
		assert.equal(JSON.stringify(project).includes('AKIA'), false);
	}
	const bot = renderStarter('whatsapp', 'Order bot');
	assert.ok(bot.some(file => file.path === 'server.js'));
	assert.match(bot.find(file => file.path === 'server.js')?.contents ?? '', /\/webhook/);
	assert.deepEqual(renderStarter('dashboard', 'Orders').map(file => file.path).sort(), ['index.html', 'styles.css']);
	assert.equal(previewUrl(4312), 'http://127.0.0.1:4312/');
	assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
	assert.equal(safeFile('/work/app', '/'), '/work/app/index.html');
	assert.equal(safeFile('/work/app', '/styles.css'), '/work/app/styles.css');
	assert.equal(safeFile('/work/app', '/../secrets.env'), undefined);
});

test('errors and changes are explained in plain English and Fix it carries the error', () => {
	assert.match(explainError("Cannot find module 'left-pad'", 'src/app.js'), /not installed/);
	assert.match(explainError('Type "string" is not assignable to type "number".', 'src/a.ts'), /wrong type/);
	assert.match(explainError('SyntaxError: Unexpected token'), /typo/);
	assert.match(explainError('ENOENT: no such file or directory'), /missing/);
	assert.match(explainError('EADDRINUSE: address in use'), /Something failed/);
	assert.equal(explainChange('src/app.js', true), 'Added app.js. This is a new file.');
	assert.match(explainChange('src/app.js', false), /Updated app.js/);
	const prompt = fixPrompt("Cannot find module 'left-pad'", 'src/app.js');
	assert.match(prompt, /src\/app\.js/);
	assert.match(prompt, /left-pad/);
	assert.equal(prompt.includes('token'), false);
});

test('the first run opens free keys only when no model is configured', () => {
	assert.equal(shouldOfferFreeKeys({ prompted: false, configuredVendors: 0 }), true);
	assert.equal(shouldOfferFreeKeys({ prompted: true, configuredVendors: 0 }), false);
	assert.equal(shouldOfferFreeKeys({ prompted: false, configuredVendors: 1 }), false);
});

test('simple view hides the terminal, git, and the advanced bar', () => {
	assert.deepEqual(SIMPLE_HIDDEN, ['terminal', 'scm', 'auxiliarybar']);
	const on = simpleViewCommands(true);
	assert.ok(on.includes('workbench.action.closePanel'));
	assert.ok(on.includes('workbench.view.explorer'));
	assert.ok(on.includes('workbench.action.closeAuxiliaryBar'));
	assert.equal(on.includes('workbench.action.togglePanel'), false);
	assert.deepEqual(simpleViewCommands(false), ['workbench.action.togglePanel']);
});
