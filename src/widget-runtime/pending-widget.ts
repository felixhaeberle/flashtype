import type { PanelState, WidgetInstance } from "./types";

/**
 * Options for configuring how a pending view is inserted into a panel.
 *
 * @example
 * upsertPendingWidget(panel, view, { activate: false });
 */
export interface UpsertPendingWidgetOptions {
	readonly activate?: boolean;
}

/**
 * Inserts or replaces the single pending slot in a panel.
 *
 * Ensures that only one pending view exists per panel by removing any prior
 * pending entry before appending the new view. The pending view is activated by
 * default to mirror IDE preview tabs.
 *
 * @example
 * const next = upsertPendingWidget(panel, {
 *   instance: "flashtype_file-1",
 *   kind: "flashtype_file",
 *   isPending: true,
 * });
 */
export function upsertPendingWidget(
	panel: PanelState,
	view: WidgetInstance,
	options: UpsertPendingWidgetOptions = {},
): PanelState {
	const activate = options.activate ?? true;
	const pendingWidget: WidgetInstance = view.isPending
		? view
		: { ...view, isPending: true };

	const viewsWithoutPending = panel.views.filter((entry) => !entry.isPending);
	const nextViews = [
		...viewsWithoutPending.filter(
			(entry) => entry.instance !== pendingWidget.instance,
		),
		pendingWidget,
	];

	const desiredActiveKey = activate
		? pendingWidget.instance
		: panel.activeInstance;
	const fallbackActive = nextViews[nextViews.length - 1]?.instance ?? null;
	const activeInstance =
		desiredActiveKey &&
		nextViews.some((entry) => entry.instance === desiredActiveKey)
			? desiredActiveKey
			: fallbackActive;

	return {
		views: nextViews,
		activeInstance,
	};
}

/**
 * Options for controlling how a view activation behaves.
 *
 * @example
 * activatePanelWidget(panel, "files-1", { finalizePending: false });
 */
export interface ActivatePanelWidgetOptions {
	readonly finalizePending?: boolean;
}

/**
 * Activates a view inside a panel and optionally finalizes pending status.
 *
 * Use this when a preview tab receives user interaction so that its pending
 * flag clears and the tab becomes permanent.
 *
 * @example
 * const next = activatePanelWidget(panel, "flashtype_file-1");
 */
export function activatePanelWidget(
	panel: PanelState,
	instance: string,
	options: ActivatePanelWidgetOptions = {},
): PanelState {
	const finalizePending = options.finalizePending ?? true;
	let found = false;

	const views = panel.views.map((view) => {
		if (view.instance !== instance) return view;
		found = true;
		if (!finalizePending || !view.isPending) {
			return { ...view };
		}
		return { ...view, isPending: false };
	});

	if (!found) return panel;

	return {
		views,
		activeInstance: instance,
	};
}
