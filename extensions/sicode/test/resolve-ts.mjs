export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith('./') && specifier.endsWith('.js') && context.parentURL?.includes('/extensions/sicode/src/')) {
		return nextResolve(specifier.slice(0, -3) + '.ts', context);
	}
	return nextResolve(specifier, context);
}
