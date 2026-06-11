import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "packaged-macos.spec.ts",
	fullyParallel: false,
	workers: 1,
	timeout: 180_000,
	expect: {
		timeout: 10_000,
	},
	reporter: "list",
	use: {
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
});
