/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ModelListKind } from './catalog.js';
import { mergeModelIds, parseGeminiModelIds, parseOpenAIModelIds } from './modelPlan.js';

export async function fetchListedModels(kind: ModelListKind, endpoint: string, apiKey: string): Promise<string[]> {
	if (kind === 'none' || !endpoint.trim()) {
		return [];
	}
	const root = endpoint.replace(/\/$/, '');
	const headers: Record<string, string> = {};
	if (kind === 'gemini' && apiKey) {
		headers['x-goog-api-key'] = apiKey;
	}
	if (kind === 'openai' && apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	try {
		const response = await fetch(`${root}/models`, { headers, signal: AbortSignal.timeout(8000) });
		if (!response.ok) {
			return [];
		}
		const payload = await response.json() as unknown;
		return kind === 'gemini' ? parseGeminiModelIds(payload) : parseOpenAIModelIds(payload);
	} catch {
		return [];
	}
}

export async function modelChoices(kind: ModelListKind, endpoint: string, apiKey: string, curated: readonly string[]): Promise<string[]> {
	const fetched = await fetchListedModels(kind, endpoint, apiKey);
	const merged = mergeModelIds(curated, fetched);
	return merged.length ? merged : [...curated];
}
