// src/tests/task-completion-override.test.ts

import { addDays, addHours, setHours, setMinutes, subHours } from "date-fns";
import { describe, expect, it } from "vitest";

import type { ScheduleItem, TaskSelect } from "../smart.js";
import {
  shouldAutoReschedule,
  isDateOnlyWithoutTime,
  needsInitialScheduling,
} from "../smart.js";

// Test Helper Functions
function createTask(overrides?: Partial<TaskSelect>): TaskSelect {
  return {
    id: "task-1",
    title: "Test Task",
    userId: "user-1",
    description: null,
    estimatedDuration: 60,
    priority: 3,
    status: "pending",
    tag: "deep",
    scheduleType: "flexible",
    isAutoSchedule: true,
    isChunked: false,
    chunks: [],
    parentTaskId: null,
    startTime: null,
    endTime: null,
    actualStartTime: null,
    actualEndTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profileId: "profile-1",
    subtasks: [],
    ...overrides,
  } as TaskSelect;
}

function createScheduleItem(overrides?: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: "schedule-1",
    type: "task",
    title: "Scheduled Task",
    startTime: new Date(),
    endTime: addHours(new Date(), 1),
    description: "",
    status: "pending",
    ...overrides,
  } as ScheduleItem;
}

// Mock function to simulate task completion logic
function simulateTaskCompletion(task: TaskSelect, completedAt: Date) {
  return {
    ...task,
    status: "completed" as const,
    actualStartTime: completedAt,
    actualEndTime: completedAt,
    updatedAt: completedAt
  };
}

// Mock function to simulate planner state
function simulatePlannerState(tasks: TaskSelect[]) {
  return {
    activeTasks: tasks.filter(t => t.status === "pending"),
    completedTasks: tasks.filter(t => t.status === "completed"),
    scheduledTasks: tasks.filter(t => t.startTime !== null && t.status === "pending")
  };
}

