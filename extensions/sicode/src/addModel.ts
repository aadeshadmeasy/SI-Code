/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { VendorSpec } from './catalog.js';
import { modelChoices } from './modelsFetch.js';

/**
 * Prompts for a key, keeps the preset endpoint, then asks for a model id.
 * The key is stored by the workbench secret service. The endpoint and model
 * id are written into chatLanguageModels.json.
 */
export async function addVendorModel(spec: VendorSpec, preferredModel?: string): Promise<void> {
	const endpoint = spec.auth === 'bedrock'
		? spec.defaultBaseUrl
		: await askEndpoint(spec);
	if (!endpoint) {
		return;
	}
	const secrets = await askSecrets(spec);
	if (!secrets) {
		return;
	}
	const curated = spec.models.map(model => model.id);
	const listed = spec.auth === 'bedrock'
		? curated
		: await modelChoices(spec.modelList, endpoint, secrets.apiKey ?? '', curated);
	const preferred = preferredModel && listed.includes(preferredModel) ? preferredModel : spec.defaultModel;
	const ordered = listed.includes(preferred) ? [preferred, ...listed.filter(id => id !== preferred)] : listed;
	const model = await askModel(spec, ordered, preferred);
	if (!model) {
		return;
	}
	const configuration: Record<string, unknown> = spec.auth === 'bedrock'
		? {
			region: secrets.region,
			accessKey: secrets.accessKey,
			secretKey: secrets.secretKey,
			...(secrets.sessionToken ? { sessionToken: secrets.sessionToken } : {}),
			model,
		}
		: {
			endpoint,
			...(secrets.apiKey ? { apiKey: secrets.apiKey } : {}),
			model,
		};
	await saveGroup(spec, configuration);
	void vscode.window.showInformationMessage(`${spec.label} is ready. ${model} is in the chat model picker.`);
}

async function askEndpoint(spec: VendorSpec): Promise<string | undefined> {
	const editable = spec.vendor === 'sicode-compatible'
		|| spec.vendor === 'sicode-azure'
		|| spec.vendor === 'sicode-cloudflare'
		|| spec.vendor === 'sicode-ollama'
		|| spec.vendor === 'sicode-lmstudio';
	if (!editable) {
		return spec.defaultBaseUrl;
	}
	const value = await vscode.window.showInputBox({
		title: spec.label,
		prompt: 'Endpoint',
		value: spec.defaultBaseUrl,
		ignoreFocusOut: true,
		validateInput: text => text.trim() ? undefined : 'Enter an endpoint',
	});
	return value?.trim();
}

async function askSecrets(spec: VendorSpec): Promise<{ apiKey?: string; accessKey?: string; secretKey?: string; sessionToken?: string; region?: string } | undefined> {
	if (spec.auth === 'bedrock') {
		const region = await vscode.window.showQuickPick(
			(spec.regions ?? []).map(entry => ({ label: entry.label, description: entry.id, regionId: entry.id })),
			{
				title: `${spec.label}: Region`,
				placeHolder: 'AWS Region',
				ignoreFocusOut: true,
			},
		);
		if (!region) {
			return undefined;
		}
		const accessKey = await secretInput(spec.label, 'AWS access key id');
		if (!accessKey) {
			return undefined;
		}
		const secretKey = await secretInput(spec.label, 'AWS secret access key');
		if (!secretKey) {
			return undefined;
		}
		const sessionToken = await vscode.window.showInputBox({
			title: spec.label,
			prompt: 'AWS session token (optional)',
			password: true,
			ignoreFocusOut: true,
		});
		return { accessKey, secretKey, sessionToken: sessionToken?.trim() || undefined, region: region.regionId };
	}
	if (spec.apiKeyOptional) {
		const apiKey = await vscode.window.showInputBox({
			title: spec.label,
			prompt: 'API key (optional)',
			password: true,
			value: spec.apiKeyDefault ?? '',
			ignoreFocusOut: true,
		});
		if (apiKey === undefined) {
			return undefined;
		}
		return { apiKey: apiKey.trim() || spec.apiKeyDefault };
	}
	const apiKey = await secretInput(spec.label, 'API key');
	if (!apiKey) {
		return undefined;
	}
	return { apiKey };
}

async function askModel(spec: VendorSpec, ids: readonly string[], initial: string): Promise<string | undefined> {
	const items = ids.map(id => {
		const known = spec.models.find(model => model.id === id);
		return { label: known?.label ?? id, description: id, modelId: id };
	});
	items.push({ label: 'Enter a custom model id', description: '', modelId: '__custom__' });
	const picked = await vscode.window.showQuickPick(items, {
		title: `${spec.label}: Model`,
		placeHolder: initial,
		ignoreFocusOut: true,
	});
	if (!picked) {
		return undefined;
	}
	if (picked.modelId !== '__custom__') {
		return picked.modelId;
	}
	const custom = await vscode.window.showInputBox({
		title: spec.label,
		prompt: 'Model id',
		value: initial,
		ignoreFocusOut: true,
		validateInput: text => text.trim() ? undefined : 'Enter a model id',
	});
	return custom?.trim();
}

async function secretInput(title: string, prompt: string): Promise<string | undefined> {
	const value = await vscode.window.showInputBox({
		title,
		prompt,
		password: true,
		ignoreFocusOut: true,
		validateInput: text => text.trim() ? undefined : 'Enter a value',
	});
	return value?.trim();
}

async function saveGroup(spec: VendorSpec, configuration: Record<string, unknown>): Promise<void> {
	for (let count = 1; count < 20; count++) {
		const name = count === 1 ? spec.displayName : `${spec.displayName} ${count}`;
		try {
			await vscode.commands.executeCommand('lm.addLanguageModelsProviderGroup', { name, vendor: spec.vendor, ...configuration });
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!message.includes('already exists')) {
				throw err;
			}
		}
	}
	throw new Error(`SI Code could not add another ${spec.label} group.`);
}
