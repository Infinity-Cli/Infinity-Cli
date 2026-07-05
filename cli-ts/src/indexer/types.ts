/**
 * Type definitions for the repository indexer.
 */

export interface IndexedFile {
	id: string;
	path: string;
	relativePath: string;
	size: number;
	modifiedAt: number;
	chunkCount: number;
	language?: string;
}

export interface Chunk {
	id: string;
	fileId: string;
	index: number;
	startLine: number;
	endLine: number;
	content: string;
	tokens: string[];
}

export interface RepositoryIndexMeta {
	repoPath: string;
	repoId: string;
	createdAt: number;
	fileCount: number;
	chunkCount: number;
}

export interface RepositoryIndex {
	meta: RepositoryIndexMeta;
	files: IndexedFile[];
	chunks: Chunk[];
	invertedIndex: Record<string, string[]>;
}

export interface SearchResult {
	chunk: Chunk;
	file: IndexedFile;
	score: number;
}

export interface IndexerOptions {
	repoRoot: string;
	indexBaseDir?: string;
	chunkSize?: number;
	maxFileSize?: number;
	ignorePatterns?: string[];
}

export interface BuildIndexResult {
	index: RepositoryIndex;
	indexDir: string;
}
