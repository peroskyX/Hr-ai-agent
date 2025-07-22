// src/tests/core-scheduling.test.ts

import { addDays, addHours, setHours, setMinutes } from "date-fns";
import { describe, expect, it, beforeEach } from "vitest";

import type { EnergySelect, EnergySlot, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";
import {
  shouldAutoReschedule,
  needsInitialScheduling,
  determineTargetDate,
  determineSchedulingStrategy,
  isDateOnlyWithoutTime,
  getAvailableSlotsForContext,
  calculateSchedulingWindow,
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

function createEnergySlot(hour: number, energyLevel: number, baseDate?: Date): EnergySelect {
  const now = baseDate || new Date();
  const startTime = setHours(setMinutes(now, 0), hour);
  const endTime = addHours(startTime, 1);

  return {
    id: `energy-${hour}`,
    userId: "user-1",
    date: startTime.toISOString(),
    _id: "energy-1",
    _creationTime: 0,
    hour: hour,
    energyLevel,
    energyStage: energyLevel > 0.7 ? "morning_peak" : "midday_dip",
    mood: "focused",
    hasManualCheckIn: false,
    createdAt: now,
    updatedAt: now,
  } as unknown as EnergySelect;
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

describe("Core Scheduling - Basic Scheduling Logic", () => {
  describe("AC: Task with start date should be smart-scheduled to optimal time", () => {
    it("should enable auto-scheduling when task has date-only start time", () => {
      // Given: Creating a new task with a start date (date-only, no specific time)
      const startDate = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0)); // Date only
      const task = createTask({ 
        startTime: startDate,
        isAutoSchedule: true 
      });

      // When: Checking if task needs initial scheduling
      const needsScheduling = needsInitialScheduling(task);
      const shouldReschedule = shouldAutoReschedule(task);

      // Then: Task should be eligible for smart scheduling
      expect(needsScheduling).toBe(true);
      expect(shouldReschedule).toBe(true);
      expect(isDateOnlyWithoutTime(startDate)).toBe(true);
    });

    it("should determine correct target date from start date", () => {
      // Given: Task with date-only start time
      const startDate = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const task = createTask({ startTime: startDate });

      // When: Determining target date
      const targetDate = determineTargetDate(task);

      // Then: Should return the start date as target
      expect(targetDate).toEqual(startDate);
    });

    it("should use 'today' strategy when target date is today", () => {
      // Given: Task with today's date as start time
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const task = createTask({ startTime: today });
      const targetDate = determineTargetDate(task);

      // When: Determining scheduling strategy
      const strategy = determineSchedulingStrategy(targetDate);

      // Then: Should use 'today' strategy
      expect(strategy.isToday).toBe(true);
      expect(strategy.strategy).toBe("today");
    });

    it("should use 'future' strategy when target date is in future", () => {
      // Given: Task with future date as start time
      const futureDate = addDays(new Date(), 3);
      futureDate.setUTCHours(0, 0, 0, 0);
      const task = createTask({ startTime: futureDate });
      const targetDate = determineTargetDate(task);

      // When: Determining scheduling strategy
      const strategy = determineSchedulingStrategy(targetDate);

      // Then: Should use 'future' strategy
      expect(strategy.isToday).toBe(false);
      expect(strategy.strategy).toBe("future");
    });
  });

  describe("AC: Task with start date and deadline should be scheduled within range", () => {
    it("should consider deadline when determining scheduling window", () => {
      // Given: Task with start date and deadline 3 days in future
      const startDate = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const deadline = addDays(new Date(), 3);
      const task = createTask({ 
        startTime: startDate,
        endTime: deadline 
      });

      // When: Calculating scheduling window
      const window = calculateSchedulingWindow(task);

      // Then: Window should be limited by deadline
      expect(window).toBeLessThanOrEqual(7); // Default max is 7 days
      expect(window).toBeGreaterThan(0);
    });

    it("should prioritize start date over deadline for target date", () => {
      // Given: Task with both start date and deadline
      const startDate = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      const deadline = addDays(new Date(), 5);
      const task = createTask({ 
        startTime: startDate,
        endTime: deadline 
      });

      // When: Determining target date
      const targetDate = determineTargetDate(task);

      // Then: Should return start date, not deadline
      expect(targetDate).toEqual(startDate);
    });
  });

  describe("AC: Task with both start date and time should disable smart scheduling", () => {
    it("should not auto-schedule when task has specific start time", () => {
      // Given: Task with specific date and time (not date-only)
      const specificTime = new Date(2024, 1, 15, 14, 30, 0, 0); // 2:30 PM
      const task = createTask({ 
        startTime: specificTime,
        isAutoSchedule: true 
      });

      // When: Checking if task needs scheduling
      const needsScheduling = needsInitialScheduling(task);

      // Then: Should not need auto-scheduling
      expect(needsScheduling).toBe(false);
      expect(isDateOnlyWithoutTime(specificTime)).toBe(false);
    });

    it("should disable smart scheduling when setting specific time", () => {
      // Given: Task that was previously auto-scheduled
      const task = createTask({ 
        startTime: null,
        isAutoSchedule: true 
      });
      
      // When: Setting specific start time
      const specificTime = new Date(2024, 1, 15, 14, 30, 0, 0);
      const shouldReschedule = shouldAutoReschedule(task, { startTime: specificTime });

      // Then: Should not trigger rescheduling (smart scheduling disabled)
      expect(shouldReschedule).toBe(false);
    });
  });

  describe("AC: Task without start date or deadline should not be smart-scheduled", () => {
    it("should not auto-schedule task without start date or deadline", () => {
      // Given: Task with no start time and no end time
      const task = createTask({ 
        startTime: null,
        endTime: null,
        isAutoSchedule: true 
      });

      // When: Checking if task needs scheduling
      const needsScheduling = needsInitialScheduling(task);
      const shouldReschedule = shouldAutoReschedule(task);

      // Then: Should not need auto-scheduling
      expect(needsScheduling).toBe(false);
      expect(shouldReschedule).toBe(false);
    });

    it("should return null target date for task without dates", () => {
      // Given: Task with no dates
      const task = createTask({ 
        startTime: null,
        endTime: null 
      });

      // When: Determining target date
      const targetDate = determineTargetDate(task);

      // Then: Should return null
      expect(targetDate).toBeNull();
    });

    it("should use future strategy when no target date available", () => {
      // Given: No target date
      const targetDate = null;

      // When: Determining scheduling strategy
      const strategy = determineSchedulingStrategy(targetDate);

      // Then: Should use future strategy
      expect(strategy.isToday).toBe(false);
      expect(strategy.strategy).toBe("future");
    });
  });

  describe("AC: Task with start date within next 6 days should be scheduled on planner", () => {
    it("should include task in scheduling when start date is within 6 days", () => {
      // Given: Task with start date 3 days from now
      const startDate = addDays(new Date(), 3);
      startDate.setUTCHours(0, 0, 0, 0);
      const task = createTask({ startTime: startDate });

      // When: Calculating scheduling window
      const window = calculateSchedulingWindow(task);
      const targetDate = determineTargetDate(task);

      // Then: Should be within scheduling window
      expect(window).toBeGreaterThan(0);
      expect(targetDate).toEqual(startDate);
      
      // Verify the date is within 6 days
      const daysDifference = Math.ceil((startDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDifference).toBeLessThanOrEqual(6);
    });

    it("should handle edge case of exactly 6 days in future", () => {
      // Given: Task with start date exactly 6 days from now
      const startDate = addDays(new Date(), 6);
      startDate.setUTCHours(0, 0, 0, 0);
      const task = createTask({ startTime: startDate });

      // When: Determining if should be scheduled
      const targetDate = determineTargetDate(task);
      const strategy = determineSchedulingStrategy(targetDate);

      // Then: Should still be eligible for scheduling
      expect(targetDate).toEqual(startDate);
      expect(strategy.strategy).toBe("future");
    });

    it("should provide context for scheduling within 6-day window", () => {
      // Given: Scheduling context for task within 6 days
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.85 },
          { hour: 14, averageEnergy: 0.6 }
        ],
        schedulingStrategy: "future",
        targetDate: addDays(new Date(), 4)
      };

      // When: Getting available slots
      const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

      // Then: Should return available slots for scheduling
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0]?.isToday).toBe(false);
      expect(slots[0]?.isHistorical).toBe(true);
    });
  });

  describe("Edge Cases and Validation", () => {
    it("should handle task with auto-scheduling disabled", () => {
      // Given: Task with auto-scheduling disabled
      const task = createTask({ 
        isAutoSchedule: false,
        startTime: new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0))
      });

      // When: Checking auto-scheduling eligibility
      const shouldReschedule = shouldAutoReschedule(task);

      // Then: Should not trigger auto-scheduling
      expect(shouldReschedule).toBe(false);
    });

    it("should handle null start time correctly", () => {
      // Given: Task with null start time
      const task = createTask({ startTime: null });

      // When: Checking date properties
      const isDateOnly = isDateOnlyWithoutTime(task.startTime);
      const targetDate = determineTargetDate(task);

      // Then: Should handle null gracefully
      expect(isDateOnly).toBe(false);
      expect(targetDate).toBeNull();
    });

    it("should validate UTC date handling for date-only times", () => {
      // Given: Date-only time in UTC
      const utcDate = new Date(Date.UTC(2024, 1, 15, 0, 0, 0, 0));
      
      // When: Checking if date-only
      const isDateOnly = isDateOnlyWithoutTime(utcDate);

      // Then: Should correctly identify as date-only
      expect(isDateOnly).toBe(true);
      expect(utcDate.getUTCHours()).toBe(0);
      expect(utcDate.getUTCMinutes()).toBe(0);
      expect(utcDate.getUTCSeconds()).toBe(0);
      expect(utcDate.getUTCMilliseconds()).toBe(0);
    });
  });
});