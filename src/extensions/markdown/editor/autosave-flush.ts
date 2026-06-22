type FlushAutosave = () => Promise<void>;

const flushAutosaves = new Set<FlushAutosave>();

export function registerMarkdownAutosaveFlush(
	flush: FlushAutosave,
): () => void {
	flushAutosaves.add(flush);
	return () => {
		flushAutosaves.delete(flush);
	};
}

export async function flushMarkdownAutosaves(): Promise<void> {
	await Promise.all([...flushAutosaves].map((flush) => flush()));
}
