import type { WidgetDefinition, WidgetKind } from "./types";
import { widget as filesWidgetDefinition } from "../widgets/files";
import { widget as searchWidgetDefinition } from "../widgets/search";
import { widget as tasksWidgetDefinition } from "../widgets/tasks";
import { widget as checkpointWidgetDefinition } from "../widgets/checkpoint";
import { widget as historyWidgetDefinition } from "../widgets/history";
import { widget as markdownWidgetDefinition } from "../widgets/markdown";
import { widget as commitWidgetDefinition } from "../widgets/commit";
import { widget as diffWidgetDefinition } from "../widgets/diff";
import { widget as terminalWidgetDefinition } from "../widgets/terminal";

const VISIBLE_WIDGETS: WidgetDefinition[] = [
	filesWidgetDefinition,
	searchWidgetDefinition,
	tasksWidgetDefinition,
	checkpointWidgetDefinition,
	historyWidgetDefinition,
	terminalWidgetDefinition,
];

const HIDDEN_WIDGETS: WidgetDefinition[] = [
	markdownWidgetDefinition,
	commitWidgetDefinition,
	diffWidgetDefinition,
];

export const WIDGET_DEFINITIONS: WidgetDefinition[] = VISIBLE_WIDGETS;

export const WIDGET_MAP = new Map<WidgetKind, WidgetDefinition>(
	[...VISIBLE_WIDGETS, ...HIDDEN_WIDGETS].map((ext) => [ext.kind, ext]),
);

let widgetCounter = 0;

export function createWidgetInstanceId(kind: WidgetKind): string {
	widgetCounter += 1;
	return `${kind}-${widgetCounter}`;
}
