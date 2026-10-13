/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for SI Code language-model groups.
 * `src/vs/workbench/contrib/chat/common/sicodeModelMigration.ts` is a copy of this
 * file so the workbench can migrate groups without importing the extension.
 * A unit test fails if the two files differ.
 */

export interface VendorDefaults {
	readonly vendor: string;
	readonly endpoint?: string;
	readonly model?: string;
	readonly region?: string;
}

export interface ModelGroup {
	name: string;
	vendor: string;
	endpoint?: string;
	baseUrl?: string;
	model?: string;
	region?: string;
	[key: string]: unknown;
}

export interface ModelMigrationPlan<T extends ModelGroup> {
	readonly changed: boolean;
	readonly updates: readonly { readonly from: T; readonly to: T }[];
	readonly removals: readonly T[];
}

interface SchemaProperty {
	readonly default?: unknown;
	readonly enum?: readonly unknown[];
}

interface VendorSchema {
	readonly vendor: string;
	readonly configuration?: {
		readonly properties?: Readonly<Record<string, SchemaProperty | boolean>>;
	};
}

export function defaultsFromVendorSchemas(vendors: readonly VendorSchema[]): VendorDefaults[] {
	const defaults: VendorDefaults[] = [];
	for (const vendor of vendors) {
		if (!vendor.vendor.startsWith('sicode-')) {
			continue;
		}
		const properties = vendor.configuration?.properties ?? {};
		defaults.push({
			vendor: vendor.vendor,
			endpoint: stringDefault(properties.endpoint),
			region: stringDefault(properties.region),
			model: stringDefault(properties.model) ?? firstEnum(properties.model),
		});
	}
	return defaults;
}

/**
 * Fills missing endpoint, region, and model from the provider preset, then
 * collapses groups that would register the same model at the same endpoint.
 * The first group keeps its API key reference. Later copies are removed.
 */
export function planModelMigration<T extends ModelGroup>(groups: readonly T[], defaults: readonly VendorDefaults[]): ModelMigrationPlan<T> {
	const byVendor = new Map(defaults.map(entry => [entry.vendor, entry]));
	const updates: { from: T; to: T }[] = [];
	const filled: T[] = [];

	for (const group of groups) {
		const preset = byVendor.get(group.vendor);
		if (!preset) {
			filled.push(group);
			continue;
		}
		const next = fillGroup(group, preset);
		filled.push(next);
		if (!sameConfig(group, next)) {
			updates.push({ from: group, to: next });
		}
	}

	const seen = new Set<string>();
	const removals: T[] = [];
	for (const group of filled) {
		if (!byVendor.has(group.vendor)) {
			continue;
		}
		const key = dedupeKey(group);
		if (seen.has(key)) {
			removals.push(group);
			continue;
		}
		seen.add(key);
	}

	const removed = new Set(removals.map(group => `${group.vendor}\0${group.name}`));
	const keptUpdates = updates.filter(update => !removed.has(`${update.to.vendor}\0${update.to.name}`));
	return { changed: keptUpdates.length > 0 || removals.length > 0, updates: keptUpdates, removals };
}

export function parseOpenAIModelIds(payload: unknown): string[] {
	const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
	if (!Array.isArray(data)) {
		return [];
	}
	const ids: string[] = [];
	for (const entry of data) {
		const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined;
		if (typeof id === 'string' && id.trim()) {
			ids.push(id.trim());
		}
	}
	return ids;
}

export function parseGeminiModelIds(payload: unknown): string[] {
	const models = payload && typeof payload === 'object' ? (payload as { models?: unknown }).models : undefined;
	if (!Array.isArray(models)) {
		return [];
	}
	const ids: string[] = [];
	for (const entry of models) {
		const name = entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined;
		if (typeof name !== 'string' || !name.trim()) {
			continue;
		}
		ids.push(name.trim().replace(/^models\//, ''));
	}
	return ids;
}

/** Curated ids first, then ids returned by the provider, capped so the picker stays usable. */
export function mergeModelIds(curated: readonly string[], fetched: readonly string[], limit = 80): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const id of [...curated, ...fetched]) {
		if (!id || seen.has(id) || !isChatModelId(id)) {
			continue;
		}
		seen.add(id);
		merged.push(id);
		if (merged.length >= limit) {
			break;
		}
	}
	return merged;
}

export function isChatModelId(id: string): boolean {
	const lower = id.toLowerCase();
	return !lower.includes('embedding')
		&& !lower.includes('whisper')
		&& !lower.includes('tts')
		&& !lower.includes('dall-e')
		&& !lower.includes('moderation')
		&& !lower.includes('realtime');
}

function fillGroup<T extends ModelGroup>(group: T, preset: VendorDefaults): T {
	const endpoint = stringValue(group.endpoint) ?? stringValue(group.baseUrl) ?? preset.endpoint;
	const region = stringValue(group.region) ?? preset.region;
	const model = stringValue(group.model) ?? preset.model;
	const next: ModelGroup = { ...group };
	delete next.range;
	delete next.modelsRange;
	if (endpoint) {
		next.endpoint = endpoint;
	}
	if (region) {
		next.region = region;
	}
	if (model) {
		next.model = model;
	}
	return next as T;
}

function sameConfig(left: ModelGroup, right: ModelGroup): boolean {
	return left.endpoint === right.endpoint && left.model === right.model && left.region === right.region;
}

function dedupeKey(group: ModelGroup): string {
	return [group.vendor, group.model ?? '', group.endpoint ?? group.baseUrl ?? '', group.region ?? ''].join('\0');
}

function stringDefault(property: SchemaProperty | boolean | undefined): string | undefined {
	if (!property || typeof property === 'boolean') {
		return undefined;
	}
	return typeof property.default === 'string' && property.default.trim() ? property.default.trim() : undefined;
}

function firstEnum(property: SchemaProperty | boolean | undefined): string | undefined {
	if (!property || typeof property === 'boolean' || !Array.isArray(property.enum)) {
		return undefined;
	}
	const value = property.enum.find(item => typeof item === 'string' && item.trim());
	return typeof value === 'string' ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
