/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ShipPlan {
	readonly command: string;
	readonly args: readonly string[];
}

export function vercelPlan(): ShipPlan {
	return { command: 'npx', args: ['--yes', 'vercel', 'deploy'] };
}

export function awsPlan(rootNames: readonly string[]): ShipPlan | { message: string } {
	if (rootNames.includes('cdk.json')) {
		return { command: 'npx', args: ['--yes', 'aws-cdk', 'deploy', '--require-approval', 'never'] };
	}
	if (rootNames.includes('template.yaml') || rootNames.includes('template.yml')) {
		return { command: 'sam', args: ['deploy', '--no-confirm-changeset', '--no-fail-on-empty-changeset'] };
	}
	return { message: 'This folder has no CDK app (cdk.json) or SAM template (template.yaml). Add one and sign in with the AWS CLI before shipping.' };
}

const PREVIEW_HOST = /vercel\.app|vercel\.sh|cloudfront\.net|amplifyapp\.com|elasticbeanstalk\.com|amazonaws\.com/i;

export function extractPreviewUrl(output: string): string | undefined {
	const matches = output.match(/https:\/\/[^\s)'"<>]+/g) ?? [];
	const preview = matches.filter(url => PREVIEW_HOST.test(url));
	const chosen = (preview.at(-1) ?? matches.at(-1))?.replace(/[.,]+$/, '');
	return chosen;
}
