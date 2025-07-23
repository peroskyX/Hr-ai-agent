// src/tests/test-utilities.ts

import { addDays, addHours, addMinutes, setHours, setMinutes } from "date-fns";
import type { EnergySelect, EnergySlot, HistoricalEnergyPattern, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";

/**
 * Test Data Factory Functions
 * These functions create consistent test data for use across all test files
 */

export interface TaskTestOptions extends Partial<TaskSelect> {
  // Additional test-specific options
  scheduledHoursFromNow?: number;
  deadlineHoursFromNow?: number;
}

export interface EnergyTestOptions {
  hour?: number;
  energyLevel?: number;
  baseDate?: Date;
  energyStage?: string;
}

export interface ScheduleTestOptions extends Partial<ScheduleItem> {
  hoursFromNow?: number;
  durationHours?: number;
}

/**
 * Creates a test task with smart defaults and custom overrides
 */
export function createTestTask(options: TaskTestOptions = {}): TaskSelect {
  const {
    scheduledHoursFromNow,
    deadlineHoursFromNow,
    ...overrides
  } = options;

  const baseTask: TaskSelect = {
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
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
  };

  // Apply time-based options
  if (scheduledHoursFromNow !== undefined) {
    baseTask.startTime = addHours(new Date(), scheduledHoursFromNow);
  }

  if (deadlineHoursFromNow !== undefined) {
    baseTask.endTime = addHours(new Date(), deadlineHoursFromNow);
  }

  return baseTask as TaskSelect;
}

/**
 * Creates a test energy slot with smart defaults
 */
export function createTestEnergySlot(options: EnergyTestOptions = {}): EnergySelect {
  const {
    hour = 9,
    energyLevel = 0.8,
    baseDate = new Date(),
    energyStage = energyLevel > 0.7 ? "morning_peak" : "midday_dip"
  } = options;

  const startTime = setHours(setMinutes(baseDate, 0), hour);

  return {
    id: `energy-${hour}-${Math.random().toString(36).substr(2, 6)}`,
    userId: "user-1",
    date: startTime.toISOString(),
    _id: `energy-${Math.random().toString(36).substr(2, 9)}`,
    _creationTime: Date.now(),
    hour: hour,
    energyLevel,
    energyStage,
    mood: "focused",
    hasManualCheckIn: false,
    createdAt: baseDate,
    updatedAt: baseDate,
  } as unknown as EnergySelect;
}

/**
 * Creates a test schedule item with smart defaults
 */
export function createTestScheduleItem(options: ScheduleTestOptions = {}): ScheduleItem {
  const {
    hoursFromNow = 1,
    durationHours = 1,
    ...overrides
  } = options;

  const startTime = addHours(new Date(), hoursFromNow);
  const endTime = addHours(startTime, durationHours);

  return {
    id: `schedule-${Math.random().toString(36).substr(2, 9)}`,
    type: "task",
    title: "Test Schedule Item",
    startTime,
    endTime,
    description: "",
    status: "pending",
    ...overrides,
  } as ScheduleItem;
}

/**
 * Creates historical energy patterns for testing
 */
export function createTestHistoricalPatterns(options: Partial<HistoricalEnergyPattern>[] = []): HistoricalEnergyPattern[] {
  const defaultPatterns: HistoricalEnergyPattern[] = [
    { hour: 9, averageEnergy: 0.9 },   // Morning peak
    { hour: 11, averageEnergy: 0.85 }, // Late morning
    { hour: 13, averageEnergy: 0.5 },  // Midday dip
    { hour: 15, averageEnergy: 0.75 }, // Afternoon rebound
    { hour: 17, averageEnergy: 0.6 },  // Evening
    { hour: 21, averageEnergy: 0.4 },  // Wind down
  ];

  if (options.length === 0) {
    return defaultPatterns;
  }

  return options.map((override, index) => ({
    ...defaultPatterns[index] || { hour: 9, averageEnergy: 0.8 },
    ...override
  }));
}

/**
 * Creates a test scheduling context with smart defaults
 */
export function createTestSchedulingContext(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    schedule: [],
    energyHistory: [],
    schedulingStrategy: "today",
    ...overrides,
  };
}

