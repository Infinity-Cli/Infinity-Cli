import { beforeEach, describe, expect, it } from "vitest";
import { Planner } from "./planner.js";
import type { AgentRole, Plan, TaskStatus } from "./types.js";

describe("Planner", () => {
	let planner: Planner;
	let plan: Plan;

	beforeEach(async () => {
		planner = new Planner();
		plan = await planner.plan("Test goal");
	});

	describe("plan", () => {
		it("returns a Plan with 5 tasks", async () => {
			expect(plan.tasks).toHaveLength(5);
		});

		it("returns tasks with correct roles in order", async () => {
			const roles = plan.tasks.map((t) => t.role);
			expect(roles).toEqual(["planner", "code", "reviewer", "documentation", "security"]);
		});

		it("returns tasks with correct dependencies", async () => {
			const [plannerTask, codeTask, reviewerTask, docTask, securityTask] = plan.tasks;

			expect(plannerTask.dependencies).toEqual([]);
			expect(codeTask.dependencies).toEqual([plannerTask.id]);
			expect(reviewerTask.dependencies).toEqual([codeTask.id]);
			expect(docTask.dependencies).toEqual([reviewerTask.id]);
			expect(securityTask.dependencies).toEqual([reviewerTask.id]);
		});

		it("rootTaskIds contains only the planner task", async () => {
			expect(plan.rootTaskIds).toHaveLength(1);
			expect(plan.rootTaskIds[0]).toBe(plan.tasks[0].id);
			expect(plan.tasks[0].role).toBe("planner");
		});

		it("sets goal and createdAt on plan", async () => {
			expect(plan.goal).toBe("Test goal");
			expect(plan.createdAt).toBeInstanceOf(Date);
		});

		it("applies custom maxRetries option", async () => {
			const customPlanner = new Planner({ maxRetries: 5 });
			const customPlan = await customPlanner.plan("Custom goal");
			for (const task of customPlan.tasks) {
				expect(task.maxRetries).toBe(5);
			}
		});

		it("applies custom defaultAgent option", async () => {
			const customPlanner = new Planner({ defaultAgent: "security" });
			const customPlan = await customPlanner.plan("Custom goal");
			// defaultAgent is stored but not used in fixed plan; just verify it's stored
			expect(customPlanner.getDefaultAgent()).toBe("security");
		});
	});

	describe("validatePlan", () => {
		it("returns true for a valid plan", () => {
			expect(planner.validatePlan(plan)).toBe(true);
		});

		it("returns false when a dependency is missing", () => {
			const invalidPlan: Plan = {
				...plan,
				tasks: [
					{
						...plan.tasks[0],
						id: "missing-dep",
						dependencies: ["non-existent-id"],
					},
				],
			};
			expect(planner.validatePlan(invalidPlan)).toBe(false);
		});

		it("returns false when there is a cycle", () => {
			const taskA = { ...plan.tasks[0], id: "a", dependencies: ["b"] };
			const taskB = { ...plan.tasks[1], id: "b", dependencies: ["a"] };
			const cyclicPlan: Plan = {
				...plan,
				tasks: [taskA, taskB],
				rootTaskIds: [],
			};
			expect(planner.validatePlan(cyclicPlan)).toBe(false);
		});

		it("returns false for self-dependency cycle", () => {
			const taskA = { ...plan.tasks[0], id: "a", dependencies: ["a"] };
			const cyclicPlan: Plan = {
				...plan,
				tasks: [taskA],
				rootTaskIds: [],
			};
			expect(planner.validatePlan(cyclicPlan)).toBe(false);
		});
	});

	describe("getReadyTasks", () => {
		it("returns the planner task initially", () => {
			const ready = planner.getReadyTasks(plan);
			expect(ready).toHaveLength(1);
			expect(ready[0].role).toBe("planner");
			expect(ready[0].status).toBe("pending");
		});

		it("returns empty array when no tasks are pending", () => {
			const completedPlan = plan.tasks.reduce((p, task) => {
				return planner.markTaskStatus(p, task.id, "completed");
			}, plan);
			const ready = planner.getReadyTasks(completedPlan);
			expect(ready).toHaveLength(0);
		});

		it("does not return tasks with unmet dependencies", () => {
			const runningPlan = planner.markTaskStatus(plan, plan.tasks[0].id, "running");
			const ready = planner.getReadyTasks(runningPlan);
			expect(ready).toHaveLength(0);
		});
	});

	describe("markTaskStatus", () => {
		it("updates task status", () => {
			const plannerTaskId = plan.tasks[0].id;
			const updatedPlan = planner.markTaskStatus(plan, plannerTaskId, "completed");
			const updatedTask = updatedPlan.tasks.find((t) => t.id === plannerTaskId);
			expect(updatedTask?.status).toBe("completed");
			expect(updatedTask?.updatedAt).not.toBe(plan.tasks[0].updatedAt);
		});

		it("returns a new plan object (immutable-ish)", () => {
			const updatedPlan = planner.markTaskStatus(plan, plan.tasks[0].id, "completed");
			expect(updatedPlan).not.toBe(plan);
			expect(updatedPlan.tasks).not.toBe(plan.tasks);
		});

		it("throws when taskId is not found", () => {
			expect(() => planner.markTaskStatus(plan, "non-existent", "completed")).toThrow(
				"Task not found: non-existent",
			);
		});

		it("getReadyTasks advances after marking planner task completed", () => {
			const plannerTaskId = plan.tasks[0].id;
			const codeTaskId = plan.tasks[1].id;

			let updatedPlan = planner.markTaskStatus(plan, plannerTaskId, "completed");
			let ready = planner.getReadyTasks(updatedPlan);
			expect(ready).toHaveLength(1);
			expect(ready[0].id).toBe(codeTaskId);

			updatedPlan = planner.markTaskStatus(updatedPlan, codeTaskId, "completed");
			ready = planner.getReadyTasks(updatedPlan);
			expect(ready).toHaveLength(1);
			expect(ready[0].role).toBe("reviewer");
		});

		it("getReadyTasks advances to both documentation and security after reviewer", () => {
			const plannerTaskId = plan.tasks[0].id;
			const codeTaskId = plan.tasks[1].id;
			const reviewerTaskId = plan.tasks[2].id;

			let updatedPlan = planner.markTaskStatus(plan, plannerTaskId, "completed");
			updatedPlan = planner.markTaskStatus(updatedPlan, codeTaskId, "completed");
			updatedPlan = planner.markTaskStatus(updatedPlan, reviewerTaskId, "completed");

			const ready = planner.getReadyTasks(updatedPlan);
			expect(ready).toHaveLength(2);
			const roles = ready.map((t) => t.role).sort();
			expect(roles).toEqual(["documentation", "security"]);
		});
	});
});
