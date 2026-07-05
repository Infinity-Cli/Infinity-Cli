import { stdout } from "node:process";

const RESET = "\x1b[0m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";

const COLORS = [
	"\x1b[36;1m",
	"\x1b[35;1m",
	"\x1b[31;1m",
	"\x1b[33;1m",
	"\x1b[32;1m",
	"\x1b[34;1m",
	"\x1b[37;1m",
];

const BRAILLE_MAP = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
] as const;

/**
 * Render a single frame of the animated Braille infinity logo.
 * Returns an array of lines (raw strings with ANSI color codes).
 */
function renderFrame(time: number): string[] {
	const width = 12;
	const height = 4;
	const lines: string[] = [];

	for (let row = 0; row < height; row++) {
		let line = "";
		for (let col = 0; col < width; col++) {
			const phase = (time + col * 0.3 + row * 0.5) % (Math.PI * 2);
			const colorIndex = Math.floor((phase / (Math.PI * 2)) * COLORS.length) % COLORS.length;
			const color = COLORS[colorIndex];

			// Build a Braille character from the map
			let charValue = 0x2800; // Braille blank
			for (let b = 0; b < 4; b++) {
				const dotActive = (col + row * 4 + b * 2) % 8 < 4;
				if (dotActive) {
					charValue |= BRAILLE_MAP[b][0];
					charValue |= BRAILLE_MAP[b][1];
				}
			}
			const char = String.fromCharCode(charValue);
			line += color + char + RESET;
		}
		lines.push(line);
	}
	return lines;
}

/**
 * Display the animated infinity logo splash for the given duration.
 *
 * - In a TTY: plays a Braille-based animated pattern for `durationMs`,
 *   then clears the screen and restores cursor/cursor visibility.
 * - In non-TTY: prints a static banner line and returns immediately.
 *
 * @param durationMs - How long to play the animation (default 3000ms)
 */
export async function showSplash(durationMs = 3000): Promise<void> {
	if (!stdout.isTTY) {
		console.log("Infinity — Autonomous Coding CLI");
		return;
	}

	const startTime = Date.now();
	const frameInterval = 50; // ~20 fps

	stdout.write(HIDE_CURSOR);

	return new Promise<void>((resolve) => {
		let animFrame: ReturnType<typeof setInterval> | null = setInterval(() => {
			const elapsed = Date.now() - startTime;

			if (elapsed >= durationMs) {
				if (animFrame !== null) {
					clearInterval(animFrame);
					animFrame = null;
				}
				stdout.write(CLEAR_SCREEN);
				stdout.write(CURSOR_HOME);
				stdout.write(SHOW_CURSOR);
				resolve();
				return;
			}

			const t = elapsed * 0.005; // scale for smooth animation
			const frame = renderFrame(t);

			stdout.write(CURSOR_HOME);
			for (const line of frame) {
				stdout.write(`${line}\n`);
			}
		}, frameInterval);
	});
}
