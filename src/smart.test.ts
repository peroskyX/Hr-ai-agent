import { addDays, addHours, setHours, setMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import type { EnergySelect, EnergySlot, HistoricalEnergyPattern, ScheduleItem, SchedulingContext, TaskSelect } from "./smart.js";

import {
  analyzeAvailableSlotsToday,
  buildMultiChunkContext,
  determineTargetDate,
  getAvailableSlotsForContext,
  isDateOnlyWithoutTime,
  shouldAutoReschedule,
} from "./smart.js";

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
    date: startTime,
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

describe("getAvailableSlotsForContext", () => {
  it("should use today slots when strategy is today and forecast exists", () => {
    const futureDate = addHours(new Date(), 2);
    const context: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      todayEnergyForecast: [
        createEnergySlot(futureDate.getHours(), 0.8, futureDate),
        createEnergySlot(futureDate.getHours() + 1, 0.9, futureDate),
      ],
      schedulingStrategy: "today",
    };

    const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.isToday).toBe(true);
    expect(slots[0]?.energyLevel).toBe(0.8);
  });

  it("should use future slots when strategy is future with target date", () => {
    const targetDate = addDays(new Date(), 3);
    const context: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "future",
      targetDate,
      historicalPatterns: [
        { hour: 9, averageEnergy: 0.85 },
        { hour: 10, averageEnergy: 0.9 },
      ],
    };

    const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.isToday).toBe(false);
    expect(slots[0]?.isHistorical).toBe(true);
  });

  it("should generate multi-day slots when no specific target date", () => {
    const context: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "future",
      historicalPatterns: [
        { hour: 9, averageEnergy: 0.85 },
      ],
    };

    const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

    expect(slots.length).toBeGreaterThan(0);

    expect(slots.length).toBeGreaterThanOrEqual(6);
    expect(slots.length).toBeLessThanOrEqual(7);
  });

  it("should return empty array when no patterns available", () => {
    const context: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "future",
    };

    const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

    expect(slots).toEqual([]);
  });
});

