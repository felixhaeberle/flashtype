import type { Lix } from "@lix-js/sdk";
import { MARKDOWN_V2_SCHEMA_DEFINITIONS } from "./markdown-v2-schema";

type MarkdownSchemaDefinition = Record<string, unknown>;

function normalizeSchemaVersion(version: string): string {
	return version;
}

/**
 * Ensures all plugin-md-v2 schema definitions are stored in the current Lix.
 *
 * Ensures `lix_registered_schema` contains the markdown schemas on the target
 * branch. Branch-local definitions are updated in place; inherited global
 * definitions are left untouched and shadowed by a branch row when needed.
 *
 * @param lix - Active Lix instance to seed.
 *
 * @example
 * ```ts
 * await insertMarkdownSchemas({ lix });
 * ```
 */
export async function insertMarkdownSchemas(args: {
	lix: Lix;
	branchId?: string;
}): Promise<void> {
	const { lix } = args;
	const branchId = args.branchId ?? (await lix.activeBranchId());

	for (const schema of MARKDOWN_V2_SCHEMA_DEFINITIONS) {
		const schemaKey = schema["x-lix-key"];
		if (typeof schemaKey !== "string") {
			continue;
		}
		const schemaVersionRaw = schema["x-lix-version"];
		const normalizedSchema =
			typeof schemaVersionRaw === "string"
				? ({
						...schema,
						"x-lix-version": normalizeSchemaVersion(schemaVersionRaw),
					} as MarkdownSchemaDefinition)
				: schema;
		const existing = await lix.execute(
			"SELECT value, lixcol_global FROM lix_registered_schema_by_branch WHERE lixcol_entity_pk = lix_json(?) AND lixcol_branch_id = ?",
			[JSON.stringify([schemaKey]), branchId],
		);
		const globalColumnIndex = existing.columns.indexOf("lixcol_global");
		const hasBranchLocalRow = existing.rows.some((row: any) => {
			const value =
				typeof row?.get === "function"
					? row.get("lixcol_global")
					: Array.isArray(row)
						? row[globalColumnIndex]
						: row?.lixcol_global;
			return value !== true && value !== 1 && value !== "true";
		});
		if (hasBranchLocalRow) {
			await lix.execute(
				"UPDATE lix_registered_schema_by_branch SET value = lix_json(?) WHERE lixcol_entity_pk = lix_json(?) AND lixcol_branch_id = ?",
				[
					JSON.stringify(normalizedSchema),
					JSON.stringify([schemaKey]),
					branchId,
				],
			);
			continue;
		}
		await lix.execute(
			"INSERT INTO lix_registered_schema_by_branch (value, lixcol_branch_id, lixcol_global, lixcol_untracked) VALUES (lix_json(?), ?, ?, false)",
			[JSON.stringify(normalizedSchema), branchId, branchId === "global"],
		);
	}
}
