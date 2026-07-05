import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingUI } from "./streaming.js";

describe("StreamingUI", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	describe("markdown mode", () => {
		it("renders a full execution report", () => {
			const ui = new StreamingUI("markdown");

			ui.start("Initializing");
			ui.log("info", "Plan generated");
			ui.progress(2, 1, 0, 5);
			ui.update("Executing tasks");
			ui.renderSummary({ goal: "say hello", completed: 2, failed: 1, skipped: 0, total: 5 });

			const output = ui.getOutput();
			expect(output).toContain("# Execution Report");
			expect(output).toContain("## Goal");
			expect(output).toContain("say hello");
			expect(output).toContain("## Summary");
			expect(output).toContain("| Completed | 2 |");
			expect(output).toContain("| Failed | 1 |");
			expect(output).toContain("| Skipped | 0 |");
			expect(output).toContain("| Total | 5 |");
		});

		it("records status and log updates", () => {
			const ui = new StreamingUI("markdown");
			ui.start("Start");
			ui.update("Update");
			ui.succeed("Done");
			ui.fail("Oops");
			ui.log("warn", "careful");
			expect(ui.getOutput()).toContain("**Status:** Start");
			expect(ui.getOutput()).toContain("**Update:** Update");
			expect(ui.getOutput()).toContain("**Success:** Done");
			expect(ui.getOutput()).toContain("**Failed:** Oops");
			expect(ui.getOutput()).toContain("**WARN:** careful");
		});
	});

	describe("json mode", () => {
		it("accumulates events and returns JSON", () => {
			const ui = new StreamingUI("json");
			ui.start("Initializing");
			ui.log("info", "Plan generated");
			ui.progress(1, 0, 0, 3);
			ui.renderSummary({ goal: "test", completed: 1, failed: 0, skipped: 0, total: 3 });

			const output = ui.getOutput();
			const events = JSON.parse(output) as Array<{ type: string }>;
			expect(events).toHaveLength(4);
			expect(events[0].type).toBe("status");
			expect(events[1].type).toBe("log");
			expect(events[2].type).toBe("progress");
			expect(events[3].type).toBe("summary");
		});
	});

	describe("pretty mode", () => {
		it("does not throw when started and stopped", async () => {
			const ui = new StreamingUI("pretty");
			await expect(ui.start("Initializing")).resolves.not.toThrow();
			await expect(ui.update("Working")).resolves.not.toThrow();
			await expect(ui.succeed("Done")).resolves.not.toThrow();
		});

		it("logs messages with a prefix", () => {
			const ui = new StreamingUI("pretty");
			ui.log("info", "hello");
			ui.log("error", "bad");
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("hello"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("bad"));
		});
	});
});