describe("analyzeAvailableSlotsToday", () => {
  it("should filter slots based on energy requirements", () => {
    const futureDate = addHours(new Date(), 2);
    const energyForecast = [
      createEnergySlot(futureDate.getHours(), 0.5, futureDate),
      createEnergySlot(futureDate.getHours() + 1, 0.8, futureDate),
      createEnergySlot(futureDate.getHours() + 2, 0.9, futureDate),
    ];

    const result = analyzeAvailableSlotsToday({
      schedule: [],
      energyForecast,
      taskDuration: 60,
      energyRequirements: { min: 0.7, max: 1.0 },
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.energyLevel).toBe(0.8);
    expect(result[1]?.energyLevel).toBe(0.9);
  });

  it("should detect and filter conflicting slots", () => {
    const baseTime = addHours(new Date(), 3);
    const hour = baseTime.getHours();

    const schedule: ScheduleItem[] = [
      createScheduleItem({
        startTime: setHours(setMinutes(baseTime, 0), hour),
        endTime: setHours(setMinutes(baseTime, 0), hour + 1),
      }),
    ];

    const energyForecast = [
      createEnergySlot(hour, 0.8, baseTime),
      createEnergySlot(hour + 1, 0.9, baseTime),
      createEnergySlot(hour + 2, 0.85, baseTime),
    ];

    const result = analyzeAvailableSlotsToday({
      schedule,
      energyForecast,
      taskDuration: 60,
      energyRequirements: { min: 0.3, max: 1.0 },
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.energyLevel).toBe(0.9);
    expect(result[1]?.energyLevel).toBe(0.85);
  });

  it("should exclude slots before current time with buffer", () => {
    const now = new Date();
    const pastSlot = setHours(setMinutes(now, 0), now.getHours() - 1);
    const futureSlot = setHours(setMinutes(now, 30), now.getHours() + 1);

    const energyForecast: EnergySelect[] = [
      {
        ...createEnergySlot(0, 0.8),
        startTime: pastSlot,
        endTime: addHours(pastSlot, 1),
      },
      {
        ...createEnergySlot(0, 0.9),
        startTime: futureSlot,
        endTime: addHours(futureSlot, 1),
      },
    ];

    const result = analyzeAvailableSlotsToday({
      schedule: [],
      energyForecast,
      taskDuration: 60,
      energyRequirements: { min: 0.3, max: 1.0 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.startTime.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("shouldAutoReschedule", () => {
  it("should return false when auto-scheduling is disabled", () => {
    const task = createTask({ isAutoSchedule: false });

    expect(shouldAutoReschedule(task)).toBe(false);
    expect(shouldAutoReschedule(task, { priority: 5 })).toBe(false);
  });

  it("should check for initial scheduling when no changes provided", () => {
    const taskNoStart = createTask({ startTime: null });
    const taskWithStart = createTask({ startTime: new Date() });

    expect(shouldAutoReschedule(taskNoStart)).toBe(true);
    expect(shouldAutoReschedule(taskWithStart)).toBe(false);
  });

  it("should reschedule when setting date-only time", () => {
    const task = createTask({ startTime: new Date() });
    const dateOnly = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0));

    expect(shouldAutoReschedule(task, { startTime: dateOnly })).toBe(true);
  });

  it("should reschedule when removing start time", () => {
    const task = createTask({ startTime: new Date() });

    expect(shouldAutoReschedule(task, { startTime: null })).toBe(true);
  });

  it("should reschedule on significant priority change", () => {
    const task = createTask({ priority: 1 });

    expect(shouldAutoReschedule(task, { priority: 3 })).toBe(true);
    expect(shouldAutoReschedule(task, { priority: 2 })).toBe(false);
  });

  it("should reschedule on significant duration change", () => {
    const task = createTask({ estimatedDuration: 30 });

    expect(shouldAutoReschedule(task, { estimatedDuration: 90 })).toBe(true);
    expect(shouldAutoReschedule(task, { estimatedDuration: 45 })).toBe(false);
  });
});

describe("isDateOnlyWithoutTime", () => {
  it("should return true for date-only timestamps", () => {
    const dateOnly = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0));
    expect(isDateOnlyWithoutTime(dateOnly)).toBe(true);
  });

  it("should return false for dates with time components", () => {
    const withHours = new Date(Date.UTC(2024, 0, 1, 10, 0, 0, 0));
    const withMinutes = new Date(Date.UTC(2024, 0, 1, 0, 30, 0, 0));
    const withSeconds = new Date(Date.UTC(2024, 0, 1, 0, 0, 30, 0));
    const withMillis = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 500));

    expect(isDateOnlyWithoutTime(withHours)).toBe(false);
    expect(isDateOnlyWithoutTime(withMinutes)).toBe(false);
    expect(isDateOnlyWithoutTime(withSeconds)).toBe(false);
    expect(isDateOnlyWithoutTime(withMillis)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isDateOnlyWithoutTime(null)).toBe(false);
  });

  it("should handle timezone edge cases", () => {
    const localMidnight = new Date(2024, 0, 1, 0, 0, 0, 0);
    const utcHours = localMidnight.getUTCHours();

    if (utcHours !== 0) {
      expect(isDateOnlyWithoutTime(localMidnight)).toBe(false);
    }
  });
});

describe("determineTargetDate", () => {
  it("should return date for date-only start time", () => {
    const dateOnly = new Date(Date.UTC(2024, 0, 15, 0, 0, 0, 0));
    const task = createTask({ startTime: dateOnly });

    const result = determineTargetDate(task);
    expect(result).toEqual(dateOnly);
  });

  it("should return today for deadline today", () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const task = createTask({ endTime: today });

    const result = determineTargetDate(task);
    expect(result?.toDateString()).toBe(new Date().toDateString());
  });

  it("should return null for future deadline", () => {
    const futureDeadline = addDays(new Date(), 5);
    const task = createTask({ endTime: futureDeadline });

    expect(determineTargetDate(task)).toBeNull();
  });

  it("should return null when no dates set", () => {
    const task = createTask({ startTime: null, endTime: null });

    expect(determineTargetDate(task)).toBeNull();
  });

  it("should prioritize date-only start time over deadline", () => {
    const dateOnly = new Date(Date.UTC(2024, 0, 15, 0, 0, 0, 0));
    const deadline = new Date();
    const task = createTask({ startTime: dateOnly, endTime: deadline });

    expect(determineTargetDate(task)).toEqual(dateOnly);
  });
});

describe("buildMultiChunkContext", () => {
  it("should build context with chunk metadata", () => {
    const baseContext: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "today",
    };

    const chunks = [
      createTask({ id: "chunk-1", title: "Part 1", estimatedDuration: 30 }),
      createTask({ id: "chunk-2", title: "Part 2", estimatedDuration: 45 }),
      createTask({ id: "chunk-3", title: "Part 3", estimatedDuration: 60 }),
    ];

    const result = buildMultiChunkContext(baseContext, chunks);

    expect(result.chunkInfo).toEqual({
      isMultiChunkScheduling: true,
      totalChunks: 3,
      allChunkIds: ["chunk-1", "chunk-2", "chunk-3"],
      chunkTitles: ["Part 1", "Part 2", "Part 3"],
      chunkDurations: [30, 45, 60],
    });
  });

  it("should preserve base context properties", () => {
    const baseContext: SchedulingContext = {
      schedule: [createScheduleItem()],
      energyHistory: [createEnergySlot(10, 0.8)],
      schedulingStrategy: "future",
      targetDate: new Date(),
    };

    const chunks = [createTask()];
    const result = buildMultiChunkContext(baseContext, chunks);

    expect(result.schedule).toEqual(baseContext.schedule);
    expect(result.energyHistory).toEqual(baseContext.energyHistory);
    expect(result.schedulingStrategy).toEqual(baseContext.schedulingStrategy);
    expect(result.targetDate).toEqual(baseContext.targetDate);
  });

  it("should handle empty chunk array", () => {
    const baseContext: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "today",
    };

    const result = buildMultiChunkContext(baseContext, []);

    expect(result.chunkInfo.totalChunks).toBe(0);
    expect(result.chunkInfo.allChunkIds).toEqual([]);
    expect(result.chunkInfo.chunkTitles).toEqual([]);
    expect(result.chunkInfo.chunkDurations).toEqual([]);
  });

  it("should use default duration for chunks without duration", () => {
    const chunks = [
      createTask({ estimatedDuration: null }),
      createTask({ estimatedDuration: undefined }),
    ];

    const result = buildMultiChunkContext({
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "today",
    }, chunks);

    expect(result.chunkInfo.chunkDurations).toEqual([60, 60]);
  });
});