/**
 * Test Validation Functions
 * Helper functions to validate test outcomes
 */

/**
 * Validates that a schedule maintains proper buffer times
 */
export function validateScheduleBuffer(schedule: ScheduleItem[], minimumBufferMinutes: number = 10): {
  isValid: boolean;
  violations: Array<{
    item1: ScheduleItem;
    item2: ScheduleItem;
    actualBuffer: number;
  }>;
} {
  const violations: Array<{
    item1: ScheduleItem;
    item2: ScheduleItem;
    actualBuffer: number;
  }> = [];

  const sortedItems = [...schedule].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  for (let i = 0; i < sortedItems.length - 1; i++) {
    const current = sortedItems[i]!;
    const next = sortedItems[i + 1]!;
    
    if (!current.endTime || !next.startTime) continue;

    const bufferMinutes = (next.startTime.getTime() - current.endTime.getTime()) / (1000 * 60);
    
    if (bufferMinutes < minimumBufferMinutes) {
      violations.push({
        item1: current,
        item2: next,
        actualBuffer: bufferMinutes
      });
    }
  }

  return {
    isValid: violations.length === 0,
    violations
  };
}

/**
 * Validates energy slot requirements
 */
export function validateEnergyRequirements(
  slots: EnergySlot[], 
  requirements: { min: number; max: number }
): boolean {
  return slots.every(slot => 
    slot.energyLevel >= requirements.min && 
    slot.energyLevel <= requirements.max
  );
}

/**
 * Validates that slots don't overlap with existing schedule
 */
export function validateNoScheduleConflicts(
  slots: EnergySlot[], 
  schedule: ScheduleItem[], 
  taskDuration: number
): boolean {
  return slots.every(slot => {
    const taskEnd = addMinutes(slot.startTime, taskDuration);
    
    return !schedule.some(item => {
      if (!item.endTime) return false;
      
      const itemStart = new Date(item.startTime);
      const itemEnd = new Date(item.endTime);
      
      // Check for overlap
      const taskStartsBeforeItemEnds = slot.startTime < itemEnd;
      const taskEndsAfterItemStarts = taskEnd > itemStart;
      
      return taskStartsBeforeItemEnds && taskEndsAfterItemStarts;
    });
  });
}

/**
 * Test Scenario Builders
 * Functions to create common test scenarios
 */

/**
 * Creates a busy day scenario with multiple meetings and tasks
 */
export function createBusyDayScenario(): {
  schedule: ScheduleItem[];
  energyForecast: EnergySelect[];
} {
  const today = new Date();
  
  const schedule = [
    createTestScheduleItem({ 
      hoursFromNow: 1, 
      durationHours: 1, 
      type: "event", 
      title: "Morning Standup" 
    }),
    createTestScheduleItem({ 
      hoursFromNow: 3, 
      durationHours: 2, 
      type: "task", 
      title: "Deep Work Session" 
    }),
    createTestScheduleItem({ 
      hoursFromNow: 6, 
      durationHours: 1, 
      type: "event", 
      title: "Client Meeting" 
    }),
    createTestScheduleItem({ 
      hoursFromNow: 8, 
      durationHours: 1, 
      type: "task", 
      title: "Admin Tasks" 
    }),
  ];

  const energyForecast = [
    createTestEnergySlot({ hour: today.getHours() + 2, energyLevel: 0.9 }),
    createTestEnergySlot({ hour: today.getHours() + 4, energyLevel: 0.85 }),
    createTestEnergySlot({ hour: today.getHours() + 7, energyLevel: 0.6 }),
    createTestEnergySlot({ hour: today.getHours() + 9, energyLevel: 0.4 }),
  ];

  return { schedule, energyForecast };
}

/**
 * Creates a multi-chunk task scenario
 */
