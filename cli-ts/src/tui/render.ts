import { type Instance, render } from "ink";
import { createElement } from "react";
import App from "./shell.js";

export async function renderTUI(): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error(
			"Infinity TUI requires an interactive terminal (both stdin and stdout must be TTY).",
		);
		return;
	}

	let app: Instance | undefined;

	const cleanup = () => {
		if (app) {
			app.unmount();
			app = undefined;
		}
		try {
			process.stdout.write("\x1b[2J\x1b[H");
		} catch {
			// Ignore terminal clear errors during shutdown.
		}
	};

	process.on("SIGINT", cleanup);
	process.on("exit", cleanup);

	app = render(createElement(App, { cwd: process.cwd() }));
	await app.waitUntilExit();
}
