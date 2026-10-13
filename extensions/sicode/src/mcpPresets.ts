/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface McpSecretField {
	readonly name: string;
	readonly prompt: string;
	readonly password: boolean;
	readonly optional?: boolean;
}

export interface McpPreset {
	readonly id: string;
	readonly label: string;
	readonly transport: 'stdio' | 'http';
	readonly command: string;
	readonly args: readonly string[];
	readonly url?: string;
	readonly secrets: readonly McpSecretField[];
	/** Appended to args only when the server starts, from secret storage. */
	readonly secretArg?: string;
	/** HTTP Authorization bearer token, read from secret storage when the server starts. */
	readonly authSecret?: string;
}

export const mcpPresets: readonly McpPreset[] = [
	{
		id: 'supabase',
		label: 'Supabase',
		transport: 'http',
		command: '',
		args: [],
		url: 'https://mcp.supabase.com/mcp',
		authSecret: 'SUPABASE_ACCESS_TOKEN',
		secrets: [{ name: 'SUPABASE_ACCESS_TOKEN', prompt: 'Supabase access token', password: true }],
	},
	{
		id: 'github',
		label: 'GitHub',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		secrets: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', prompt: 'GitHub personal access token', password: true }],
	},
	{
		id: 'figma',
		label: 'Figma',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'figma-developer-mcp', '--stdio'],
		secrets: [{ name: 'FIGMA_API_KEY', prompt: 'Figma API key', password: true }],
	},
	{
		id: 'aws',
		label: 'AWS',
		transport: 'stdio',
		command: 'uvx',
		args: ['awslabs.aws-api-mcp-server@latest'],
		secrets: [
			{ name: 'AWS_ACCESS_KEY_ID', prompt: 'AWS access key id', password: true },
			{ name: 'AWS_SECRET_ACCESS_KEY', prompt: 'AWS secret access key', password: true },
			{ name: 'AWS_SESSION_TOKEN', prompt: 'AWS session token (optional)', password: true, optional: true },
			{ name: 'AWS_REGION', prompt: 'AWS region', password: false, optional: true },
		],
	},
	{
		id: 'postgres',
		label: 'Postgres',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-postgres'],
		secretArg: 'POSTGRES_CONNECTION_STRING',
		secrets: [{ name: 'POSTGRES_CONNECTION_STRING', prompt: 'Postgres connection string', password: true }],
	},
];

export function presetById(id: string): McpPreset | undefined {
	return mcpPresets.find(preset => preset.id === id);
}

export function secretStorageKey(presetId: string, name: string): string {
	return `sicode.mcp.${presetId}.${name}`;
}

export function enablePreset(enabled: readonly string[], id: string): string[] {
	return enabled.includes(id) ? [...enabled] : [...enabled, id];
}

export function requiredSecretNames(preset: McpPreset): string[] {
	return preset.secrets.filter(field => !field.optional).map(field => field.name);
}

export function missingSecrets(preset: McpPreset, secrets: Readonly<Record<string, string>>): string[] {
	return requiredSecretNames(preset).filter(name => !secrets[name]);
}

export function applySecrets(preset: McpPreset, secrets: Readonly<Record<string, string>>): { env: Record<string, string>; args: string[]; headers: Record<string, string> } {
	const env: Record<string, string> = {};
	for (const field of preset.secrets) {
		const value = secrets[field.name];
		if (value && !preset.authSecret && field.name !== preset.secretArg) {
			env[field.name] = value;
		}
	}
	if (preset.id === 'aws' && !env.AWS_REGION) {
		env.AWS_REGION = secrets.AWS_REGION || 'us-east-1';
	}
	const args = [...preset.args];
	if (preset.secretArg && secrets[preset.secretArg]) {
		args.push(secrets[preset.secretArg]);
	}
	const headers: Record<string, string> = {};
	if (preset.authSecret && secrets[preset.authSecret]) {
		headers.Authorization = `Bearer ${secrets[preset.authSecret]}`;
	}
	return { env, args, headers };
}

export function presetButtonsHtml(): string {
	return mcpPresets.map(preset =>
		`<button data-command="sicode.mcp.preset" data-arg="${preset.id}" type="button">${preset.label}</button>`
	).join('\n\t');
}
