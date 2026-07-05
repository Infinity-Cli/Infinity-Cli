/**
 * Repository indexer for building and searching a local code index.
 */

import { createHash } from "node:crypto";
import { constants, access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { OllamaEmbeddingProvider } from "./embeddings.js";
import type {
	BuildIndexResult,
	Chunk,
	IndexedFile,
	IndexerOptions,
	RepositoryIndex,
	RepositoryIndexMeta,
	SearchResult,
} from "./types.js";

const DEFAULT_IGNORE_PATTERNS = [
	"node_modules",
	".git",
	"dist",
	"build",
	".infinity",
	".vscode",
	".idea",
	"coverage",
	"*.log",
];

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MB

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"he",
	"in",
	"is",
	"it",
	"its",
	"of",
	"on",
	"that",
	"the",
	"to",
	"was",
	"were",
	"will",
	"with",
	"this",
	"that",
	"these",
	"those",
	"but",
	"or",
	"not",
	"if",
	"then",
	"else",
	"when",
	"while",
	"do",
	"return",
	"const",
	"let",
	"var",
	"function",
	"class",
	"interface",
	"type",
	"import",
	"export",
	"default",
	"async",
	"await",
	"new",
	"this",
	"super",
	"extends",
	"implements",
	"public",
	"private",
	"protected",
	"static",
	"readonly",
	"abstract",
	"declare",
	"namespace",
	"module",
	"get",
	"set",
	"constructor",
	"void",
	"never",
	"any",
	"unknown",
	"string",
	"number",
	"boolean",
	"object",
	"array",
	"null",
	"undefined",
	"true",
	"false",
	"in",
	"instanceof",
	"typeof",
	"delete",
	"typeof",
	"try",
	"catch",
	"finally",
	"throw",
	"switch",
	"case",
	"break",
	"continue",
	"for",
	"while",
	"do",
	"if",
	"else",
	"return",
	"yield",
]);

function computeRepoId(repoRoot: string): string {
	const absolutePath = resolve(repoRoot);
	const hash = createHash("sha256").update(absolutePath).digest("hex");
	return hash.substring(0, 16);
}

function isBinary(content: Buffer): boolean {
	// Check for null bytes
	if (content.includes(0)) {
		return true;
	}
	// Check ratio of non-printable characters
	let nonPrintable = 0;
	for (let i = 0; i < content.length; i++) {
		const byte = content[i];
		// Printable ASCII: 32-126, plus common whitespace (9, 10, 13)
		if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) {
			nonPrintable++;
		}
	}
	return nonPrintable / content.length > 0.3;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

function shouldIgnore(
	relativePath: string,
	ignorePatterns: string[],
	gitignorePatterns: string[],
): boolean {
	const pathParts = relativePath.split(sep);
	const fileName = pathParts[pathParts.length - 1];

	// Check default and custom ignore patterns
	for (const pattern of ignorePatterns) {
		if (pattern.startsWith("*")) {
			const suffix = pattern.slice(1);
			if (fileName.endsWith(suffix)) {
				return true;
			}
		} else if (pathParts.includes(pattern)) {
			return true;
		}
	}

	// Check .gitignore patterns (simple matching, no negation for now)
	for (const pattern of gitignorePatterns) {
		if (pattern.startsWith("*")) {
			const suffix = pattern.slice(1);
			if (fileName.endsWith(suffix)) {
				return true;
			}
		} else if (relativePath.startsWith(pattern) || relativePath === pattern) {
			return true;
		} else if (pathParts.includes(pattern)) {
			return true;
		}
	}

	return false;
}

function parseGitignore(content: string): string[] {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.filter((line) => !line.startsWith("!"))
		.map((line) => line.replace(/\/$/, "")); // Remove trailing slash for directory patterns
}

function getLanguageFromExtension(filePath: string): string | undefined {
	const ext = extname(filePath).toLowerCase();
	const langMap: Record<string, string> = {
		".ts": "typescript",
		".tsx": "typescript",
		".js": "javascript",
		".jsx": "javascript",
		".py": "python",
		".rs": "rust",
		".go": "go",
		".java": "java",
		".cpp": "cpp",
		".cc": "cpp",
		".cxx": "cpp",
		".c": "c",
		".h": "c",
		".hpp": "cpp",
		".cs": "csharp",
		".rb": "ruby",
		".php": "php",
		".swift": "swift",
		".kt": "kotlin",
		".scala": "scala",
		".md": "markdown",
		".json": "json",
		".yaml": "yaml",
		".yml": "yaml",
		".toml": "toml",
		".xml": "xml",
		".html": "html",
		".css": "css",
		".scss": "scss",
		".sass": "sass",
		".less": "less",
		".sh": "bash",
		".bash": "bash",
		".zsh": "zsh",
		".fish": "fish",
		".sql": "sql",
		".dockerfile": "dockerfile",
		".proto": "protobuf",
		".graphql": "graphql",
		".gql": "graphql",
	};
	return langMap[ext];
}

