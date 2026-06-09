import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const markdownPluginV2ArchivePath = resolve(
	process.cwd(),
	"submodule/lix/plugins/markdown/plugin-md-v2.lixplugin",
);

export const markdownPluginV2ArchiveBytes = new Uint8Array(
	readFileSync(markdownPluginV2ArchivePath),
);
