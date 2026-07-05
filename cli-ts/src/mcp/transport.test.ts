import { describe, expect, it, vi } from "vitest";
import { InMemoryTransport, StdioTransport } from "./transport.js";

describe("InMemoryTransport", () => {
	it("delivers messages between paired transports", async () => {
		const [a, b] = InMemoryTransport.createPair();
		const handler = vi.fn();
		a.onMessage(handler);
		a.connect();
		b.connect();

		b.send({ hello: "world" });

		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ hello: "world" }));
	});

	it("survives close without errors", () => {
		const [a] = InMemoryTransport.createPair();
		expect(() => a.close()).not.toThrow();
	});
});

describe("StdioTransport", () => {
	it("stores options and exposes a close method", () => {
		const transport = new StdioTransport({
			command: "node",
			args: ["-e", 'console.log("ok")'],
		});
		expect(() => transport.onMessage(() => {})).not.toThrow();
		expect(() => transport.send({})).not.toThrow();
		expect(() => transport.close()).not.toThrow();
	});
});
