import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaEmbeddingProvider, cosineSimilarity } from "./embeddings.js";
import { RepositoryIndexer } from "./repository.js";
import type { Chunk } from "./types.js";

describe("OllamaEmbeddingProvider", () => {
	let tempDir: string;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "infinity-test-"));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("embedText", () => {
		it("returns embedding array from mocked Ollama /api/embeddings response", async () => {
			const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: mockEmbedding }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const result = await provider.embedText("test text");

			expect(result).toEqual(mockEmbedding);
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"http://localhost:11434/api/embeddings",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: "nomic-embed-text",
						prompt: "test text",
					}),
				}),
			);
		});

		it("throws error on non-ok response", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: () => Promise.resolve("Server error"),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await expect(provider.embedText("test")).rejects.toThrow(
				"Ollama embedding request failed: 500 Internal Server Error",
			);
		});

		it("throws error on invalid embedding response", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: null }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await expect(provider.embedText("test")).rejects.toThrow(
				"Ollama response missing or invalid embedding field",
			);
		});

		it("truncates text longer than 8192 chars", async () => {
			const longText = "a".repeat(10000);
			const mockEmbedding = [0.1, 0.2, 0.3];

			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: mockEmbedding }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await provider.embedText(longText);

			const callBody = JSON.parse((globalThis.fetch as Mock).mock.calls[0][1].body);
			expect(callBody.prompt.length).toBe(8192);
		});
	});

	describe("embedChunks", () => {
		it("returns one record per chunk with correct chunkId", async () => {
			const mockEmbeddings = [
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
				[0.7, 0.8, 0.9],
			];
			let callCount = 0;

			globalThis.fetch = vi.fn().mockImplementation(() => {
				const embedding = mockEmbeddings[callCount++];
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ embedding }),
				});
			});

			const chunks: Chunk[] = [
				{
					id: "chunk-1",
					fileId: "file-1",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "content 1",
					tokens: ["content"],
				},
				{
					id: "chunk-2",
					fileId: "file-1",
					index: 1,
					startLine: 11,
					endLine: 20,
					content: "content 2",
					tokens: ["content"],
				},
				{
					id: "chunk-3",
					fileId: "file-2",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "content 3",
					tokens: ["content"],
				},
			];

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const records = await provider.embedChunks(chunks);

			expect(records).toHaveLength(3);
			expect(records[0]).toEqual({ chunkId: "chunk-1", embedding: mockEmbeddings[0] });
			expect(records[1]).toEqual({ chunkId: "chunk-2", embedding: mockEmbeddings[1] });
			expect(records[2]).toEqual({ chunkId: "chunk-3", embedding: mockEmbeddings[2] });
		});

		it("returns empty array for empty chunks", async () => {
			globalThis.fetch = vi.fn();

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const records = await provider.embedChunks([]);

			expect(records).toEqual([]);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});

	describe("saveEmbeddings / loadEmbeddings round-trip", () => {
		it("saves and loads embeddings correctly", async () => {
			const records = [
				{ chunkId: "chunk-1", embedding: [0.1, 0.2, 0.3] },
				{ chunkId: "chunk-2", embedding: [0.4, 0.5, 0.6] },
			];

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await provider.saveEmbeddings(records);
			const loaded = await provider.loadEmbeddings();

			expect(loaded).toHaveLength(2);
			expect(loaded[0]).toEqual(records[0]);
			expect(loaded[1]).toEqual(records[1]);
		});

		it("updates existing chunkId on re-save (de-duplication)", async () => {
			const initialRecords = [
				{ chunkId: "chunk-1", embedding: [0.1, 0.2, 0.3] },
				{ chunkId: "chunk-2", embedding: [0.4, 0.5, 0.6] },
			];

			const updatedRecords = [
				{ chunkId: "chunk-1", embedding: [0.9, 0.8, 0.7] }, // Updated
				{ chunkId: "chunk-3", embedding: [0.7, 0.6, 0.5] }, // New
			];

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await provider.saveEmbeddings(initialRecords);
			await provider.saveEmbeddings(updatedRecords);
			const loaded = await provider.loadEmbeddings();

			expect(loaded).toHaveLength(3);

			// Find chunk-1 - should have updated embedding
			const chunk1 = loaded.find((r) => r.chunkId === "chunk-1");
			expect(chunk1?.embedding).toEqual([0.9, 0.8, 0.7]);

			// chunk-2 should remain unchanged
			const chunk2 = loaded.find((r) => r.chunkId === "chunk-2");
			expect(chunk2?.embedding).toEqual([0.4, 0.5, 0.6]);

			// chunk-3 should be new
			const chunk3 = loaded.find((r) => r.chunkId === "chunk-3");
			expect(chunk3?.embedding).toEqual([0.7, 0.6, 0.5]);
		});

		it("returns empty array when embeddings file does not exist", async () => {
			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const loaded = await provider.loadEmbeddings();
			expect(loaded).toEqual([]);
		});

		it("skips invalid JSON lines", async () => {
			// Write a file with some invalid lines
			const { writeFile } = await import("node:fs/promises");
			const embeddingsPath = join(tempDir, "embeddings.jsonl");
			await writeFile(
				embeddingsPath,
				'{"chunkId":"chunk-1","embedding":[0.1,0.2]}\ninvalid json\n{"chunkId":"chunk-2","embedding":[0.3,0.4]}\n',
			);

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const loaded = await provider.loadEmbeddings();
			expect(loaded).toHaveLength(2);
			expect(loaded[0].chunkId).toBe("chunk-1");
			expect(loaded[1].chunkId).toBe("chunk-2");
		});
	});

	describe("search", () => {
		it("ranks chunks by cosine similarity using deterministic fake embeddings", async () => {
			// query vector [1, 0, 0]
			// chunkA [1, 0, 0] -> cosine = 1.0 (max)
			// chunkB [0, 1, 0] -> cosine = 0.0
			// chunkC [0.707, 0.707, 0] -> cosine = 0.707

			const chunks: Chunk[] = [
				{
					id: "chunk-A",
					fileId: "file-1",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "chunk A",
					tokens: ["chunk"],
				},
				{
					id: "chunk-B",
					fileId: "file-1",
					index: 1,
					startLine: 11,
					endLine: 20,
					content: "chunk B",
					tokens: ["chunk"],
				},
				{
					id: "chunk-C",
					fileId: "file-2",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "chunk C",
					tokens: ["chunk"],
				},
			];

			const savedEmbeddings = [
				{ chunkId: "chunk-A", embedding: [1, 0, 0] },
				{ chunkId: "chunk-B", embedding: [0, 1, 0] },
				{ chunkId: "chunk-C", embedding: [Math.sqrt(0.5), Math.sqrt(0.5), 0] },
			];

			// Mock fetch for query embedding
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [1, 0, 0] }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			// Manually save embeddings first
			await provider.saveEmbeddings(savedEmbeddings);

			const results = await provider.search("test query", chunks, 10);

			expect(results).toHaveLength(3);
			// chunk-A should have highest score (1.0)
			expect(results[0].chunk.id).toBe("chunk-A");
			expect(results[0].score).toBeCloseTo(1.0);
			// chunk-C should be second (0.707)
			expect(results[1].chunk.id).toBe("chunk-C");
			expect(results[1].score).toBeCloseTo(Math.sqrt(0.5), 3);
			// chunk-B should be last (0.0)
			expect(results[2].chunk.id).toBe("chunk-B");
			expect(results[2].score).toBeCloseTo(0.0);
		});

		it("returns empty array when no embeddings exist", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [1, 0, 0] }),
			});

			const chunks: Chunk[] = [
				{
					id: "chunk-1",
					fileId: "file-1",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "test",
					tokens: ["test"],
				},
			];

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			const results = await provider.search("query", chunks, 10);
			expect(results).toEqual([]);
		});

		it("respects limit parameter", async () => {
			const savedEmbeddings = [
				{ chunkId: "chunk-1", embedding: [1, 0, 0] },
				{ chunkId: "chunk-2", embedding: [0.9, 0, 0] },
				{ chunkId: "chunk-3", embedding: [0.8, 0, 0] },
			];

			const chunks: Chunk[] = savedEmbeddings.map((e, i) => ({
				id: e.chunkId,
				fileId: "file-1",
				index: i,
				startLine: 1,
				endLine: 10,
				content: "test",
				tokens: ["test"],
			}));

			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [1, 0, 0] }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await provider.saveEmbeddings(savedEmbeddings);

			const results = await provider.search("query", chunks, 2);
			expect(results).toHaveLength(2);
		});

		it("skips chunks that are not in the provided chunks array", async () => {
			const savedEmbeddings = [
				{ chunkId: "chunk-1", embedding: [1, 0, 0] },
				{ chunkId: "chunk-2", embedding: [0, 1, 0] },
			];

			// Only provide chunk-1
			const chunks: Chunk[] = [
				{
					id: "chunk-1",
					fileId: "file-1",
					index: 0,
					startLine: 1,
					endLine: 10,
					content: "test",
					tokens: ["test"],
				},
			];

			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [1, 0, 0] }),
			});

			const provider = new OllamaEmbeddingProvider({
				baseUrl: "http://localhost:11434",
				model: "nomic-embed-text",
				indexDir: tempDir,
			});

			await provider.saveEmbeddings(savedEmbeddings);

			const results = await provider.search("query", chunks, 10);
			expect(results).toHaveLength(1);
			expect(results[0].chunk.id).toBe("chunk-1");
		});
	});
});

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		const a = [1, 2, 3];
		const b = [1, 2, 3];
		expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
	});

	it("returns 0 for orthogonal vectors", () => {
		const a = [1, 0, 0];
		const b = [0, 1, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
	});

	it("returns -1 for opposite vectors", () => {
		const a = [1, 0, 0];
		const b = [-1, 0, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
	});

	it("returns 0 for zero magnitude vectors", () => {
		const a = [0, 0, 0];
		const b = [1, 2, 3];
		expect(cosineSimilarity(a, b)).toBe(0);
	});

	it("throws on different length vectors", () => {
		const a = [1, 2];
		const b = [1, 2, 3];
		expect(() => cosineSimilarity(a, b)).toThrow("Vectors must have the same length");
	});
});

