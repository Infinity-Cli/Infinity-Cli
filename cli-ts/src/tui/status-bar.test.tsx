import { render } from "ink";
import { describe, expect, it } from "vitest";
import { StatusBar } from "./status-bar.js";
import { createFakeStdin, createFakeStdout, stripAnsi, waitForOutput } from "./test-helpers.js";

describe("StatusBar", () => {
	it("shows values from config", async () => {
		const config = {
			provider: "anthropic",
			model: "claude-3-5-sonnet",
			agent: "reviewer",
			tool: "lint",
		};

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(<StatusBar {...config} />, { stdout, stdin });

		const screen = stripAnsi(
			await waitForOutput(stdout, (s) => stripAnsi(s).includes("Provider:")),
		);

		instance.unmount();

		expect(screen).toContain(`Provider: ${config.provider}`);
		expect(screen).toContain(`Model: ${config.model}`);
		expect(screen).toContain(`Agent: ${config.agent}`);
		expect(screen).toContain(`Tool: ${config.tool}`);
	});

	it("shows provider and model", async () => {
		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(
			<StatusBar provider="openai" model="gpt-4o" agent="coder" tool="edit" />,
			{ stdout, stdin },
		);

		const screen = stripAnsi(
			await waitForOutput(stdout, (s) => stripAnsi(s).includes("Provider:")),
		);

		instance.unmount();

		expect(screen).toContain("Provider: openai");
		expect(screen).toContain("Model: gpt-4o");
		expect(screen).toContain("Agent: coder");
		expect(screen).toContain("Tool: edit");
	});
});
