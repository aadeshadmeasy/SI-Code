/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'bedrock';
export type AuthStyle = 'bearer' | 'api-key' | 'subscription' | 'bedrock';
export type ModelListKind = 'openai' | 'gemini' | 'none';

export interface ModelChoice {
	readonly id: string;
	readonly label: string;
}

export interface VendorSpec {
	readonly vendor: string;
	readonly label: string;
	readonly displayName: string;
	readonly secretKey: string;
	readonly modelSetting: string;
	readonly defaultModel: string;
	readonly models: readonly ModelChoice[];
	readonly kind: ProviderKind;
	readonly auth: AuthStyle;
	readonly defaultBaseUrl: string;
	readonly modelList: ModelListKind;
	readonly endpointTitle: string;
	readonly apiKeyOptional?: boolean;
	readonly apiKeyDefault?: string;
	readonly extraHeaders?: Readonly<Record<string, string>>;
	readonly maxInputTokens?: number;
	readonly regions?: readonly ModelChoice[];
	readonly free?: {
		readonly summary: string;
		readonly keyUrl?: string;
	};
}

const choice = (id: string, label = id): ModelChoice => ({ id, label });

export const vendors: readonly VendorSpec[] = [
	{
		vendor: 'sicode-openai',
		label: 'OpenAI',
		displayName: 'OpenAI',
		secretKey: 'sicode.openai.apiKey',
		modelSetting: 'openai.model',
		defaultModel: 'gpt-4o-mini',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.openai.com/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('gpt-4o-mini', 'GPT-4o mini'),
			choice('gpt-4o', 'GPT-4o'),
			choice('gpt-4.1-mini', 'GPT-4.1 mini'),
			choice('gpt-4.1', 'GPT-4.1'),
			choice('o4-mini', 'o4-mini'),
			choice('o3-mini', 'o3-mini'),
		],
	},
	{
		vendor: 'sicode-anthropic',
		label: 'Anthropic',
		displayName: 'Anthropic',
		secretKey: 'sicode.anthropic.apiKey',
		modelSetting: 'anthropic.model',
		defaultModel: 'claude-sonnet-4-5',
		kind: 'anthropic',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.anthropic.com',
		modelList: 'none',
		endpointTitle: 'Endpoint',
		models: [
			choice('claude-sonnet-4-5', 'Claude Sonnet 4.5'),
			choice('claude-haiku-4-5', 'Claude Haiku 4.5'),
			choice('claude-3-5-haiku-latest', 'Claude 3.5 Haiku'),
			choice('claude-opus-4-5', 'Claude Opus 4.5'),
			choice('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5 (dated)'),
		],
	},
	{
		vendor: 'sicode-gemini',
		label: 'Google Gemini',
		displayName: 'Google Gemini',
		secretKey: 'sicode.gemini.apiKey',
		modelSetting: 'gemini.model',
		defaultModel: 'gemini-2.5-flash',
		kind: 'gemini',
		auth: 'bearer',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		modelList: 'gemini',
		endpointTitle: 'Endpoint',
		maxInputTokens: 1_000_000,
		free: {
			summary: 'Google AI Studio gives a free tier for Gemini without a credit card. Daily quotas apply.',
			keyUrl: 'https://aistudio.google.com/apikey',
		},
		models: [
			choice('gemini-2.5-flash', 'Gemini 2.5 Flash'),
			choice('gemini-2.5-pro', 'Gemini 2.5 Pro'),
			choice('gemini-2.0-flash', 'Gemini 2.0 Flash'),
			choice('gemini-flash-latest', 'Gemini Flash (latest)'),
		],
	},
	{
		vendor: 'sicode-openrouter',
		label: 'OpenRouter',
		displayName: 'OpenRouter',
		secretKey: 'sicode.openrouter.apiKey',
		modelSetting: 'openrouter.model',
		defaultModel: 'openrouter/free',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		extraHeaders: { 'X-Title': 'SI Code' },
		free: {
			summary: 'OpenRouter serves free models, including the openrouter/free router, with an account and no credit card.',
			keyUrl: 'https://openrouter.ai/keys',
		},
		models: [
			choice('openrouter/free', 'Free model router'),
			choice('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (free)'),
			choice('google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash (free)'),
			choice('deepseek/deepseek-chat-v3-0324:free', 'DeepSeek Chat (free)'),
			choice('qwen/qwen3-coder:free', 'Qwen3 Coder (free)'),
		],
	},
	{
		vendor: 'sicode-groq',
		label: 'Groq',
		displayName: 'Groq',
		secretKey: 'sicode.groq.apiKey',
		modelSetting: 'groq.model',
		defaultModel: 'llama-3.3-70b-versatile',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'Groq Cloud has a free API tier. No credit card is required to create a key.',
			keyUrl: 'https://console.groq.com/keys',
		},
		models: [
			choice('llama-3.3-70b-versatile', 'Llama 3.3 70B'),
			choice('llama-3.1-8b-instant', 'Llama 3.1 8B'),
			choice('openai/gpt-oss-120b', 'GPT-OSS 120B'),
			choice('mixtral-8x7b-32768', 'Mixtral 8x7B'),
		],
	},
	{
		vendor: 'sicode-mistral',
		label: 'Mistral',
		displayName: 'Mistral',
		secretKey: 'sicode.mistral.apiKey',
		modelSetting: 'mistral.model',
		defaultModel: 'mistral-small-latest',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.mistral.ai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'Mistral La Plateforme includes a free experiment tier for its open models.',
			keyUrl: 'https://console.mistral.ai/api-keys',
		},
		models: [
			choice('mistral-small-latest', 'Mistral Small'),
			choice('open-mistral-nemo', 'Mistral Nemo'),
			choice('codestral-latest', 'Codestral'),
			choice('mistral-large-latest', 'Mistral Large'),
		],
	},
	{
		vendor: 'sicode-deepseek',
		label: 'DeepSeek',
		displayName: 'DeepSeek',
		secretKey: 'sicode.deepseek.apiKey',
		modelSetting: 'deepseek.model',
		defaultModel: 'deepseek-chat',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.deepseek.com',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('deepseek-chat', 'DeepSeek Chat'),
			choice('deepseek-reasoner', 'DeepSeek Reasoner'),
		],
	},
	{
		vendor: 'sicode-xai',
		label: 'xAI',
		displayName: 'xAI',
		secretKey: 'sicode.xai.apiKey',
		modelSetting: 'xai.model',
		defaultModel: 'grok-3-mini',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.x.ai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('grok-3-mini', 'Grok 3 Mini'),
			choice('grok-3', 'Grok 3'),
		],
	},
	{
		vendor: 'sicode-together',
		label: 'Together',
		displayName: 'Together',
		secretKey: 'sicode.together.apiKey',
		modelSetting: 'together.model',
		defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.together.xyz/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo'),
			choice('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'Llama 3.1 8B Turbo'),
			choice('Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder 32B'),
		],
	},
	{
		vendor: 'sicode-fireworks',
		label: 'Fireworks',
		displayName: 'Fireworks',
		secretKey: 'sicode.fireworks.apiKey',
		modelSetting: 'fireworks.model',
		defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B'),
			choice('accounts/fireworks/models/llama-v3p1-8b-instruct', 'Llama 3.1 8B'),
		],
	},
	{
		vendor: 'sicode-cerebras',
		label: 'Cerebras',
		displayName: 'Cerebras',
		secretKey: 'sicode.cerebras.apiKey',
		modelSetting: 'cerebras.model',
		defaultModel: 'llama3.1-8b',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.cerebras.ai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'Cerebras Inference has a free tier for its OpenAI-compatible API.',
			keyUrl: 'https://cloud.cerebras.ai/',
		},
		models: [
			choice('llama3.1-8b', 'Llama 3.1 8B'),
			choice('llama-3.3-70b', 'Llama 3.3 70B'),
			choice('gpt-oss-120b', 'GPT-OSS 120B'),
		],
	},
	{
		vendor: 'sicode-azure',
		label: 'Azure OpenAI',
		displayName: 'Azure OpenAI',
		secretKey: 'sicode.azure.apiKey',
		modelSetting: 'azure.model',
		defaultModel: 'gpt-4o-mini',
		kind: 'openai',
		auth: 'api-key',
		defaultBaseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		models: [
			choice('gpt-4o-mini', 'gpt-4o-mini deployment'),
			choice('gpt-4o', 'gpt-4o deployment'),
			choice('gpt-4.1', 'gpt-4.1 deployment'),
		],
	},
	{
		vendor: 'sicode-sarvam',
		label: 'Sarvam',
		displayName: 'Sarvam',
		secretKey: 'sicode.sarvam.apiKey',
		modelSetting: 'sarvam.model',
		defaultModel: 'sarvam-105b',
		kind: 'openai',
		auth: 'subscription',
		defaultBaseUrl: 'https://api.sarvam.ai/v1',
		modelList: 'none',
		endpointTitle: 'Endpoint',
		maxInputTokens: 128_000,
		free: {
			summary: 'Sarvam includes signup credits on a new API key. Chat uses the OpenAI-compatible endpoint.',
			keyUrl: 'https://dashboard.sarvam.ai/',
		},
		models: [
			choice('sarvam-105b', 'Sarvam 105B'),
			choice('sarvam-105b-conversations', 'Sarvam 105B Conversations'),
		],
	},
	{
		vendor: 'sicode-huggingface',
		label: 'Hugging Face',
		displayName: 'Hugging Face',
		secretKey: 'sicode.huggingface.apiKey',
		modelSetting: 'huggingface.model',
		defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://router.huggingface.co/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'A Hugging Face token can call the inference router, with a free serverless quota.',
			keyUrl: 'https://huggingface.co/settings/tokens',
		},
		models: [
			choice('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B'),
			choice('Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder 32B'),
			choice('mistralai/Mistral-7B-Instruct-v0.3', 'Mistral 7B Instruct'),
		],
	},
	{
		vendor: 'sicode-nvidia',
		label: 'NVIDIA NIM',
		displayName: 'NVIDIA NIM',
		secretKey: 'sicode.nvidia.apiKey',
		modelSetting: 'nvidia.model',
		defaultModel: 'meta/llama-3.3-70b-instruct',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'NVIDIA build.nvidia.com offers developer API keys for hosted NIM models.',
			keyUrl: 'https://build.nvidia.com/',
		},
		models: [
			choice('meta/llama-3.3-70b-instruct', 'Llama 3.3 70B'),
			choice('meta/llama-3.1-8b-instruct', 'Llama 3.1 8B'),
			choice('mistralai/mistral-small-24b-instruct', 'Mistral Small'),
		],
	},
	{
		vendor: 'sicode-cloudflare',
		label: 'Cloudflare Workers AI',
		displayName: 'Cloudflare Workers AI',
		secretKey: 'sicode.cloudflare.apiKey',
		modelSetting: 'cloudflare.model',
		defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		free: {
			summary: 'Workers AI includes a daily free allocation. Replace ACCOUNT_ID in the endpoint with your Cloudflare account id.',
			keyUrl: 'https://dash.cloudflare.com/',
		},
		models: [
			choice('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B'),
			choice('@cf/meta/llama-3.1-8b-instruct', 'Llama 3.1 8B'),
			choice('@cf/qwen/qwen2.5-coder-32b-instruct', 'Qwen 2.5 Coder 32B'),
		],
	},
	{
		vendor: 'sicode-bedrock',
		label: 'Amazon Bedrock',
		displayName: 'Amazon Bedrock',
		secretKey: 'sicode.bedrock.accessKey',
		modelSetting: 'bedrock.model',
		defaultModel: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
		kind: 'bedrock',
		auth: 'bedrock',
		defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
		modelList: 'none',
		endpointTitle: 'Endpoint',
		regions: [
			choice('us-east-1', 'US East (N. Virginia)'),
			choice('us-east-2', 'US East (Ohio)'),
			choice('us-west-2', 'US West (Oregon)'),
			choice('eu-west-1', 'Europe (Ireland)'),
			choice('eu-central-1', 'Europe (Frankfurt)'),
			choice('ap-south-1', 'Asia Pacific (Mumbai)'),
			choice('ap-northeast-1', 'Asia Pacific (Tokyo)'),
			choice('ap-southeast-2', 'Asia Pacific (Sydney)'),
		],
		models: [
			choice('global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5'),
			choice('global.anthropic.claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5'),
			choice('us.anthropic.claude-3-5-haiku-20241022-v1:0', 'Claude 3.5 Haiku'),
			choice('us.anthropic.claude-opus-4-1-20250805-v1:0', 'Claude Opus 4.1'),
			choice('us.meta.llama3-3-70b-instruct-v1:0', 'Llama 3.3 70B'),
			choice('us.meta.llama3-2-11b-instruct-v1:0', 'Llama 3.2 11B'),
			choice('us.mistral.mistral-large-2407-v1:0', 'Mistral Large'),
			choice('us.amazon.nova-pro-v1:0', 'Amazon Nova Pro'),
			choice('us.amazon.nova-lite-v1:0', 'Amazon Nova Lite'),
			choice('us.amazon.nova-micro-v1:0', 'Amazon Nova Micro'),
		],
	},
	{
		vendor: 'sicode-ollama',
		label: 'Ollama',
		displayName: 'Ollama',
		secretKey: 'sicode.ollama.apiKey',
		modelSetting: 'ollama.model',
		defaultModel: 'llama3.2',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'http://127.0.0.1:11434/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		apiKeyOptional: true,
		apiKeyDefault: 'ollama',
		free: {
			summary: 'Ollama runs models on this computer. No API key. The default endpoint is http://127.0.0.1:11434/v1.',
		},
		models: [
			choice('llama3.2', 'Llama 3.2'),
			choice('llama3.1', 'Llama 3.1'),
			choice('qwen2.5-coder', 'Qwen 2.5 Coder'),
			choice('mistral', 'Mistral'),
		],
	},
	{
		vendor: 'sicode-lmstudio',
		label: 'LM Studio',
		displayName: 'LM Studio',
		secretKey: 'sicode.lmstudio.apiKey',
		modelSetting: 'lmstudio.model',
		defaultModel: 'local-model',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'http://127.0.0.1:1234/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		apiKeyOptional: true,
		apiKeyDefault: 'lm-studio',
		free: {
			summary: 'LM Studio serves a local OpenAI-compatible server at http://127.0.0.1:1234/v1.',
		},
		models: [
			choice('local-model', 'Loaded model'),
		],
	},
	{
		vendor: 'sicode-compatible',
		label: 'OpenAI-compatible',
		displayName: 'OpenAI-compatible',
		secretKey: 'sicode.compatible.apiKey',
		modelSetting: 'compatible.model',
		defaultModel: 'llama3.2',
		kind: 'openai',
		auth: 'bearer',
		defaultBaseUrl: 'http://127.0.0.1:11434/v1',
		modelList: 'openai',
		endpointTitle: 'Endpoint',
		apiKeyOptional: true,
		apiKeyDefault: 'local',
		models: [
			choice('llama3.2', 'llama3.2'),
			choice('local-model', 'local-model'),
		],
	},
];

