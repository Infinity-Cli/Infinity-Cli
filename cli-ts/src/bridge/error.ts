export class BridgeError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly responseText: string,
	) {
		super(message);
		this.name = "BridgeError";
	}
}
