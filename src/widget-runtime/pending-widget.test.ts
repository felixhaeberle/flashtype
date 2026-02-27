import { describe, expect, test } from "vitest";
import { activatePanelWidget, upsertPendingWidget } from "./pending-widget";
import type { PanelState } from "./types";
import { FILES_WIDGET_KIND, FILE_WIDGET_KIND } from "./widget-instance-helpers";

describe("pending view helpers", () => {
	test("upsertPendingWidget replaces the existing pending slot", () => {
		const panel: PanelState = {
			views: [
				{ instance: "files-1", kind: FILES_WIDGET_KIND },
				{ instance: "preview-1", kind: FILE_WIDGET_KIND, isPending: true },
			],
			activeInstance: "files-1",
		};

		const next = upsertPendingWidget(panel, {
			instance: "preview-2",
			kind: FILE_WIDGET_KIND,
			isPending: true,
		});

		expect(next.views).toHaveLength(2);
		expect(next.views[0]).toMatchObject({ instance: "files-1" });
		expect(next.views[0].isPending).toBeUndefined();
		expect(next.views[1]).toMatchObject({
			instance: "preview-2",
			isPending: true,
		});
		expect(next.activeInstance).toBe("preview-2");
	});

	test("upsertPendingWidget can preserve the current active tab", () => {
		const panel: PanelState = {
			views: [{ instance: "files-1", kind: FILES_WIDGET_KIND }],
			activeInstance: "files-1",
		};

		const next = upsertPendingWidget(
			panel,
			{ instance: "preview-1", kind: FILE_WIDGET_KIND, isPending: true },
			{ activate: false },
		);

		expect(next.activeInstance).toBe("files-1");
	});

	test("activatePanelWidget finalizes pending status and focuses the tab", () => {
		const panel: PanelState = {
			views: [
				{ instance: "files-1", kind: FILES_WIDGET_KIND },
				{ instance: "preview-1", kind: FILE_WIDGET_KIND, isPending: true },
			],
			activeInstance: "files-1",
		};

		const next = activatePanelWidget(panel, "preview-1");

		expect(next.activeInstance).toBe("preview-1");
		expect(next.views[1]).toMatchObject({
			instance: "preview-1",
			isPending: false,
		});
	});

	test("activatePanelWidget can skip finalizing pending", () => {
		const panel: PanelState = {
			views: [
				{ instance: "files-1", kind: FILES_WIDGET_KIND },
				{ instance: "preview-1", kind: FILE_WIDGET_KIND, isPending: true },
			],
			activeInstance: "files-1",
		};

		const next = activatePanelWidget(panel, "preview-1", {
			finalizePending: false,
		});

		expect(next.activeInstance).toBe("preview-1");
		expect(next.views[1]).toMatchObject({
			instance: "preview-1",
			isPending: true,
		});
	});

	test("activatePanelWidget returns the original panel when the view is missing", () => {
		const panel: PanelState = {
			views: [{ instance: "files-1", kind: FILES_WIDGET_KIND }],
			activeInstance: "files-1",
		};

		const next = activatePanelWidget(panel, "missing");

		expect(next).toBe(panel);
	});
});
