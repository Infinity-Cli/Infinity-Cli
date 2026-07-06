Object.defineProperty(process.stdout, "isTTY", {
	value: true,
	configurable: true,
	writable: true,
});

Object.defineProperty(process.stdout, "columns", {
	value: 120,
	configurable: true,
	writable: true,
});

Object.defineProperty(process.stdout, "rows", {
	value: 40,
	configurable: true,
	writable: true,
});

process.env.TERM ||= "xterm-256color";