export function vendorById(vendor: string): VendorSpec | undefined {
	return vendors.find(spec => spec.vendor === vendor);
}

export function freeVendors(): readonly VendorSpec[] {
	return vendors.filter(spec => spec.free);
}

export interface ResolvedCredentials {
	readonly apiKey: string;
	readonly baseUrl: string;
	readonly model: string;
	readonly kind: ProviderKind;
	readonly auth: AuthStyle;
	readonly extraHeaders?: Readonly<Record<string, string>>;
	readonly maxInputTokens: number;
	readonly accessKey?: string;
	readonly secretKey?: string;
	readonly sessionToken?: string;
	readonly region?: string;
}

/**
 * Turns one saved group into the model SI Code registers.
 * Missing endpoint and model id fall back to the preset so older Sarvam
 * rows still appear. Keys stay out of the return value's logs: callers
 * pass them in and the result is not serialized.
 */
export function resolveCredentials(spec: VendorSpec, configuration: Readonly<Record<string, unknown>> | undefined, extensionSecret: string | undefined): ResolvedCredentials | undefined {
	const config = configuration ?? {};
	const endpoint = stringValue(config.endpoint) ?? stringValue(config.baseUrl) ?? spec.defaultBaseUrl;
	const model = stringValue(config.model) ?? spec.defaultModel;
	if (spec.auth === 'bedrock') {
		const accessKey = stringValue(config.accessKey);
		const secretKey = stringValue(config.secretKey);
		if (!accessKey || !secretKey) {
			return undefined;
		}
		const region = stringValue(config.region) ?? spec.regions?.[0]?.id ?? 'us-east-1';
		return {
			apiKey: accessKey,
			baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
			model,
			kind: spec.kind,
			auth: spec.auth,
			maxInputTokens: spec.maxInputTokens ?? 128_000,
			accessKey,
			secretKey,
			sessionToken: stringValue(config.sessionToken),
			region,
		};
	}
	const configuredKey = stringValue(config.apiKey);
	const unresolved = configuredKey?.startsWith('${input:');
	const apiKey = (!unresolved && configuredKey) || extensionSecret || (spec.apiKeyOptional ? spec.apiKeyDefault : undefined);
	if (!apiKey) {
		return undefined;
	}
	return {
		apiKey,
		baseUrl: endpoint.replace(/\/$/, ''),
		model,
		kind: spec.kind,
		auth: spec.auth,
		extraHeaders: spec.extraHeaders,
		maxInputTokens: spec.maxInputTokens ?? 128_000,
	};
}

