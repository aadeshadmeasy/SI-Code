/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Parts a simple view hides: the terminal panel, the git view, and the secondary advanced bar. */
export const SIMPLE_HIDDEN = ['terminal', 'scm', 'auxiliarybar'] as const;

export function simpleViewCommands(enabled: boolean): readonly string[] {
	return enabled
		? ['workbench.action.closePanel', 'workbench.view.explorer', 'workbench.action.closeAuxiliaryBar']
		: ['workbench.action.togglePanel'];
}