export class RepositoryIndexer {
	private repoRoot: string;
	private indexBaseDir: string;
	private chunkSize: number;
	private maxFileSize: number;
	private ignorePatterns: string[];
	private repoId: string;
	private indexDir: string;
	private embeddingProvider: OllamaEmbeddingProvider | null = null;

	constructor(options: IndexerOptions) {
		this.repoRoot = resolve(options.repoRoot);
		this.indexBaseDir = options.indexBaseDir
			? resolve(options.indexBaseDir)
			: join(process.env.HOME || process.env.USERPROFILE || "", ".infinity", "index");
		this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
		this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
		this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignorePatterns ?? [])];
		this.repoId = computeRepoId(this.repoRoot);
		this.indexDir = join(this.indexBaseDir, this.repoId);
	}

	async buildIndex(): Promise<BuildIndexResult> {
		// Ensure index directory exists
		await mkdir(this.indexDir, { recursive: true });

		// Load .gitignore patterns
		const gitignorePatterns = await this.loadGitignorePatterns();

		// Scan repository
		const files = await this.scanRepository(gitignorePatterns);

		// Process files into chunks
		const { chunks, indexedFiles } = await this.processFiles(files, gitignorePatterns);

		// Build inverted index
		const invertedIndex = this.buildInvertedIndex(chunks);

		// Create metadata
		const meta: RepositoryIndexMeta = {
			repoPath: this.repoRoot,
			repoId: this.repoId,
			createdAt: Date.now(),
			fileCount: indexedFiles.length,
			chunkCount: chunks.length,
		};

		// Create repository index
		const index: RepositoryIndex = {
			meta,
			files: indexedFiles,
			chunks,
			invertedIndex,
		};

		// Write index files
		await this.writeIndexFiles(index);

		// Generate embeddings if provider is set
		if (this.embeddingProvider) {
			const records = await this.embeddingProvider.embedChunks(chunks);
			await this.embeddingProvider.saveEmbeddings(records);
		}

		return { index, indexDir: this.indexDir };
	}

	private async loadGitignorePatterns(): Promise<string[]> {
		const gitignorePath = join(this.repoRoot, ".gitignore");
		try {
			const content = await readFile(gitignorePath, "utf-8");
			return parseGitignore(content);
		} catch {
			return [];
		}
	}

	private async scanRepository(gitignorePatterns: string[]): Promise<string[]> {
		const files: string[] = [];

		const scanDir = async (dir: string, baseDir: string): Promise<void> => {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dir, entry.name);
				const relativePath = relative(baseDir, fullPath);

				if (shouldIgnore(relativePath, this.ignorePatterns, gitignorePatterns)) {
					continue;
				}

				if (entry.isDirectory()) {
					await scanDir(fullPath, baseDir);
				} else if (entry.isFile()) {
					files.push(fullPath);
				}
			}
		};

		await scanDir(this.repoRoot, this.repoRoot);
		return files;
	}

	private async processFiles(
		filePaths: string[],
		gitignorePatterns: string[],
	): Promise<{ chunks: Chunk[]; indexedFiles: IndexedFile[] }> {
		const chunks: Chunk[] = [];
		const indexedFiles: IndexedFile[] = [];

		for (const filePath of filePaths) {
			try {
				const stats = await stat(filePath);

				// Skip if file is too large
				if (stats.size > this.maxFileSize) {
					continue;
				}

				// Read file content
				const content = await readFile(filePath);
				if (isBinary(content)) {
					continue;
				}

				const text = content.toString("utf-8");
				const relativePath = relative(this.repoRoot, filePath);
				const fileId = createHash("sha256").update(relativePath).digest("hex").substring(0, 16);
				const language = getLanguageFromExtension(filePath);

				// Split into chunks
				const lines = text.split("\n");
				const fileChunks: Chunk[] = [];

				for (let i = 0; i < lines.length; i += this.chunkSize) {
					const chunkLines = lines.slice(i, i + this.chunkSize);
					const chunkContent = chunkLines.join("\n");
					const chunkId = `${fileId}-c${Math.floor(i / this.chunkSize)}`;
					const tokens = tokenize(chunkContent);

					fileChunks.push({
						id: chunkId,
						fileId,
						index: Math.floor(i / this.chunkSize),
						startLine: i + 1,
						endLine: Math.min(i + this.chunkSize, lines.length),
						content: chunkContent,
						tokens,
					});
				}

				if (fileChunks.length > 0) {
					chunks.push(...fileChunks);
					indexedFiles.push({
						id: fileId,
						path: filePath,
						relativePath,
						size: stats.size,
						modifiedAt: stats.mtimeMs,
						chunkCount: fileChunks.length,
						language,
					});
				}
			} catch {}
		}

		return { chunks, indexedFiles };
	}

	private buildInvertedIndex(chunks: Chunk[]): Record<string, string[]> {
		const invertedIndex: Record<string, Set<string>> = {};

		for (const chunk of chunks) {
			for (const token of chunk.tokens) {
				if (!invertedIndex[token]) {
					invertedIndex[token] = new Set();
				}
				invertedIndex[token].add(chunk.id);
			}
		}

		// Convert sets to arrays
		const result: Record<string, string[]> = {};
		for (const [token, chunkIds] of Object.entries(invertedIndex)) {
			result[token] = Array.from(chunkIds);
		}

		return result;
	}

	private async writeIndexFiles(index: RepositoryIndex): Promise<void> {
		await writeFile(join(this.indexDir, "meta.json"), JSON.stringify(index.meta, null, 2));
		await writeFile(join(this.indexDir, "files.json"), JSON.stringify(index.files, null, 2));
		await writeFile(join(this.indexDir, "chunks.json"), JSON.stringify(index.chunks, null, 2));
		await writeFile(
			join(this.indexDir, "inverted.json"),
			JSON.stringify(index.invertedIndex, null, 2),
		);

		// Create embeddings.jsonl placeholder (empty file)
		const embeddingsPath = join(this.indexDir, "embeddings.jsonl");
		try {
			await access(embeddingsPath, constants.F_OK);
		} catch {
			await writeFile(embeddingsPath, "");
		}
	}

	async searchLexical(query: string, limit = 10): Promise<SearchResult[]> {
		// Load index if not already loaded
		const index = await this.loadIndex();
		if (!index) {
			return [];
		}

		const queryTokens = tokenize(query);
		if (queryTokens.length === 0) {
			return [];
		}

		// Score chunks by token overlap
		const chunkScores = new Map<string, number>();

		for (const token of queryTokens) {
			const chunkIds = index.invertedIndex[token] ?? [];
			for (const chunkId of chunkIds) {
				chunkScores.set(chunkId, (chunkScores.get(chunkId) ?? 0) + 1);
			}
		}

		// Sort by score descending
		const scoredChunks = Array.from(chunkScores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit);

		// Build results
		const results: SearchResult[] = [];
		const fileMap = new Map(index.files.map((f) => [f.id, f]));

		for (const [chunkId, score] of scoredChunks) {
			const chunk = index.chunks.find((c) => c.id === chunkId);
			if (chunk) {
				const file = fileMap.get(chunk.fileId);
				if (file) {
					results.push({ chunk, file, score });
				}
			}
		}

		return results;
	}

	async loadIndex(): Promise<RepositoryIndex | null> {
		try {
			const [metaContent, filesContent, chunksContent, invertedContent] = await Promise.all([
				readFile(join(this.indexDir, "meta.json"), "utf-8"),
				readFile(join(this.indexDir, "files.json"), "utf-8"),
				readFile(join(this.indexDir, "chunks.json"), "utf-8"),
				readFile(join(this.indexDir, "inverted.json"), "utf-8"),
			]);

			return {
				meta: JSON.parse(metaContent),
				files: JSON.parse(filesContent),
				chunks: JSON.parse(chunksContent),
				invertedIndex: JSON.parse(invertedContent),
			};
		} catch {
			return null;
		}
	}

	getRepoId(): string {
		return this.repoId;
	}

	getIndexDir(): string {
		return this.indexDir;
	}

	withEmbeddingProvider(provider: OllamaEmbeddingProvider): this {
		this.embeddingProvider = provider;
		return this;
	}

	async searchSemantic(query: string, limit = 10): Promise<SearchResult[]> {
		if (!this.embeddingProvider) {
			return [];
		}

		const index = await this.loadIndex();
		if (!index) {
			return [];
		}

		const results = await this.embeddingProvider.search(query, index.chunks, limit);

		// Convert to SearchResult format
		const fileMap = new Map(index.files.map((f) => [f.id, f]));
		const searchResults: SearchResult[] = [];

		for (const { chunk, score } of results) {
			const file = fileMap.get(chunk.fileId);
			if (file) {
				searchResults.push({ chunk, file, score });
			}
		}

		return searchResults;
	}
}
