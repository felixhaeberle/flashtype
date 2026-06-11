import type { WidgetDefinition } from "./types";

export function normalizeInstalledWidgetDefinitions(
	definitions: readonly WidgetDefinition[],
): WidgetDefinition[] {
	const dedupedByKind = new Map<string, WidgetDefinition>();
	for (const definition of definitions) {
		if (dedupedByKind.has(definition.kind)) continue;
		dedupedByKind.set(definition.kind, definition);
	}
	return [...dedupedByKind.values()];
}
