/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function shouldOfferFreeKeys(input: { prompted: boolean; configuredVendors: number }): boolean {
	return !input.prompted && input.configuredVendors === 0;
}
