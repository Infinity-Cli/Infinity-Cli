import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const browserInputSchema = z.object({
	operation: z.enum(["search", "navigate", "screenshot", "extract"]),
	query: z.string().optional(),
	url: z.string().optional(),
	selector: z.string().optional(),
	outputPath: z.string().optional(),
});

interface PlaywrightModule {
	chromium: {
		launch(options?: { headless?: boolean }): Promise<BrowserInstance>;
	};
}

interface BrowserInstance {
	newContext(): Promise<BrowserContext>;
	close(): Promise<void>;
}

interface BrowserContext {
	newPage(): Promise<Page>;
	close(): Promise<void>;
}

interface Page {
	goto(url: string, options?: { waitUntil?: string }): Promise<void>;
	title(): Promise<string>;
	screenshot(options: { path: string }): Promise<Buffer | undefined>;
	locator(selector: string): Locator;
	$$(selector: string): Promise<ElementHandle[]>;
	close(): Promise<void>;
}

interface Locator {
	allInnerTexts(): Promise<string[]>;
}

interface ElementHandle {
	textContent(): Promise<string>;
}

export const browserTool: Tool = {
	name: "browser",
	description: "Browser automation: search, navigate, screenshot, extract DOM content",
	inputSchema: browserInputSchema,
	async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
		const safe = browserInputSchema.safeParse(input);
		if (!safe.success) {
			return { success: false, error: `Invalid input: ${safe.error.message}` };
		}
		const { operation, query, url, selector, outputPath } = safe.data;

		let playwright: PlaywrightModule;

		try {
			// Dynamic import - playwright not installed at build time
			// Using a variable to avoid TypeScript module resolution at compile time
			const pwModule = "playwright";
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const pw = await import(pwModule);
			playwright = pw as unknown as PlaywrightModule;
		} catch {
			return {
				success: false,
				error: "Playwright is not installed. Install it to use the browser tool.",
			};
		}

		let browser: BrowserInstance | undefined;
		let ctx: BrowserContext | undefined;
		let page: Page | undefined;

		try {
			browser = await playwright.chromium.launch({ headless: true });
			ctx = await browser.newContext();
			page = await ctx.newPage();

			switch (operation) {
				case "search": {
					if (!query) {
						return { success: false, error: "Query is required for search operation" };
					}
					const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
					await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
					const title = await page.title();
					// Try to extract some result snippets
					let results: string[] = [];
					try {
						const snippets = await page
							.locator("div.g, div[data-async-context], h3")
							.allInnerTexts();
						results = snippets.slice(0, 10);
					} catch {
						// Ignore extraction errors, just return title
					}
					return {
						success: true,
						output: `Search results for: ${query}\nPage title: ${title}\n${results.join("\n")}`,
						data: { title, results },
					};
				}
				case "navigate": {
					if (!url) {
						return { success: false, error: "URL is required for navigate operation" };
					}
					await page.goto(url, { waitUntil: "domcontentloaded" });
					const title = await page.title();
					return { success: true, output: title, data: { title } };
				}
				case "screenshot": {
					const targetUrl = url ?? "about:blank";
					await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

					let screenshotPath: string;
					if (outputPath) {
						const baseDir = context.cwd ?? context.workspace;
						// Resolve outputPath relative to workspace
						const { resolve, relative } = await import("node:path");
						const fullPath = resolve(baseDir, outputPath);
						const workspaceResolved = resolve(context.workspace);
						const relativePath = relative(workspaceResolved, fullPath);
						if (relativePath.startsWith("..")) {
							return { success: false, error: "outputPath must be within workspace" };
						}
						screenshotPath = fullPath;
					} else {
						const { resolve } = await import("node:path");
						const baseDir = context.cwd ?? context.workspace;
						screenshotPath = resolve(baseDir, "screenshot.png");
					}

					await page.screenshot({ path: screenshotPath });
					return {
						success: true,
						output: `Screenshot saved to ${screenshotPath}`,
						data: { path: screenshotPath },
					};
				}
				case "extract": {
					if (!url) {
						return { success: false, error: "URL is required for extract operation" };
					}
					if (!selector) {
						return { success: false, error: "Selector is required for extract operation" };
					}
					await page.goto(url, { waitUntil: "domcontentloaded" });
					const elements = await page.$$(selector);
					const texts = await Promise.all(elements.map((el) => el.textContent()));
					return {
						success: true,
						output: texts.join("\n"),
						data: texts,
					};
				}
				default: {
					return { success: false, error: `Unknown operation: ${operation}` };
				}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			try {
				await page?.close();
			} catch {
				// ignore
			}
			try {
				await ctx?.close();
			} catch {
				// ignore
			}
			try {
				await browser?.close();
			} catch {
				// ignore
			}
		}
	},
};
