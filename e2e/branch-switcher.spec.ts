import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	expectInstalledPluginArchives,
	launchDevElectronApp,
	registerRendererConsoleLogging,
	writeStarterFiles,
} from "./electron-test-utils";
import type { Page } from "@playwright/test";

test("creating a branch from the switcher creates and activates a Lix branch", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace");
	const branchName = `e2e-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);

		await page.getByRole("button", { name: "Select branch" }).click();
		await page.getByRole("menuitem", { name: "Create branch" }).click();
		await page.getByRole("textbox", { name: "Branch name" }).fill(branchName);
		await page.getByRole("textbox", { name: "Branch name" }).press("Enter");

		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toContainText(branchName);

		const activeBranch = await page.evaluate(async () => {
			const desktop = window.flashtypeDesktop;
			if (!desktop) {
				throw new Error("Desktop bridge is unavailable");
			}
			const activeBranchId = await desktop.lix.activeBranchId();
			const result = await desktop.lix.execute({
				sql: "SELECT id, name FROM lix_branch WHERE id = ?",
				params: [activeBranchId],
			});
			const row = result.rows[0];
			const idIndex = result.columns.indexOf("id");
			const nameIndex = result.columns.indexOf("name");
			return {
				id: row?.[idIndex],
				name: row?.[nameIndex],
			};
		});

		expect(activeBranch.name).toBe(branchName);
		expect(activeBranch.id).toEqual(expect.any(String));
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("switching branches reloads an open file with target branch content", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-different-content");
	const branchName = `content-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		await page.getByTestId("file-tree-item-welcome-md").click();
		await expect(page.getByTestId("tiptap-editor")).toContainText("Welcome");

		await createBranchWithFileState(page, {
			branchName,
			path: "/welcome.md",
			data: "# Branch version\n\nTarget branch content.\n",
		});

		await switchBranchFromUi(page, branchName);

		await expect(page.getByTestId("tiptap-editor")).toContainText(
			"Target branch content.",
		);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("switching to a branch without the open file shows a missing-file state", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-missing-file");
	const branchName = `missing-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		await page.getByTestId("file-tree-item-welcome-md").click();
		await expect(page.getByTestId("tiptap-editor")).toContainText("Welcome");

		await createBranchWithoutFile(page, {
			branchName,
			path: "/welcome.md",
		});

		await switchBranchFromUi(page, branchName);

		await expect(page.getByText("File is not on this branch.")).toBeVisible();
		await expect(page.getByTestId("tiptap-editor")).toHaveCount(0);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("switching branches flushes pending editor edits before leaving the branch", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-flush-before-switch");
	const branchName = `flush-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		const setup = await createBranchWithFileState(page, {
			branchName,
			path: "/welcome.md",
			data: "# Target\n\nTarget branch content.\n",
		});

		await page.getByTestId("file-tree-item-welcome-md").click();
		await expect(page.getByTestId("tiptap-editor")).toContainText("Welcome");

		const editor = page.locator(".ProseMirror").first();
		await editor.click();
		await page.keyboard.press(
			process.platform === "darwin" ? "Meta+End" : "Control+End",
		);
		await page.keyboard.type(" Pending edit");

		await switchBranchFromUi(page, branchName);
		await expect(page.getByTestId("tiptap-editor")).toContainText(
			"Target branch content.",
		);

		const branchContents = await readFileMarkdownOnBranches(page, {
			fileId: setup.fileId,
			mainBranchId: setup.mainBranchId,
			targetBranchId: setup.branchId,
		});
		expect(branchContents.main).toContain("Pending edit");
		expect(branchContents.target).toContain("Target branch content.");
		expect(branchContents.target).not.toContain("Pending edit");
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("file tree refreshes branch-specific entries after switching", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-file-tree-refresh");
	const branchName = `tree-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);
		await expect(page.getByTestId("file-tree-item-welcome-md")).toBeVisible();
		await expect(page.getByTestId("file-tree-item-branch-only-md")).toHaveCount(
			0,
		);

		await createBranchWithNewFile(page, {
			branchName,
			path: "/branch-only.md",
			data: "# Branch only\n",
		});

		await switchBranchFromUi(page, branchName);

		await expect(
			page.getByTestId("file-tree-item-branch-only-md"),
		).toBeVisible();
		await expect(page.getByText("branch-only.md")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("active file deleted on target branch resolves to the missing-file fallback", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-active-file-deleted");
	const branchName = `deleted-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		await page.getByTestId("file-tree-item-welcome-md").click();
		await expect(page.getByTestId("tiptap-editor")).toContainText("Welcome");

		await createBranchWithoutFile(page, {
			branchName,
			path: "/welcome.md",
		});

		await switchBranchFromUi(page, branchName);

		await expect(page.getByText("File is not on this branch.")).toBeVisible();
		await expect(page.getByTestId("file-tree-item-welcome-md")).toHaveCount(0);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("CSV view does not crash when its file is missing on the target branch", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-csv-missing");
	const branchName = `csv-missing-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		await page.getByTestId("file-tree-item-metrics-csv").click();
		await expect(page.getByText("signups")).toBeVisible();

		await createBranchWithoutFile(page, {
			branchName,
			path: "/metrics.csv",
		});

		await switchBranchFromUi(page, branchName);

		await expect(page.getByText("File is not on this branch.")).toBeVisible();
		await expect(
			page.getByText(
				"This CSV exists in another branch, but it is not available in the current branch.",
			),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test.skip("branch switch failure keeps the current branch and reports the failure", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-switch-failure");
	const branchName = `failure-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);

		await createBranchWithFileState(page, {
			branchName,
			path: "/welcome.md",
			data: "# Should not become active\n",
		});
		await page.evaluate(() => {
			const desktop = window.flashtypeDesktop;
			if (!desktop) {
				throw new Error("Desktop bridge is unavailable");
			}
			desktop.lix.switchBranch = async () => {
				throw new Error("Injected switch failure");
			};
		});

		await page.getByRole("button", { name: "Select branch" }).click();
		await page.getByRole("menuitem", { name: branchName }).click();

		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toContainText("main");
		await page.getByRole("button", { name: "Select branch" }).click();
		await expect(page.getByRole("alert")).toContainText(
			"Could not switch branch.",
		);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test.skip("concurrent switch attempts are blocked while a switch is pending", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-concurrent-switch");
	const branchName = `slow-${testInfo.workerIndex}-${Date.now()}`;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);

		await createBranchWithFileState(page, {
			branchName,
			path: "/welcome.md",
			data: "# Slow branch\n",
		});
		await page.evaluate(() => {
			const desktop = window.flashtypeDesktop;
			if (!desktop) {
				throw new Error("Desktop bridge is unavailable");
			}
			const originalSwitchBranch = desktop.lix.switchBranch.bind(desktop.lix);
			let callCount = 0;
			(window as any).__switchBranchCallCount = () => callCount;
			desktop.lix.switchBranch = async (payload) => {
				callCount += 1;
				await new Promise((resolve) => setTimeout(resolve, 500));
				return await originalSwitchBranch(payload);
			};
		});

		await page.getByRole("button", { name: "Select branch" }).click();
		await page.getByRole("menuitem", { name: branchName }).click();
		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: "Select branch" })
			.click({ force: true });

		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toContainText(branchName);
		const callCount = await page.evaluate(() =>
			(window as any).__switchBranchCallCount(),
		);
		expect(callCount).toBe(1);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test.skip("multiple open file views resolve independently after branch switching", async () => {
	// TODO: add once the E2E harness can deterministically open and inspect
	// multiple central-panel file tabs at the same time.
});

test.skip("missing-file state exposes Create on this branch, Switch back, and Close file actions", async () => {
	// TODO: requires product/UI implementation of the missing-file actions.
});

test.skip("renderer-only unsaved state blocks branch switching with an explicit modal", async () => {
	// TODO: current autosave design flushes pending editor writes instead of
	// keeping renderer-only dirty state. Add this if a non-autosaved editor state
	// is introduced.
});

test.skip("branch switching while an external write review overlay is open has explicit behavior", async () => {
	// TODO: requires a product decision: dismiss review, keep review attached to
	// source branch, or block switching until review is accepted/rejected.
});

test.skip("JSON file views resolve branch-specific content and missing-file states", async () => {
	// TODO: enable once the JSON extension/view exists.
});

async function switchBranchFromUi(
	page: Page,
	branchName: string,
): Promise<void> {
	await page.getByRole("button", { name: "Select branch" }).click();
	await page.getByRole("menuitem", { name: branchName }).click();
	await expect(
		page.getByRole("button", { name: "Select branch" }),
	).toContainText(branchName);
}

async function createBranchWithFileState(
	page: Page,
	args: {
		readonly branchName: string;
		readonly path: string;
		readonly data: string;
	},
): Promise<{ branchId: string; fileId: string; mainBranchId: string }> {
	return await page.evaluate(async ({ branchName, path, data }) => {
		const desktop = window.flashtypeDesktop;
		if (!desktop) {
			throw new Error("Desktop bridge is unavailable");
		}
		const mainBranchId = await desktop.lix.activeBranchId();
		const fileResult = await desktop.lix.execute({
			sql: "SELECT id FROM lix_file WHERE path = ?",
			params: [path],
		});
		const fileIdIndex = fileResult.columns.indexOf("id");
		const fileId = fileResult.rows[0]?.[fileIdIndex];
		if (typeof fileId !== "string") {
			throw new Error(`Missing file for path ${path}`);
		}
		const created = await desktop.lix.createBranch({
			options: { name: branchName },
		});
		await desktop.lix.execute({
			sql: "UPDATE lix_file_by_branch SET data = ? WHERE id = ? AND lixcol_branch_id = ?",
			params: [new TextEncoder().encode(data), fileId, created.id],
		});
		return { branchId: created.id, fileId, mainBranchId };
	}, args);
}

async function createBranchWithNewFile(
	page: Page,
	args: {
		readonly branchName: string;
		readonly path: string;
		readonly data: string;
	},
): Promise<{ branchId: string; mainBranchId: string }> {
	return await page.evaluate(async ({ branchName, path, data }) => {
		const desktop = window.flashtypeDesktop;
		if (!desktop) {
			throw new Error("Desktop bridge is unavailable");
		}
		const mainBranchId = await desktop.lix.activeBranchId();
		const created = await desktop.lix.createBranch({
			options: { name: branchName },
		});
		await desktop.lix.switchBranch({ branchId: created.id });
		await desktop.lix.execute({
			sql: "INSERT INTO lix_file (path, data) VALUES (?, ?)",
			params: [path, new TextEncoder().encode(data)],
		});
		await desktop.lix.switchBranch({ branchId: mainBranchId });
		return { branchId: created.id, mainBranchId };
	}, args);
}

async function createBranchWithoutFile(
	page: Page,
	args: {
		readonly branchName: string;
		readonly path: string;
	},
): Promise<{ branchId: string; fileId: string; mainBranchId: string }> {
	return await page.evaluate(async ({ branchName, path }) => {
		const desktop = window.flashtypeDesktop;
		if (!desktop) {
			throw new Error("Desktop bridge is unavailable");
		}
		const mainBranchId = await desktop.lix.activeBranchId();
		const fileResult = await desktop.lix.execute({
			sql: "SELECT id FROM lix_file WHERE path = ?",
			params: [path],
		});
		const fileIdIndex = fileResult.columns.indexOf("id");
		const fileId = fileResult.rows[0]?.[fileIdIndex];
		if (typeof fileId !== "string") {
			throw new Error(`Missing file for path ${path}`);
		}
		const created = await desktop.lix.createBranch({
			options: { name: branchName },
		});
		await desktop.lix.execute({
			sql: "DELETE FROM lix_file_by_branch WHERE id = ? AND lixcol_branch_id = ?",
			params: [fileId, created.id],
		});
		return { branchId: created.id, fileId, mainBranchId };
	}, args);
}

async function readFileMarkdownOnBranches(
	page: Page,
	args: {
		readonly fileId: string;
		readonly mainBranchId: string;
		readonly targetBranchId: string;
	},
): Promise<{ main: string; target: string }> {
	return await page.evaluate(
		async ({ fileId, mainBranchId, targetBranchId }) => {
			const desktop = window.flashtypeDesktop;
			if (!desktop) {
				throw new Error("Desktop bridge is unavailable");
			}
			const readCurrent = async () => {
				const result = await desktop.lix.execute({
					sql: "SELECT data FROM lix_file WHERE id = ?",
					params: [fileId],
				});
				const row = result.rows[0];
				const dataIndex = result.columns.indexOf("data");
				const data = row?.[dataIndex];
				return new TextDecoder().decode(
					data instanceof Uint8Array ? data : new Uint8Array(),
				);
			};

			await desktop.lix.switchBranch({ branchId: mainBranchId });
			const main = await readCurrent();
			await desktop.lix.switchBranch({ branchId: targetBranchId });
			const target = await readCurrent();
			return { main, target };
		},
		args,
	);
}