describe("RepositoryIndexer with OllamaEmbeddingProvider", () => {
	let tempDir: string;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "infinity-index-test-"));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("buildIndex writes embeddings.jsonl containing records for each chunk", async () => {
		const mockEmbeddings = [
			[0.1, 0.2, 0.3],
			[0.4, 0.5, 0.6],
		];
		let callCount = 0;

		globalThis.fetch = vi.fn().mockImplementation(() => {
			const embedding = mockEmbeddings[callCount++];
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ embedding }),
			});
		});

		// Create a simple test file
		const { writeFile, mkdir } = await import("node:fs/promises");
		const testRepoDir = join(tempDir, "test-repo");
		await mkdir(testRepoDir, { recursive: true });
		await writeFile(join(testRepoDir, "test.ts"), 'export function hello() { return "world"; }');

		const indexer = new RepositoryIndexer({
			repoRoot: testRepoDir,
			indexBaseDir: tempDir,
			chunkSize: 50,
		});

		const provider = new OllamaEmbeddingProvider({
			baseUrl: "http://localhost:11434",
			model: "nomic-embed-text",
			indexDir: indexer.getIndexDir(),
		});

		indexer.withEmbeddingProvider(provider);
		await indexer.buildIndex();

		// Check embeddings.jsonl exists and has content
		const { readFile } = await import("node:fs/promises");
		const indexDir = indexer.getIndexDir();
		const embeddingsPath = join(indexDir, "embeddings.jsonl");
		const content = await readFile(embeddingsPath, "utf-8");

		const lines = content
			.trim()
			.split("\n")
			.filter((l) => l.trim());
		expect(lines.length).toBeGreaterThan(0);

		// Each line should be valid JSON with chunkId and embedding
		for (const line of lines) {
			const record = JSON.parse(line);
			expect(record).toHaveProperty("chunkId");
			expect(record).toHaveProperty("embedding");
			expect(Array.isArray(record.embedding)).toBe(true);
		}
	});

	it("searchSemantic returns empty array when no embeddings exist", async () => {
		const indexer = new RepositoryIndexer({
			repoRoot: tempDir,
			indexBaseDir: tempDir,
		});

		// Don't set embedding provider
		const results = await indexer.searchSemantic("test query");
		expect(results).toEqual([]);
	});

	it("searchSemantic returns empty array when no provider is set", async () => {
		// Create a minimal index without embeddings
		const { writeFile, mkdir } = await import("node:fs/promises");
		const testRepoDir = join(tempDir, "test-repo");
		await mkdir(testRepoDir, { recursive: true });
		await writeFile(join(testRepoDir, "test.ts"), 'export function hello() { return "world"; }');

		const indexer = new RepositoryIndexer({
			repoRoot: testRepoDir,
			indexBaseDir: tempDir,
		});

		// Build index without provider
		await indexer.buildIndex();

		// Now try search without provider
		const results = await indexer.searchSemantic("test query");
		expect(results).toEqual([]);
	});
});