export function createMultiChunkScenario(): {
  chunks: TaskSelect[];
  parentTask: TaskSelect;
} {
  const parentTask = createTestTask({
    id: "parent-task",
    title: "Large Project",
    estimatedDuration: 180,
    isChunked: true
  });

  const chunks = [
    createTestTask({
      id: "chunk-1",
      title: "Research Phase",
      estimatedDuration: 60,
      tag: "deep",
      parentTaskId: parentTask.id,
      isChunked: true
    }),
    createTestTask({
      id: "chunk-2", 
      title: "Design Phase",
      estimatedDuration: 45,
      tag: "creative",
      parentTaskId: parentTask.id,
      isChunked: true
    }),
    createTestTask({
      id: "chunk-3",
      title: "Implementation Phase", 
      estimatedDuration: 75,
      tag: "deep",
      parentTaskId: parentTask.id,
      isChunked: true
    }),
  ];

  return { chunks, parentTask };
}

/**
 * Creates energy patterns that simulate different chronotypes
 */
export function createChronotypeEnergyPattern(type: "morning" | "evening" | "neutral"): HistoricalEnergyPattern[] {
  switch (type) {
    case "morning":
      return [
        { hour: 6, averageEnergy: 0.8 },
        { hour: 8, averageEnergy: 0.95 },
        { hour: 10, averageEnergy: 0.9 },
        { hour: 12, averageEnergy: 0.7 },
        { hour: 14, averageEnergy: 0.6 },
        { hour: 16, averageEnergy: 0.65 },
        { hour: 18, averageEnergy: 0.5 },
        { hour: 20, averageEnergy: 0.3 },
      ];
    
    case "evening":
      return [
        { hour: 8, averageEnergy: 0.4 },
        { hour: 10, averageEnergy: 0.6 },
        { hour: 12, averageEnergy: 0.7 },
        { hour: 14, averageEnergy: 0.75 },
        { hour: 16, averageEnergy: 0.85 },
        { hour: 18, averageEnergy: 0.9 },
        { hour: 20, averageEnergy: 0.95 },
        { hour: 22, averageEnergy: 0.8 },
      ];
    
    case "neutral":
    default:
      return [
        { hour: 9, averageEnergy: 0.8 },
        { hour: 11, averageEnergy: 0.85 },
        { hour: 13, averageEnergy: 0.5 },
        { hour: 15, averageEnergy: 0.75 },
        { hour: 17, averageEnergy: 0.6 },
        { hour: 19, averageEnergy: 0.4 },
      ];
  }
}

/**
 * Test Constants
 */
export const TEST_CONSTANTS = {
  DEFAULT_TASK_DURATION: 60,
  DEFAULT_BUFFER_MINUTES: 10,
  COGNITIVE_BUFFER_MINUTES: 30,
  CURRENT_TIME_BUFFER_MINUTES: 15,
  HIGH_ENERGY_THRESHOLD: 0.7,
  MEDIUM_ENERGY_THRESHOLD: 0.5,
  LOW_ENERGY_THRESHOLD: 0.3,
} as const;

/**
 * Date/Time Utilities for Tests
 */
export class TestDateUtils {
  /**
   * Creates a date-only timestamp (UTC midnight)
   */
  static createDateOnly(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  }

  /**
   * Creates a specific time on today's date
   */
  static createTimeToday(hour: number, minute: number = 0): Date {
    const today = new Date();
    return setHours(setMinutes(today, minute), hour);
  }

  /**
   * Creates a time relative to now
   */
  static createRelativeTime(hours: number, minutes: number = 0): Date {
    return addMinutes(addHours(new Date(), hours), minutes);
  }

  /**
   * Checks if two dates are on the same day
   */
  static isSameDay(date1: Date, date2: Date): boolean {
    return date1.toDateString() === date2.toDateString();
  }

  /**
   * Gets the difference between two dates in minutes
   */
  static getMinutesDifference(date1: Date, date2: Date): number {
    return Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60);
  }
}

/**
 * Mock Data Generators
 */
