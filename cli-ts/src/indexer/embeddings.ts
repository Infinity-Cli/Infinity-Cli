/**
 * Embedding provider using local Ollama embedding endpoint.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chunk } from "./types.js";

export interface EmbeddingRecord {
	chunkId: string;
	embedding: number[];
}

interface OllamaEmbeddingResponse {
	embedding: number[];
}

export class OllamaEmbeddingProvider {
	private baseUrl: string;
	private model: string;
	private indexDir: string;

	constructor(options: { baseUrl?: string; model?: string; indexDir: string }) {
		this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
		this.model = options.model ?? "nomic-embed-text";
		this.indexDir = options.indexDir;
	}

	async embedText(text: string): Promise<number[]> {
		const truncatedText = this.truncateText(text, 8192);

		const response = await fetch(`${this.baseUrl}/api/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.model,
				prompt: truncatedText,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Ollama embedding request failed: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const data = (await response.json()) as OllamaEmbeddingResponse;

		if (!data.embedding || !Array.isArray(data.embedding)) {
			throw new Error("Ollama response missing or invalid embedding field");
		}

		return data.embedding;
	}

	async embedChunks(chunks: Chunk[]): Promise<EmbeddingRecord[]> {
		const records: EmbeddingRecord[] = [];

		for (const chunk of chunks) {
			const embedding = await this.embedText(chunk.content);
			records.push({
				chunkId: chunk.id,
				embedding,
			});
		}

		return records;
	}

	async saveEmbeddings(records: EmbeddingRecord[]): Promise<void> {
		const embeddingsPath = join(this.indexDir, "embeddings.jsonl");

		// Ensure directory exists
		await mkdir(this.indexDir, { recursive: true });

		// Load existing embeddings to de-duplicate
		const existingRecords = await this.loadEmbeddings();
		const existingMap = new Map(existingRecords.map((r) => [r.chunkId, r]));

		// Update with new records (overwrites duplicates)
		for (const record of records) {
			existingMap.set(record.chunkId, record);
		}

		// Write all records back
		const lines = Array.from(existingMap.values()).map((r) => JSON.stringify(r));
		await writeFile(embeddingsPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
	}

	async loadEmbeddings(): Promise<EmbeddingRecord[]> {
		const embeddingsPath = join(this.indexDir, "embeddings.jsonl");

		try {
			const content = await readFile(embeddingsPath, "utf-8");
			const lines = content
				.trim()
				.split("\n")
				.filter((line) => line.trim().length > 0);
			const records: EmbeddingRecord[] = [];

			for (const line of lines) {
				try {
					const record = JSON.parse(line) as EmbeddingRecord;
					if (record.chunkId && Array.isArray(record.embedding)) {
						records.push(record);
					}
				} catch {}
			}

			return records;
		} catch {
			// File doesn't exist or can't be read
			return [];
		}
	}

	async search(
		query: string,
		chunks: Chunk[],
		limit = 10,
	): Promise<{ chunk: Chunk; score: number }[]> {
		const queryEmbedding = await this.embedText(query);
		const savedEmbeddings = await this.loadEmbeddings();

		if (savedEmbeddings.length === 0) {
			return [];
		}

		// Create a map for quick lookup
		const chunkMap = new Map(chunks.map((c) => [c.id, c]));

		// Compute cosine similarity for each saved embedding
		const scoredChunks: { chunk: Chunk; score: number }[] = [];

		for (const record of savedEmbeddings) {
			const chunk = chunkMap.get(record.chunkId);
			if (!chunk) {
				continue;
			}

			const score = cosineSimilarity(queryEmbedding, record.embedding);
			scoredChunks.push({ chunk, score });
		}

		// Sort by score descending and return top matches
		return scoredChunks.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	private truncateText(text: string, maxChars: number): string {
		if (text.length <= maxChars) {
			return text;
		}
		return text.substring(0, maxChars);
	}
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error("Vectors must have the same length");
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

	if (magnitude === 0) {
		return 0;
	}

	return dotProduct / magnitude;
}
