import { BridgeError } from "./error.js";

export interface RunOptions {
	maxAgents?: number;
	timeout?: number;
	enableSync?: boolean;
	syncBaseUrl?: string;
}

export interface RunResult {
	success: boolean;
	goal: string;
	completed: string[];
	failed: string[];
}

export interface AskOptions {
	provider?: string;
	model?: string;
}

export class BridgeClient {
	constructor(private readonly baseUrl: string) {}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			...options,
			headers: {
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		if (!response.ok) {
			const text = await response.text();
			throw new BridgeError(`Request to ${path} failed`, response.status, text);
		}

		return response.json() as Promise<T>;
	}

	async health(): Promise<{ status: string }> {
		return this.request<{ status: string }>("/health", { method: "GET" });
	}

	async run(goal: string, options: RunOptions = {}): Promise<RunResult> {
		return this.request<RunResult>("/run", {
			method: "POST",
			body: JSON.stringify({ goal, ...options }),
		});
	}

	async ask(prompt: string, options: AskOptions = {}): Promise<string> {
		const result = await this.request<{ response: string }>("/ask", {
			method: "POST",
			body: JSON.stringify({ prompt, ...options }),
		});
		return result.response;
	}
}

export function createBridgeClient(baseUrl: string): BridgeClient {
	return new BridgeClient(baseUrl);
}
