import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserTool } from "./browser.js";
import type { ToolContext } from "./types.js";

// Mock playwright module
const mockPage = {
	goto: vi.fn(),
	title: vi.fn(),
	screenshot: vi.fn(),
	locator: vi.fn(),
	$$: vi.fn(),
	close: vi.fn(),
};

const mockContext = {
	newPage: vi.fn().mockResolvedValue(mockPage),
	close: vi.fn(),
};

const mockBrowser = {
	newContext: vi.fn().mockResolvedValue(mockContext),
	close: vi.fn(),
};

vi.mock("playwright", () => ({
	chromium: {
		launch: vi.fn().mockResolvedValue(mockBrowser),
	},
}));

describe("browserTool", () => {
	let context: ToolContext;

	beforeEach(() => {
		context = { workspace: "/tmp/workspace", cwd: "/tmp/workspace" };
		vi.clearAllMocks();

		// Default mock behaviors
		mockPage.title.mockResolvedValue("Test Page Title");
		mockPage.screenshot.mockResolvedValue(Buffer.from("fake-image-data"));
		mockPage.locator.mockReturnValue({
			allInnerTexts: vi.fn().mockResolvedValue(["Result 1", "Result 2"]),
		});
		mockPage.$$.mockResolvedValue([
			{ textContent: vi.fn().mockResolvedValue("Element 1") },
			{ textContent: vi.fn().mockResolvedValue("Element 2") },
		]);
	});

	it("should return error when query is missing for search", async () => {
		const result = await browserTool.execute({ operation: "search" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Query is required");
	});

	it("should perform search operation", async () => {
		const result = await browserTool.execute({ operation: "search", query: "test query" }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain("test query");
		expect(result.output).toContain("Test Page Title");
		expect(mockPage.goto).toHaveBeenCalledWith("https://www.google.com/search?q=test%20query", {
			waitUntil: "domcontentloaded",
		});
	});

	it("should return error when url is missing for navigate", async () => {
		const result = await browserTool.execute({ operation: "navigate" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("URL is required");
	});

	it("should perform navigate operation", async () => {
		const result = await browserTool.execute(
			{ operation: "navigate", url: "https://example.com" },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.output).toBe("Test Page Title");
		expect(result.data).toEqual({ title: "Test Page Title" });
		expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
			waitUntil: "domcontentloaded",
		});
	});

	it("should perform screenshot operation with default path", async () => {
		const result = await browserTool.execute(
			{ operation: "screenshot", url: "https://example.com" },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Screenshot saved to");
		expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
			waitUntil: "domcontentloaded",
		});
		expect(mockPage.screenshot).toHaveBeenCalled();
	});

	it("should perform screenshot operation with custom outputPath", async () => {
		const result = await browserTool.execute(
			{ operation: "screenshot", url: "https://example.com", outputPath: "custom/screenshot.png" },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.output).toContain("custom");
		expect(result.output).toContain("screenshot.png");
	});

	it("should reject outputPath outside workspace", async () => {
		const result = await browserTool.execute(
			{ operation: "screenshot", url: "https://example.com", outputPath: "../../outside.png" },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("outputPath must be within workspace");
	});

	it("should return error when url is missing for extract", async () => {
		const result = await browserTool.execute({ operation: "extract", selector: "h1" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("URL is required");
	});

	it("should return error when selector is missing for extract", async () => {
		const result = await browserTool.execute(
			{ operation: "extract", url: "https://example.com" },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Selector is required");
	});

	it("should perform extract operation", async () => {
		const result = await browserTool.execute(
			{ operation: "extract", url: "https://example.com", selector: "h1" },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.output).toBe("Element 1\nElement 2");
		expect(result.data).toEqual(["Element 1", "Element 2"]);
		expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
			waitUntil: "domcontentloaded",
		});
		expect(mockPage.$$).toHaveBeenCalledWith("h1");
	});

	it("should return error for unknown operation", async () => {
		const result = await browserTool.execute({ operation: "unknown" as "search" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid input");
	});

	it("should clean up browser resources on error", async () => {
		mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));

		const result = await browserTool.execute(
			{ operation: "navigate", url: "https://example.com" },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Navigation failed");
		expect(mockBrowser.close).toHaveBeenCalled();
	});
});
