import {
	normalize_ast_json,
	parse_markdown,
	serialize_markdown,
} from "@markdown-wc/wasm";

type LineEnding = "None" | "Lf" | "Crlf" | "Mixed";

type MarkdownDocument = {
	blocks: any[];
	source: {
		had_trailing_newline: boolean;
		line_ending: LineEnding;
	};
};

type AstRoot = {
	type: "root";
	children: any[];
};

const DEFAULT_SOURCE_META: MarkdownDocument["source"] = {
	had_trailing_newline: true,
	line_ending: "Lf",
};

export function parseMarkdown(markdown: string): AstRoot {
	const document = parse_markdown(markdown) as MarkdownDocument;
	return {
		type: "root",
		children: Array.isArray(document?.blocks) ? document.blocks : [],
	};
}

export function serializeAst(ast: any): string {
	const children = Array.isArray(ast?.children) ? ast.children : [];
	return serialize_markdown({
		blocks: children,
		source: DEFAULT_SOURCE_META,
	} satisfies MarkdownDocument);
}

export function normalizeAst(ast: any): AstRoot {
	const normalized = normalize_ast_json(ast) as AstRoot;
	return {
		type: "root",
		children: Array.isArray(normalized?.children) ? normalized.children : [],
	};
}
