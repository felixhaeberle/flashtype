import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	filterExistingWorkspaceEntries,
	getWorkspaceSessionPath,
	readWorkspaceSessionEntries,
	writeWorkspaceSessionEntries,
	writeWorkspaceSessionEntriesSync,
	WORKSPACE_SESSION_VERSION,
} from "./workspace-session.mjs";

describe("workspace session store", () => {
	test("missing store returns no workspace entries", async () => {
		const userDataPath = createUserDataPath();

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("corrupt or invalid stores return no workspace entries", async () => {
		const userDataPath = createUserDataPath();
		await mkdir(userDataPath, { recursive: true });

		await writeFile(getWorkspaceSessionPath(userDataPath), "{bad json", "utf8");
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: WORKSPACE_SESSION_VERSION }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: 999, workspaces: [] }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const firstFilePath = path.join(userDataPath, "files", "one.md");
		const secondFilePath = path.join(userDataPath, "files", "two.md");

		await writeWorkspaceSessionEntries(userDataPath, [
			{ ephemeral: false, path: workspacePath },
			{ ephemeral: false, path: workspacePath },
			{
				ephemeral: true,
				sourceFilePaths: [firstFilePath, secondFilePath, firstFilePath],
			},
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [
				{ ephemeral: false, path: workspacePath },
				{
					ephemeral: true,
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
			],
		});
	});

	test("sync write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ ephemeral: false, path: workspacePath },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ ephemeral: false, path: workspacePath }],
		});
	});

	test("filters stale workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const directoryWorkspacePath = path.join(userDataPath, "directory");
		const firstFilePath = path.join(userDataPath, "one.md");
		const secondFilePath = path.join(userDataPath, "two.md");
		const staleWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(directoryWorkspacePath, { recursive: true });
		await mkdir(userDataPath, { recursive: true });
		await writeFile(firstFilePath, "# One\n", "utf8");

		await expect(
			filterExistingWorkspaceEntries([
				{ ephemeral: false, path: directoryWorkspacePath },
				{ ephemeral: false, path: staleWorkspacePath },
				{
					ephemeral: true,
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
			]),
		).resolves.toEqual([
			{ ephemeral: false, path: directoryWorkspacePath },
			{ ephemeral: true, sourceFilePaths: [firstFilePath] },
		]);
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-workspace-session-test", randomUUID());
}

async function readStore(userDataPath: string): Promise<unknown> {
	return JSON.parse(
		await readFile(getWorkspaceSessionPath(userDataPath), "utf8"),
	);
}