export class MockDataGenerator {
  /**
   * Generates a realistic daily schedule
   */
  static generateDailySchedule(date: Date = new Date()): ScheduleItem[] {
    return [
      createTestScheduleItem({
        startTime: setHours(setMinutes(date, 0), 9),
        endTime: setHours(setMinutes(date, 30), 9),
        type: "event",
        title: "Morning Standup"
      }),
      createTestScheduleItem({
        startTime: setHours(setMinutes(date, 0), 11),
        endTime: setHours(setMinutes(date, 0), 12),
        type: "task", 
        title: "Code Review"
      }),
      createTestScheduleItem({
        startTime: setHours(setMinutes(date, 0), 14),
        endTime: setHours(setMinutes(date, 0), 15),
        type: "event",
        title: "Team Sync"
      }),
      createTestScheduleItem({
        startTime: setHours(setMinutes(date, 0), 16),
        endTime: setHours(setMinutes(date, 0), 17),
        type: "task",
        title: "Documentation"
      })
    ];
  }

  /**
   * Generates energy forecast for a full day
   */
  static generateDailyEnergyForecast(date: Date = new Date()): EnergySelect[] {
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const energyLevels = [0.6, 0.9, 0.95, 0.85, 0.5, 0.4, 0.7, 0.8, 0.75, 0.6, 0.5, 0.4, 0.3];
    
    return hours.map((hour, index) => 
      createTestEnergySlot({
        hour,
        energyLevel: energyLevels[index] || 0.5,
        baseDate: date
      })
    );
  }
}

/**
 * Assertion Helpers
 */
export class TestAssertions {
  /**
   * Asserts that all acceptance criteria conditions are met
   */
  static assertAcceptanceCriteria(result: any, criteria: {
    description: string;
    condition: boolean;
  }[]): void {
    criteria.forEach(({ description, condition }) => {
      if (!condition) {
        throw new Error(`Acceptance criteria failed: ${description}`);
      }
    });
  }

  /**
   * Asserts that scheduling respects buffer requirements
   */
  static assertBufferRequirements(
    schedule: ScheduleItem[],
    minimumBuffer: number = TEST_CONSTANTS.DEFAULT_BUFFER_MINUTES
  ): void {
    const validation = validateScheduleBuffer(schedule, minimumBuffer);
    if (!validation.isValid) {
      const violationDetails = validation.violations
        .map(v => `${v.item1.title} -> ${v.item2.title}: ${v.actualBuffer}min`)
        .join(', ');
      throw new Error(`Buffer requirements violated: ${violationDetails}`);
    }
  }

  /**
   * Asserts that energy requirements are met
   */
  static assertEnergyRequirements(
    slots: EnergySlot[],
    requirements: { min: number; max: number }
  ): void {
    const valid = validateEnergyRequirements(slots, requirements);
    if (!valid) {
      throw new Error(`Energy requirements not met: min=${requirements.min}, max=${requirements.max}`);
    }
  }
}

/**
 * Creates a schedule item that also accepts TaskSelect properties
 * This is useful for testing when you need schedule items with task-specific properties
 */
export function createTestScheduleItemWithTaskProperties(options: Partial<TaskSelect> & {
  hoursFromNow?: number;
  durationHours?: number;
  type?: "task" | "event";
} = {}): ScheduleItem & Partial<TaskSelect> {
  const {
    hoursFromNow = 1,
    durationHours = 1,
    ...overrides
  } = options;

  const startTime = addHours(new Date(), hoursFromNow);
  const endTime = addHours(startTime, durationHours);

  return {
    id: `schedule-${Math.random().toString(36).substr(2, 9)}`,
    type: "task",
    title: "Test Schedule Item",
    startTime,
    endTime,
    description: "",
    status: "pending",
    priority: 3, // Default priority for tasks
    isAutoSchedule: true, // Default auto-schedule setting
    ...overrides,
  } as ScheduleItem & Partial<TaskSelect>;
}

export default {
  createTestTask,
  createTestEnergySlot,
  createTestScheduleItem,
  createTestHistoricalPatterns,
  createTestSchedulingContext,
  createTestScheduleItemWithTaskProperties,
  validateScheduleBuffer,
  validateEnergyRequirements,
  validateNoScheduleConflicts,
  createBusyDayScenario,
  createMultiChunkScenario,
  createChronotypeEnergyPattern,
  TestDateUtils,
  MockDataGenerator,
  TestAssertions,
  TEST_CONSTANTS,
};