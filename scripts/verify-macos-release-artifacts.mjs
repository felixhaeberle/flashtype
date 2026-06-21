import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const root = process.cwd();
const releaseDir = path.resolve(process.argv[2] ?? "release");
const appPath = path.join(releaseDir, "mac-arm64/Flashtype.app");
const appInfoPlistPath = path.join(appPath, "Contents/Info.plist");
const packageJson = JSON.parse(
	await readFile(path.join(root, "package.json"), "utf8"),
);
const expectedVersion = packageJson.version;
const expectedArtifacts = [
	`Flashtype-${expectedVersion}-mac-arm64.dmg`,
	`Flashtype-${expectedVersion}-mac-arm64.zip`,
	`Flashtype-${expectedVersion}-mac-arm64.zip.blockmap`,
	"latest-mac.yml",
];

if (process.platform !== "darwin") {
	console.error("verify-macos-release-artifacts can only run on macOS.");
	process.exit(1);
}

try {
	if (!expectedVersion) {
		throw new Error("Missing version in package.json");
	}

	await assertDirectory(releaseDir);
	await assertDirectory(appPath);
	for (const artifact of expectedArtifacts) {
		await assertFile(path.join(releaseDir, artifact));
	}

	await verifyAppIdentity();
	await verifyArtifactMetadata();
	await verifyLatestMacYaml();

	console.log(
		`Verified macOS release artifacts in ${releaseDir} for version ${expectedVersion}.`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

async function verifyAppIdentity() {
	const values = Object.fromEntries(
		await Promise.all(
			[
				"CFBundleDisplayName",
				"CFBundleIdentifier",
				"CFBundleName",
				"CFBundleShortVersionString",
				"CFBundleVersion",
			].map(async (key) => [key, await readPlistValue(appInfoPlistPath, key)]),
		),
	);

	const expectedValues = {
		CFBundleDisplayName: "Flashtype",
		CFBundleIdentifier: "com.flashtype.app",
		CFBundleName: "Flashtype",
		CFBundleShortVersionString: expectedVersion,
		CFBundleVersion: expectedVersion,
	};

	for (const [key, expectedValue] of Object.entries(expectedValues)) {
		if (values[key] !== expectedValue) {
			throw new Error(
				`${key} mismatch in ${appInfoPlistPath}: expected ${expectedValue}, got ${values[key]}`,
			);
		}
	}
}

async function verifyArtifactMetadata() {
	for (const artifact of expectedArtifacts.filter((name) => name !== "latest-mac.yml")) {
		const artifactPath = path.join(releaseDir, artifact);
		const artifactStats = await stat(artifactPath);
		if (artifactStats.size <= 0) {
			throw new Error(`Artifact is empty: ${artifactPath}`);
		}
	}

	const zipPath = path.join(
		releaseDir,
		`Flashtype-${expectedVersion}-mac-arm64.zip`,
	);
	const blockmapPath = `${zipPath}.blockmap`;
	const zipBlockmap = await readBlockmap(blockmapPath);

	verifyBlockmapShape(zipBlockmap, blockmapPath);
	verifyBlockmapShape(
		await readBlockmap(
			path.join(releaseDir, `Flashtype-${expectedVersion}-mac-arm64.dmg.blockmap`),
		),
		path.join(releaseDir, `Flashtype-${expectedVersion}-mac-arm64.dmg.blockmap`),
	);
}

async function verifyLatestMacYaml() {
	const latestMacPath = path.join(releaseDir, "latest-mac.yml");
	const latestMac = await parseSimpleYaml(latestMacPath);
	const expectedZip = `Flashtype-${expectedVersion}-mac-arm64.zip`;
	const expectedDmg = `Flashtype-${expectedVersion}-mac-arm64.dmg`;
	const zipPath = path.join(releaseDir, expectedZip);
	const zipStats = await stat(zipPath);
	const zipSha512 = await sha512Base64(zipPath);
	const dmgPath = path.join(releaseDir, expectedDmg);
	const dmgStats = await stat(dmgPath);
	const dmgSha512 = await sha512Base64(dmgPath);

	if (latestMac.version !== expectedVersion) {
		throw new Error(
			`latest-mac.yml version mismatch: expected ${expectedVersion}, got ${latestMac.version}`,
		);
	}

	if (latestMac.path !== expectedZip) {
		throw new Error(
			`latest-mac.yml path mismatch: expected ${expectedZip}, got ${latestMac.path}`,
		);
	}

	if (latestMac.sha512 !== zipSha512) {
		throw new Error("latest-mac.yml sha512 does not match the generated zip.");
	}

	const fileEntry = latestMac.files.find((file) => file.url === expectedZip);
	if (!fileEntry) {
		throw new Error(`latest-mac.yml files list is missing ${expectedZip}`);
	}

	if (fileEntry.sha512 !== zipSha512) {
		throw new Error(`latest-mac.yml files sha512 mismatch for ${expectedZip}`);
	}

	if (fileEntry.size !== zipStats.size) {
		throw new Error(
			`latest-mac.yml files size mismatch for ${expectedZip}: expected ${zipStats.size}, got ${fileEntry.size}`,
		);
	}

	const dmgEntry = latestMac.files.find((file) => file.url === expectedDmg);
	if (!dmgEntry) {
		throw new Error(`latest-mac.yml files list is missing ${expectedDmg}`);
	}

	if (dmgEntry.sha512 !== dmgSha512) {
		throw new Error(`latest-mac.yml files sha512 mismatch for ${expectedDmg}`);
	}

	if (dmgEntry.size !== dmgStats.size) {
		throw new Error(
			`latest-mac.yml files size mismatch for ${expectedDmg}: expected ${dmgStats.size}, got ${dmgEntry.size}`,
		);
	}
}

async function parseSimpleYaml(filePath) {
	const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
	const result = { files: [] };
	let currentFile = null;

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const fileMatch = line.match(/^  - (url): (.+)$/);
		if (fileMatch) {
			currentFile = { url: fileMatch[2] };
			result.files.push(currentFile);
			continue;
		}

		const nestedMatch = line.match(/^    ([A-Za-z0-9_-]+): (.+)$/);
		if (nestedMatch && currentFile) {
			currentFile[nestedMatch[1]] = parseYamlValue(nestedMatch[2]);
			continue;
		}

		const topLevelMatch = line.match(/^([A-Za-z0-9_-]+): (.+)$/);
		if (topLevelMatch) {
			result[topLevelMatch[1]] = parseYamlValue(topLevelMatch[2]);
		}
	}

	return result;
}

function parseYamlValue(value) {
	if (/^\d+$/.test(value)) {
		return Number(value);
	}
	return value.replace(/^"|"$/g, "");
}

async function readPlistValue(infoPlistPath, key) {
	const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
		"-c",
		`Print :${key}`,
		infoPlistPath,
	]);
	return stdout.trim();
}

