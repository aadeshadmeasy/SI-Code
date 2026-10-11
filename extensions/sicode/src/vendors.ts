/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export interface VendorSpec {
	vendor: string;
	label: string;
	secretKey: string;
	modelSetting: string;
	defaultModel: string;
	kind: ProviderKind;
	defaultBaseUrl: string;
	baseSetting?: string;
	extraHeaders?: Record<string, string>;
	maxInputTokens?: number;
	subscriptionKeyHeader?: boolean;
}

export const vendors: readonly VendorSpec[] = [
	{
		vendor: 'sicode-openai',
		label: 'OpenAI',
		secretKey: 'sicode.openai.apiKey',
		modelSetting: 'openai.model',
		defaultModel: 'gpt-4o-mini',
		kind: 'openai',
		defaultBaseUrl: 'https://api.openai.com/v1',
	},
	{
		vendor: 'sicode-anthropic',
		label: 'Anthropic',
		secretKey: 'sicode.anthropic.apiKey',
		modelSetting: 'anthropic.model',
		defaultModel: 'claude-sonnet-4-5',
		kind: 'anthropic',
		defaultBaseUrl: 'https://api.anthropic.com',
	},
	{
		vendor: 'sicode-gemini',
		label: 'Google Gemini',
		secretKey: 'sicode.gemini.apiKey',
		modelSetting: 'gemini.model',
		defaultModel: 'gemini-2.0-flash',
		kind: 'gemini',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
	},
	{
		vendor: 'sicode-sarvam',
		label: 'Sarvam',
		secretKey: 'sicode.sarvam.apiKey',
		modelSetting: 'sarvam.model',
		defaultModel: 'sarvam-105b',
		kind: 'openai',
		defaultBaseUrl: 'https://api.sarvam.ai/v1',
		maxInputTokens: 64_000,
		subscriptionKeyHeader: true,
	},
	{
		vendor: 'sicode-openrouter',
		label: 'OpenRouter',
		secretKey: 'sicode.openrouter.apiKey',
		modelSetting: 'openrouter.model',
		defaultModel: 'openai/gpt-4o-mini',
		kind: 'openai',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		extraHeaders: { 'X-Title': 'Si Code' },
	},
	{
		vendor: 'sicode-compatible',
		label: 'OpenAI-compatible',
		secretKey: 'sicode.compatible.apiKey',
		modelSetting: 'compatible.model',
		defaultModel: 'llama3.2',
		kind: 'openai',
		defaultBaseUrl: 'http://127.0.0.1:11434/v1',
		baseSetting: 'compatible.baseUrl',
	},
];
