/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { vendors } from './catalog.js';

export function registerInlineCompletions(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
		async provideInlineCompletionItems(document, position, completionContext, token) {
			if (!vscode.workspace.getConfiguration('sicode').get<boolean>('completions.enabled', true)) {
				return [];
			}
			const prefix = document.lineAt(position.line).text.slice(0, position.character);
			if (completionContext.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke && prefix.trim().length < 2) {
				return [];
			}
			const model = await pickModel();
			if (!model || token.isCancellationRequested) {
				return [];
			}
			const startLine = Math.max(0, position.line - 40);
			const before = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
			try {
				const response = await model.sendRequest([
					vscode.LanguageModelChatMessage.User([
						new vscode.LanguageModelTextPart('Complete the code at the cursor. Reply with only the text to insert. Do not repeat the existing prefix and do not use markdown fences.\n\n'),
						new vscode.LanguageModelTextPart(before),
					]),
				], {}, token);
				let insert = '';
				for await (const part of response.stream) {
					if (part instanceof vscode.LanguageModelTextPart) {
						insert += part.value;
					}
				}
				insert = stripFences(insert);
				if (prefix && insert.startsWith(prefix)) {
					insert = insert.slice(prefix.length);
				}
				insert = insert.replace(/\s+$/, '');
				if (!insert.trim() || token.isCancellationRequested) {
					return [];
				}
				const item = new vscode.InlineCompletionItem(insert.split('\n').slice(0, 20).join('\n'));
				item.range = new vscode.Range(position, position);
				return [item];
			} catch {
				return [];
			}
		},
	}));
}

async function pickModel(): Promise<vscode.LanguageModelChat | undefined> {
	for (const spec of vendors) {
		const models = await vscode.lm.selectChatModels({ vendor: spec.vendor });
		if (models.length) {
			return models[0];
		}
	}
	return undefined;
}

function stripFences(text: string): string {
	const fence = /^```[^\n]*\n([\s\S]*?)```$/.exec(text.trim());
	return fence ? fence[1] : text.trim();
}