async function sha512Base64(filePath) {
	const hash = createHash("sha512");
	hash.update(await readFile(filePath));
	return hash.digest("base64");
}

async function readBlockmap(filePath) {
	return JSON.parse((await gunzipAsync(await readFile(filePath))).toString("utf8"));
}

function verifyBlockmapShape(blockmap, filePath) {
	if (blockmap.version !== "2") {
		throw new Error(`Unsupported blockmap version in ${filePath}: ${blockmap.version}`);
	}
	if (!Array.isArray(blockmap.files) || blockmap.files.length === 0) {
		throw new Error(`Blockmap contains no files: ${filePath}`);
	}
	for (const file of blockmap.files) {
		if (typeof file.name !== "string" || file.name.length === 0) {
			throw new Error(`Blockmap file entry is missing a name: ${filePath}`);
		}
		if (!Array.isArray(file.checksums) || file.checksums.length === 0) {
			throw new Error(`Blockmap file entry has no checksums: ${filePath}`);
		}
		if (!Array.isArray(file.sizes) || file.sizes.length === 0) {
			throw new Error(`Blockmap file entry has no sizes: ${filePath}`);
		}
	}
}

async function assertFile(filePath) {
	const stats = await stat(filePath);
	if (!stats.isFile()) {
		throw new Error(`Expected file: ${filePath}`);
	}
}

async function assertDirectory(directoryPath) {
	const stats = await stat(directoryPath);
	if (!stats.isDirectory()) {
		throw new Error(`Expected directory: ${directoryPath}`);
	}
}
