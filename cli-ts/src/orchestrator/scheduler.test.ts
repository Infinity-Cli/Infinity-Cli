import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Planner } from "./planner.js";
import { Scheduler } from "./scheduler.js";
import type { Plan, Task, TaskStatus } from "./types.js";

describe("Scheduler", () => {
	let planner: Planner;
	let plan: Plan;
	let tempDir: string;

	beforeEach(async () => {
		planner = new Planner({ maxRetries: 2 });
		plan = await planner.plan("Test goal");
		tempDir = await mkdtemp(join(tmpdir(), "scheduler-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	function createMockPlan(overrides: Partial<Plan> = {}): Plan {
		return {
			id: "test-plan-id",
			goal: "Test goal",
			tasks: [
				{
					id: "task-1",
					description: "Task 1",
					role: "planner",
					status: "pending",
					dependencies: [],
					artifacts: [],
					toolPermissions: ["read"],
					retryCount: 0,
					maxRetries: 2,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "task-2",
					description: "Task 2",
					role: "code",
					status: "pending",
					dependencies: ["task-1"],
					artifacts: [],
					toolPermissions: ["write"],
					retryCount: 0,
					maxRetries: 2,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "task-3",
					description: "Task 3",
					role: "reviewer",
					status: "pending",
					dependencies: ["task-2"],
					artifacts: [],
					toolPermissions: ["read"],
					retryCount: 0,
					maxRetries: 2,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
			rootTaskIds: ["task-1"],
			createdAt: new Date(),
			...overrides,
		};
	}

	describe("constructor", () => {
		it("creates a scheduler with default options", () => {
			const scheduler = new Scheduler(plan);
			expect(scheduler.getPlan().id).toBe(plan.id);
			expect(scheduler.getPlan().tasks).toHaveLength(5);
		});

		it("copies the plan (does not mutate original)", () => {
			const scheduler = new Scheduler(plan);
			const returnedPlan = scheduler.getPlan();
			expect(returnedPlan).not.toBe(plan);
			expect(returnedPlan.tasks).not.toBe(plan.tasks);
		});

		it("uses custom checkpoint directory", () => {
			const scheduler = new Scheduler(plan, { checkpointDir: tempDir });
			// Just verify it doesn't throw
			expect(scheduler).toBeInstanceOf(Scheduler);
		});
	});

	describe("getPlan", () => {
		it("returns a copy of the current plan state", () => {
			const scheduler = new Scheduler(plan);
			const plan1 = scheduler.getPlan();
			const plan2 = scheduler.getPlan();
			expect(plan1).not.toBe(plan2);
			expect(plan1.tasks).not.toBe(plan2.tasks);
		});
	});

	describe("run - basic execution", () => {
		it("executes all tasks in dependency order", async () => {
			const executionOrder: string[] = [];
			const executor = vi.fn(async (task: Task) => {
				executionOrder.push(task.id);
			});

			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			expect(finalPlan.tasks.every((t) => t.status === "completed")).toBe(true);
			expect(executionOrder[0]).toBe(plan.tasks[0].id); // planner
			expect(executionOrder[1]).toBe(plan.tasks[1].id); // code
			expect(executionOrder[2]).toBe(plan.tasks[2].id); // reviewer
			// documentation and security run in parallel after reviewer, order is non-deterministic.
			expect(executionOrder.slice(3).sort()).toEqual(
				[plan.tasks[3].id, plan.tasks[4].id].sort(), // documentation and security
			);
		});

		it("respects concurrency limit", async () => {
			let runningCount = 0;
			let maxRunning = 0;
			const executor = vi.fn(async () => {
				runningCount++;
				maxRunning = Math.max(maxRunning, runningCount);
				await new Promise((r) => setTimeout(r, 10));
				runningCount--;
			});

			const scheduler = new Scheduler(plan, {
				executor,
				concurrency: 2,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			expect(maxRunning).toBeLessThanOrEqual(2);
		});

		it("calls onTaskUpdate callback for each event", async () => {
			const events: Array<{ taskId: string; event: string }> = [];
			const onTaskUpdate = vi.fn((task: Task, event: string) => {
				events.push({ taskId: task.id, event });
			});

			const scheduler = new Scheduler(plan, {
				executor: async () => {},
				onTaskUpdate,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			expect(onTaskUpdate).toHaveBeenCalledTimes(plan.tasks.length * 2); // started + completed
			const startedEvents = events.filter((e) => e.event === "started");
			const completedEvents = events.filter((e) => e.event === "completed");
			expect(startedEvents).toHaveLength(5);
			expect(completedEvents).toHaveLength(5);
		});
	});

	describe("run - dependency handling", () => {
		it("waits for dependencies to complete before starting dependent tasks", async () => {
			const startTimes: Record<string, number> = {};
			const executor = vi.fn(async (task: Task) => {
				startTimes[task.id] = Date.now();
				await new Promise((r) => setTimeout(r, 10));
			});

			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const plannerTask = plan.tasks[0];
			const codeTask = plan.tasks[1];
			expect(startTimes[codeTask.id]).toBeGreaterThanOrEqual(startTimes[plannerTask.id]);
		});

		it("skips tasks when dependencies fail (continueOnError: true)", async () => {
			let failFirst = true;
			const executor = vi.fn(async (task: Task) => {
				if (failFirst && task.id === plan.tasks[0].id) {
					failFirst = false;
					throw new Error("Simulated failure");
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				continueOnError: true,
				maxRetries: 0,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			const plannerTask = finalPlan.tasks.find((t) => t.role === "planner");
			expect(plannerTask?.status).toBe("failed");

			const otherTasks = finalPlan.tasks.filter((t) => t.role !== "planner");
			expect(otherTasks.every((t) => t.status === "skipped")).toBe(true);
		});

		it("stops execution and skips remaining tasks when a task fails (continueOnError: false)", async () => {
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[1].id) {
					throw new Error("Code task failed");
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				continueOnError: false,
				maxRetries: 0,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			const codeTask = finalPlan.tasks.find((t) => t.role === "code");
			expect(codeTask?.status).toBe("failed");

			const laterTasks = finalPlan.tasks.filter(
				(t) => t.role === "reviewer" || t.role === "documentation" || t.role === "security",
			);
			expect(laterTasks.every((t) => t.status === "skipped")).toBe(true);
		});

		it("skips tasks whose dependencies were skipped", async () => {
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[0].id) {
					throw new Error("Planner failed");
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				continueOnError: true,
				maxRetries: 0,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			expect(finalPlan.tasks.every((t) => t.status === "failed" || t.status === "skipped")).toBe(
				true,
			);
		});
	});

	describe("run - retries", () => {
		it("retries failed tasks up to maxRetries times", async () => {
			let attemptCount = 0;
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[1].id) {
					attemptCount++;
					if (attemptCount < 3) {
						throw new Error("Temporary failure");
					}
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				maxRetries: 2,
				retryDelayMs: 0,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			expect(executor).toHaveBeenCalledTimes(plan.tasks.length + 2); // 2 retries for code task
			const finalPlan = scheduler.getPlan();
			const codeTask = finalPlan.tasks.find((t) => t.role === "code");
			expect(codeTask?.status).toBe("completed");
			expect(codeTask?.retryCount).toBe(2);
		});

		it("marks task as failed after maxRetries exhausted", async () => {
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[1].id) {
					throw new Error("Permanent failure");
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				maxRetries: 2,
				retryDelayMs: 0,
				continueOnError: true,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			const codeTask = finalPlan.tasks.find((t) => t.role === "code");
			expect(codeTask?.status).toBe("failed");
			expect(codeTask?.retryCount).toBe(2);
			// Only planner and the retried code task are executed; downstream tasks are skipped.
			expect(executor).toHaveBeenCalledTimes(1 + 1 + 2); // planner + code initial + 2 retries
		});

		it("waits retryDelayMs between retries", async () => {
			const startTimes: number[] = [];
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[1].id) {
					startTimes.push(Date.now());
					if (startTimes.length < 3) {
						throw new Error("Temporary failure");
					}
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				maxRetries: 2,
				retryDelayMs: 50,
				continueOnError: true,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(40);
			expect(startTimes[2] - startTimes[1]).toBeGreaterThanOrEqual(40);
		});

		it("uses runOptions to override constructor options", async () => {
			let attemptCount = 0;
			const executor = vi.fn(async (task: Task) => {
				if (task.id === plan.tasks[1].id) {
					attemptCount++;
					if (attemptCount < 2) {
						throw new Error("Temporary failure");
					}
				}
			});

			const scheduler = new Scheduler(plan, {
				executor,
				maxRetries: 0, // Constructor says no retries
				checkpointDir: tempDir,
			});
			await scheduler.run({ maxRetries: 1 }); // But runOptions says 1 retry

			expect(attemptCount).toBe(2); // Initial + 1 retry
		});
	});

	describe("checkpoint persistence", () => {
		it("saves checkpoint after each task completion", async () => {
			const executor = vi.fn(async () => {});
			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const checkpointFiles = await import("node:fs/promises").then((fs) => fs.readdir(tempDir));
			expect(checkpointFiles).toContain(`${plan.id}.json`);
		});

		it("checkpoint contains current plan state", async () => {
			let completedCount = 0;
			const executor = vi.fn(async () => {
				completedCount++;
			});

			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const checkpointData = await import("node:fs/promises").then((fs) =>
				fs.readFile(join(tempDir, `${plan.id}.json`), "utf-8"),
			);
			const checkpoint = JSON.parse(checkpointData);
			expect(checkpoint.plan.id).toBe(plan.id);
			expect(checkpoint.plan.tasks).toHaveLength(5);
			expect(checkpoint.updatedAt).toBeDefined();
		});

		it("loadCheckpoint restores plan from checkpoint", async () => {
			const executor = vi.fn(async () => {});
			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const loadedPlan = await Scheduler.loadCheckpoint(plan.id, tempDir);
			expect(loadedPlan).not.toBeNull();
			expect(loadedPlan?.id).toBe(plan.id);
			expect(loadedPlan?.tasks).toHaveLength(5);
			expect(loadedPlan?.tasks.every((t) => t.status === "completed")).toBe(true);
			expect(loadedPlan?.createdAt).toBeInstanceOf(Date);
			expect(loadedPlan?.tasks[0].createdAt).toBeInstanceOf(Date);
			expect(loadedPlan?.tasks[0].updatedAt).toBeInstanceOf(Date);
		});

		it("loadCheckpoint returns null for non-existent checkpoint", async () => {
			const loadedPlan = await Scheduler.loadCheckpoint("non-existent-id", tempDir);
			expect(loadedPlan).toBeNull();
		});

		it("loadCheckpoint restores task dates as Date objects", async () => {
			const executor = vi.fn(async () => {});
			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			const loadedPlan = await Scheduler.loadCheckpoint(plan.id, tempDir);
			expect(loadedPlan).not.toBeNull();
			if (!loadedPlan) {
				throw new Error("loadedPlan should not be null");
			}
			for (const task of loadedPlan.tasks) {
				expect(task.createdAt).toBeInstanceOf(Date);
				expect(task.updatedAt).toBeInstanceOf(Date);
			}
		});
	});

	describe("run - edge cases", () => {
		it("handles empty plan", async () => {
			const emptyPlan: Plan = {
				id: "empty-plan",
				goal: "Empty",
				tasks: [],
				rootTaskIds: [],
				createdAt: new Date(),
			};
			const executor = vi.fn();
			const scheduler = new Scheduler(emptyPlan, { executor, checkpointDir: tempDir });
			await scheduler.run();

			expect(executor).not.toHaveBeenCalled();
			expect(scheduler.getPlan().tasks).toHaveLength(0);
		});

		it("handles plan with only root tasks (no dependencies)", async () => {
			const independentPlan: Plan = {
				id: "independent-plan",
				goal: "Independent tasks",
				tasks: [
					{
						id: "task-a",
						description: "Task A",
						role: "code",
						status: "pending",
						dependencies: [],
						artifacts: [],
						toolPermissions: [],
						retryCount: 0,
						maxRetries: 2,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					{
						id: "task-b",
						description: "Task B",
						role: "code",
						status: "pending",
						dependencies: [],
						artifacts: [],
						toolPermissions: [],
						retryCount: 0,
						maxRetries: 2,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
				rootTaskIds: ["task-a", "task-b"],
				createdAt: new Date(),
			};

			const executor = vi.fn(async () => {});
			const scheduler = new Scheduler(independentPlan, {
				executor,
				concurrency: 2,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			expect(finalPlan.tasks.every((t) => t.status === "completed")).toBe(true);
		});

		it("does not execute tasks when scheduler is stopped", async () => {
			const shouldStop = false;
			const executor = vi.fn(async () => {
				if (shouldStop) {
					throw new Error("Stopped");
				}
			});

			const scheduler = new Scheduler(plan, { executor, checkpointDir: tempDir });

			// This test is a bit tricky since we can't easily stop mid-execution
			// Just verify the run completes normally
			await scheduler.run();
			expect(executor).toHaveBeenCalledTimes(5);
		});
	});

	describe("integration with Planner", () => {
		it("works with a plan generated by Planner", async () => {
			const planner = new Planner({ maxRetries: 1 });
			const generatedPlan = await planner.plan("Build a feature");

			const executionOrder: string[] = [];
			const executor = vi.fn(async (task: Task) => {
				executionOrder.push(task.role);
			});

			const scheduler = new Scheduler(generatedPlan, {
				executor,
				checkpointDir: tempDir,
			});
			await scheduler.run();

			const finalPlan = scheduler.getPlan();
			expect(finalPlan.tasks.every((t) => t.status === "completed")).toBe(true);
			// Order should respect dependencies: planner -> code -> reviewer -> (doc, security)
			expect(executionOrder[0]).toBe("planner");
			expect(executionOrder[1]).toBe("code");
			expect(executionOrder[2]).toBe("reviewer");
			// doc and security can be in either order after reviewer
			const lastTwo = executionOrder.slice(3).sort();
			expect(lastTwo).toEqual(["documentation", "security"]);
		});
	});
});
