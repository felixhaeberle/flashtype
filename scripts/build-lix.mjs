#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageDir = path.join(rootDir, "submodule/lix/packages/js-sdk");

const cachedArtifacts = [
	path.join(packageDir, "lix_js_sdk.node"),
	path.join(packageDir, "dist/index.js"),
];

if (process.env.CI === "true" && (await allExist(cachedArtifacts))) {
	console.log("Using cached @lix-js/sdk build artifacts.");
	process.exit(0);
}

await run("pnpm", ["-C", packageDir, "run", "build"]);

async function allExist(paths) {
	for (const candidate of paths) {
		try {
			await access(candidate);
		} catch {
			return false;
		}
	}
	return true;
}

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${cmd} exited with code ${code ?? 1}`));
		});
	});
}