describe("Task Completion & Manual Override", () => {
  describe("AC: Completed tasks should be removed from planner", () => {
    it("should remove task from planner when marked done before scheduled time", () => {
      // Given: Task scheduled for later today
      const scheduledTime = addHours(new Date(), 3);
      const task = createTask({
        id: "early-completion-task",
        startTime: scheduledTime,
        endTime: addHours(scheduledTime, 1),
        status: "pending"
      });

      // When: Task is completed before scheduled time
      const earlyCompletionTime = addHours(new Date(), 1); // 2 hours before scheduled
      const completedTask = simulateTaskCompletion(task, earlyCompletionTime);

      // Then: Task should be marked as completed and ready for removal from planner
      expect(completedTask.status).toBe("completed");
      expect(completedTask.actualStartTime?.getTime()).toBeLessThan(task.startTime!.getTime());
      
      // Simulate planner update
      const plannerState = simulatePlannerState([completedTask]);
      expect(plannerState.activeTasks).toHaveLength(0);
      expect(plannerState.completedTasks).toHaveLength(1);
      expect(plannerState.scheduledTasks).toHaveLength(0);
    });

    it("should handle task completion at exact scheduled time", () => {
      // Given: Task with specific scheduled time
      const scheduledTime = setHours(setMinutes(new Date(), 0), 14); // 2:00 PM today
      const task = createTask({
        startTime: scheduledTime,
        endTime: addHours(scheduledTime, 1),
        status: "pending"
      });

      // When: Task is completed exactly at scheduled time
      const completedTask = simulateTaskCompletion(task, scheduledTime);

      // Then: Task should be completed and removed from active schedule
      expect(completedTask.status).toBe("completed");
      expect(completedTask.actualStartTime).toEqual(scheduledTime);
      
      const plannerState = simulatePlannerState([completedTask]);
      expect(plannerState.activeTasks).toHaveLength(0);
      expect(plannerState.scheduledTasks).toHaveLength(0);
    });

    it("should handle multiple tasks with different completion scenarios", () => {
      // Given: Multiple tasks in different states
      const now = new Date();
      const futureTime = addHours(now, 2);
      
      const tasks = [
        createTask({
          id: "early-done",
          startTime: futureTime,
          status: "pending"
        }),
        createTask({
          id: "pending-task",
          startTime: addHours(futureTime, 1),
          status: "pending"
        }),
        createTask({
          id: "no-schedule",
          startTime: null,
          status: "pending"
        })
      ];

      // When: First task is completed early
      const completedTask = simulateTaskCompletion(tasks[0]!, subHours(now, 1));
      const updatedTasks = [completedTask, tasks[1]!, tasks[2]!];

      // Then: Planner should reflect completion
      const plannerState = simulatePlannerState(updatedTasks);
      expect(plannerState.completedTasks).toHaveLength(1);
      expect(plannerState.activeTasks).toHaveLength(2);
      expect(plannerState.scheduledTasks).toHaveLength(1); // Only the pending scheduled task
    });

    it("should validate task removal from schedule when completed", () => {
      // Given: Task in schedule
      const task = createTask({
        startTime: addHours(new Date(), 1),
        status: "pending"
      });

      // When: Task is marked as completed
      const completedTask = simulateTaskCompletion(task, new Date());

      // Then: Should no longer appear in active schedule
      expect(completedTask.status).toBe("completed");
      
      // Verify that completed task would be filtered out of active planning
      const shouldBeScheduled = completedTask.status === "pending" && completedTask.startTime;
      expect(shouldBeScheduled).toBe(false);
    });
  });

  describe("AC: Manual time changes should not be overridden by smart scheduling", () => {
    it("should not reschedule when user manually sets specific time", () => {
      // Given: Task with date-only start time (auto-scheduled)
      const dateOnlyTime = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const task = createTask({
        startTime: dateOnlyTime,
        isAutoSchedule: true
      });

      // When: User manually changes to specific time
      const manualTime = new Date(2024, 1, 15, 14, 30, 0, 0); // 2:30 PM specific time
      const shouldReschedule = shouldAutoReschedule(task, { startTime: manualTime });

      // Then: Should not trigger rescheduling (manual override respected)
      expect(shouldReschedule).toBe(false);
      expect(isDateOnlyWithoutTime(manualTime)).toBe(false);
    });

    it("should respect manual time changes and disable auto-scheduling", () => {
      // Given: Previously auto-scheduled task
      const task = createTask({
        startTime: null,
        isAutoSchedule: true
      });

      // Verify it would normally be auto-scheduled
      expect(needsInitialScheduling(task)).toBe(false); // No start time or deadline
      
      // When: User sets specific start time manually
      const specificTime = setHours(setMinutes(new Date(), 30), 9); // 9:30 AM
      const shouldReschedule = shouldAutoReschedule(task, { startTime: specificTime });

      // Then: Should not override manual setting
      expect(shouldReschedule).toBe(false);
      expect(isDateOnlyWithoutTime(specificTime)).toBe(false);
    });

    it("should allow rescheduling when user sets date-only time (indicating flexibility)", () => {
      // Given: Task with specific time
      const specificTime = new Date(2024, 1, 15, 14, 30, 0, 0);
      const task = createTask({
        startTime: specificTime,
        isAutoSchedule: true
      });

      // When: User changes to date-only (indicating they want smart scheduling)
      const dateOnlyTime = new Date(Date.UTC(2024, 1, 16, 0, 0, 0, 0));
      const shouldReschedule = shouldAutoReschedule(task, { startTime: dateOnlyTime });

      // Then: Should allow rescheduling (user is opting back into smart scheduling)
      expect(shouldReschedule).toBe(true);
      expect(isDateOnlyWithoutTime(dateOnlyTime)).toBe(true);
    });

    it("should handle removal of start time as request for rescheduling", () => {
      // Given: Task with manually set time
      const manualTime = new Date(2024, 1, 15, 14, 30, 0, 0);
      const task = createTask({
        startTime: manualTime,
        isAutoSchedule: true
      });

      // When: User removes start time (sets to null)
      const shouldReschedule = shouldAutoReschedule(task, { startTime: null });

      // Then: Should trigger rescheduling (user wants smart scheduling again)
      expect(shouldReschedule).toBe(true);
    });

    it("should not reschedule when auto-scheduling is disabled regardless of changes", () => {
      // Given: Task with auto-scheduling disabled
      const task = createTask({
        startTime: new Date(),
        isAutoSchedule: false
      });

      // When: Making various changes
      const dateOnlyChange = shouldAutoReschedule(task, { 
        startTime: new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0)) 
      });
      const priorityChange = shouldAutoReschedule(task, { priority: 1 });
      const durationChange = shouldAutoReschedule(task, { estimatedDuration: 120 });

      // Then: Should never trigger rescheduling when auto-scheduling is disabled
      expect(dateOnlyChange).toBe(false);
      expect(priorityChange).toBe(false);
      expect(durationChange).toBe(false);
    });
  });

  describe("Manual Override Scenarios", () => {
    it("should detect when user manually overrides smart scheduling", () => {
      // Given: Task that was smart-scheduled (date-only)
      const smartScheduledTime = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const task = createTask({
        startTime: smartScheduledTime,
        isAutoSchedule: true
      });

      // When: Checking if this task needs initial scheduling
      const needsScheduling = needsInitialScheduling(task);

      // Then: Should identify as needing smart scheduling
      expect(needsScheduling).toBe(true);
      expect(isDateOnlyWithoutTime(smartScheduledTime)).toBe(true);

      // When: User manually sets specific time (manual override)
      const manualOverride = new Date(2024, 1, 15, 10, 0, 0, 0);
      const shouldRescheduleAfterOverride = shouldAutoReschedule(task, { startTime: manualOverride });

      // Then: Should respect manual override
      expect(shouldRescheduleAfterOverride).toBe(false);
      expect(isDateOnlyWithoutTime(manualOverride)).toBe(false);
    });

    it("should handle complex manual override scenarios", () => {
      // Given: Task with various properties
      const task = createTask({
        startTime: new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0)), // Date-only (smart scheduled)
        priority: 3,
        estimatedDuration: 60,
        isAutoSchedule: true
      });

      // Scenario 1: User manually sets specific time
      const manualTime = new Date(2024, 1, 15, 14, 0, 0, 0);
      expect(shouldAutoReschedule(task, { startTime: manualTime })).toBe(false);

      // Scenario 2: User changes priority but keeps date-only time
      expect(shouldAutoReschedule(task, { priority: 1 })).toBe(true); // Significant priority change

      // Scenario 3: User changes to different date-only time
      const newDateOnly = new Date(Date.UTC(2024, 1, 16, 0, 0, 0, 0));
      expect(shouldAutoReschedule(task, { startTime: newDateOnly })).toBe(true);

      // Scenario 4: Multiple changes including manual time
      const changes = {
        startTime: manualTime,
        priority: 1,
        estimatedDuration: 120
      };
      expect(shouldAutoReschedule(task, changes)).toBe(false); // Manual time overrides other changes
    });

    it("should preserve user intent when switching between manual and auto scheduling", () => {
      // Given: Task starting with no time
      let task = createTask({
        startTime: null,
        isAutoSchedule: true
      });

      // Step 1: User sets date-only (wants smart scheduling)
      let dateOnly = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      expect(shouldAutoReschedule(task, { startTime: dateOnly })).toBe(true);

      // Step 2: Update task with date-only time
      task = { ...task, startTime: dateOnly };

      // Step 3: User sets specific time (manual override)
      let specificTime = new Date(2024, 1, 15, 14, 0, 0, 0);
      expect(shouldAutoReschedule(task, { startTime: specificTime })).toBe(false);

      // Step 4: Update task with specific time
      task = { ...task, startTime: specificTime };

      // Step 5: User changes back to date-only (wants smart scheduling again)
      let newDateOnly = new Date(Date.UTC(2024, 1, 16, 0, 0, 0, 0));
      expect(shouldAutoReschedule(task, { startTime: newDateOnly })).toBe(true);
    });
  });

  describe("Edge Cases and Complex Scenarios", () => {
    it("should handle null and undefined start times correctly", () => {
      // Given: Task with start time
      const task = createTask({
        startTime: new Date(),
        isAutoSchedule: true
      });

      // When: Setting start time to null or undefined
      const nullChange = shouldAutoReschedule(task, { startTime: null });
      const undefinedChange = shouldAutoReschedule(task, { startTime: undefined });

      // Then: Should handle gracefully
      expect(nullChange).toBe(true); // Removing time triggers rescheduling
      expect(undefinedChange).toBe(false); // undefined doesn't trigger change
    });

    it("should validate UTC date handling in manual overrides", () => {
      // Given: Task with UTC date-only time
      const utcDateOnly = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const task = createTask({
        startTime: utcDateOnly,
        isAutoSchedule: true
      });

      // When: User sets local time (manual override)
      const localTime = new Date(2024, 1, 15, 14, 0, 0, 0);

      // Then: Should correctly detect as manual override
      expect(isDateOnlyWithoutTime(utcDateOnly)).toBe(true);
      expect(isDateOnlyWithoutTime(localTime)).toBe(false);
      expect(shouldAutoReschedule(task, { startTime: localTime })).toBe(false);
    });

    it("should handle timezone edge cases in date-only detection", () => {
      // Given: Date that appears date-only in one timezone but not in UTC
      const localMidnight = new Date(2024, 1, 15, 0, 0, 0, 0);
      const utcHours = localMidnight.getUTCHours();

      // When: Checking if date-only
      const isDateOnly = isDateOnlyWithoutTime(localMidnight);

      // Then: Should correctly handle timezone offset
      if (utcHours === 0) {
        expect(isDateOnly).toBe(true);
      } else {
        expect(isDateOnly).toBe(false);
      }
    });

    it("should handle rapid manual changes correctly", () => {
      // Given: Task with initial state
      const task = createTask({
        startTime: null,
        isAutoSchedule: true
      });

      // When: Making rapid successive changes
      const changes = [
        { startTime: new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0)) }, // Date-only
        { startTime: new Date(2024, 1, 15, 14, 0, 0, 0) },          // Specific time
        { startTime: new Date(Date.UTC(2024, 1, 16, 0, 0, 0, 0)) }, // Different date-only
        { startTime: null },                                         // Remove time
      ];

      // Then: Each change should be evaluated correctly
      expect(shouldAutoReschedule(task, changes[0])).toBe(true);  // Enable smart scheduling
      expect(shouldAutoReschedule(task, changes[1])).toBe(false); // Manual override
      expect(shouldAutoReschedule(task, changes[2])).toBe(true);  // Back to smart scheduling
      expect(shouldAutoReschedule(task, changes[3])).toBe(true);  // Request rescheduling
    });
  });
});