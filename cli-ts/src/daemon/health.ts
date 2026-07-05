import { EventEmitter } from "node:events";
import { type IncomingMessage, type RequestOptions, get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";

export interface HealthMonitorOptions {
	/** The health endpoint URL. Default: http://127.0.0.1:8000/health */
	healthEndpoint: string;
	/** Interval between health checks in ms (default 5000). */
	intervalMs: number;
	/** Request timeout in ms (default 5000). */
	timeoutMs: number;
	/** Number of consecutive failures before marking unhealthy (default 3). */
	consecutiveFailuresThreshold: number;
}

export interface HealthState {
	healthy: boolean;
	lastCheck: number | null;
	lastSuccess: number | null;
	lastFailure: number | null;
	consecutiveFailures: number;
	totalChecks: number;
	totalSuccesses: number;
	totalFailures: number;
}

const DEFAULTS: Required<HealthMonitorOptions> = {
	healthEndpoint: "http://127.0.0.1:8000/health",
	intervalMs: 5_000,
	timeoutMs: 5_000,
	consecutiveFailuresThreshold: 3,
};

export class HealthMonitor extends EventEmitter {
	private opts: Required<HealthMonitorOptions>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private state: HealthState = {
		healthy: false,
		lastCheck: null,
		lastSuccess: null,
		lastFailure: null,
		consecutiveFailures: 0,
		totalChecks: 0,
		totalSuccesses: 0,
		totalFailures: 0,
	};
	private onRestartCallback: (() => void) | null = null;

	constructor(opts: Partial<HealthMonitorOptions> = {}) {
		super();
		this.opts = { ...DEFAULTS, ...opts };
	}

	/** Start periodic health checks. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.check();
		}, this.opts.intervalMs);
	}

	/** Stop periodic health checks. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Register a callback to invoke when the health monitor decides to restart. */
	onRestart(cb: () => void): void {
		this.onRestartCallback = cb;
	}

	/** Get current health state snapshot. */
	getState(): HealthState {
		return { ...this.state };
	}

	/** Perform a single health check. Returns a promise that resolves to true if healthy. */
	async check(): Promise<boolean> {
		this.state.totalChecks++;

		const url = new URL(this.opts.healthEndpoint);
		const isHttps = url.protocol === "https:";
		const getFn = isHttps ? httpsGet : httpGet;

		const options: RequestOptions = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: "GET",
			timeout: this.opts.timeoutMs,
		};

		return new Promise<boolean>((resolve) => {
			const req = getFn(options, (res: IncomingMessage) => {
				const now = Date.now();
				this.state.lastCheck = now;

				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					this.state.lastSuccess = now;
					this.state.consecutiveFailures = 0;
					this.state.totalSuccesses++;
					this.state.healthy = true;
					this.emit("healthy");
					resolve(true);
				} else {
					this.state.lastFailure = now;
					this.state.consecutiveFailures++;
					this.state.totalFailures++;
					this.state.healthy = false;
					this.emit("unhealthy", res.statusCode);
					this.maybeTriggerRestart();
					resolve(false);
				}
			});

			req.on("error", () => {
				const now = Date.now();
				this.state.lastCheck = now;
				this.state.lastFailure = now;
				this.state.consecutiveFailures++;
				this.state.totalFailures++;
				this.state.healthy = false;
				this.emit("unhealthy", null);
				this.maybeTriggerRestart();
				resolve(false);
			});

			req.on("timeout", () => {
				req.destroy();
				const now = Date.now();
				this.state.lastCheck = now;
				this.state.lastFailure = now;
				this.state.consecutiveFailures++;
				this.state.totalFailures++;
				this.state.healthy = false;
				this.emit("unhealthy", null);
				this.maybeTriggerRestart();
				resolve(false);
			});
		});
	}

	private maybeTriggerRestart(): void {
		if (this.state.consecutiveFailures >= this.opts.consecutiveFailuresThreshold) {
			this.emit("restart");
			if (this.onRestartCallback) {
				this.onRestartCallback();
			}
			// Reset after triggering
			this.state.consecutiveFailures = 0;
		}
	}

	/** Trigger an immediate health check. */
	async checkNow(): Promise<boolean> {
		return this.check();
	}
}