export function configurationSchema(spec: VendorSpec): Record<string, unknown> {
	const model = {
		type: 'string',
		title: 'Model',
		description: 'Model id sent to the provider. The list is refreshed from the provider when it publishes one.',
		default: spec.defaultModel,
		enum: spec.models.map(entry => entry.id),
		enumItemLabels: spec.models.map(entry => entry.label),
		modelList: spec.modelList,
		allowCustomValue: true,
	};
	if (spec.auth === 'bedrock') {
		return {
			type: 'object',
			properties: {
				region: {
					type: 'string',
					title: 'Region',
					description: 'AWS Region for the Bedrock Runtime endpoint.',
					default: 'us-east-1',
					enum: spec.regions?.map(entry => entry.id),
					enumItemLabels: spec.regions?.map(entry => entry.label),
				},
				accessKey: {
					type: 'string',
					secret: true,
					title: 'Access Key',
					description: 'AWS access key id. Stored in secret storage.',
				},
				secretKey: {
					type: 'string',
					secret: true,
					title: 'Secret Key',
					description: 'AWS secret access key. Stored in secret storage.',
				},
				sessionToken: {
					type: 'string',
					secret: true,
					title: 'Session Token',
					description: 'Optional AWS session token for temporary credentials.',
				},
				model,
			},
			required: ['region', 'accessKey', 'secretKey', 'model'],
		};
	}
	const apiKey: Record<string, unknown> = {
		type: 'string',
		secret: true,
		title: 'API Key',
		description: spec.apiKeyOptional
			? 'Optional API key. Stored in secret storage. Local servers can keep the placeholder.'
			: 'API key. Stored in secret storage.',
	};
	if (spec.apiKeyDefault) {
		apiKey.default = spec.apiKeyDefault;
	}
	const required = spec.apiKeyOptional ? ['endpoint', 'model'] : ['endpoint', 'apiKey', 'model'];
	return {
		type: 'object',
		properties: {
			endpoint: {
				type: 'string',
				title: spec.endpointTitle,
				description: 'Base URL for the provider. SI Code fills this in for known providers.',
				default: spec.defaultBaseUrl,
			},
			apiKey,
			model,
		},
		required,
	};
}

export function languageModelContribution(spec: VendorSpec): Record<string, unknown> {
	return {
		vendor: spec.vendor,
		displayName: spec.displayName,
		configuration: configurationSchema(spec),
	};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
