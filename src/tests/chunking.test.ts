// src/tests/chunking.test.ts

import { addDays, addHours, addMinutes, setHours, setMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import type { EnergySelect, EnergySlot, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";
import {
  buildMultiChunkContext,
  buildMultiChunkPromptContext,
  extractTaskDuration,
  getAvailableSlotsForContext,
  analyzeCognitiveLoad,
  countCognitiveTasks,
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

// Helper function to create chunked tasks
function createChunkedTasks(baseDuration: number, chunkCount: number, chunkDuration?: number): TaskSelect[] {
  const chunks: TaskSelect[] = [];
  const actualChunkDuration = chunkDuration || Math.floor(baseDuration / chunkCount);
  
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(createTask({
      id: `chunk-${i + 1}`,
      title: `Chunk ${i + 1}`,
      estimatedDuration: actualChunkDuration,
      isChunked: true,
      parentTaskId: "parent-task-1"
    }));
  }
  
  return chunks;
}

describe("Chunking Logic", () => {
  describe("AC: Short chunks (≤ 30 mins) may be scheduled on same day", () => {
    it("should allow multiple short chunks on the same day", () => {
      // Given: Multiple short chunks (≤ 30 minutes each)
      const shortChunks = createChunkedTasks(90, 3, 25); // 3 chunks of 25 minutes each
      
      // When: Building multi-chunk context
      const baseContext: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      };
      const context = buildMultiChunkContext(baseContext, shortChunks);

      // Then: Should create context for same-day scheduling
      expect(context.chunkInfo.totalChunks).toBe(3);
      expect(context.chunkInfo.chunkDurations).toEqual([25, 25, 25]);
      expect(context.chunkInfo.chunkDurations.every(duration => duration <= 30)).toBe(true);
    });

    it("should extract correct durations for short chunks", () => {
      // Given: Tasks with short durations
      const task15min = createTask({ estimatedDuration: 15 });
      const task30min = createTask({ estimatedDuration: 30 });
      const taskNoDuration = createTask({ estimatedDuration: null });

      // When: Extracting durations
      const duration15 = extractTaskDuration(task15min);
      const duration30 = extractTaskDuration(task30min);
      const durationDefault = extractTaskDuration(taskNoDuration);

      // Then: Should return correct durations with defaults
      expect(duration15).toBe(15);
      expect(duration30).toBe(30);
      expect(durationDefault).toBe(60); // Default duration
    });

    it("should identify short chunks for same-day scheduling optimization", () => {
      // Given: Mix of short and longer chunks
      const mixedChunks = [
        createTask({ id: "short-1", estimatedDuration: 20 }),    // Short
        createTask({ id: "short-2", estimatedDuration: 30 }),    // Short (boundary)
        createTask({ id: "medium-1", estimatedDuration: 45 }),   // Medium
      ];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      }, mixedChunks);

      // Then: Should capture all chunk information
      expect(context.chunkInfo.chunkDurations).toEqual([20, 30, 45]);
      
      // Identify short chunks (≤ 30 minutes)
      const shortChunkCount = context.chunkInfo.chunkDurations.filter(d => d <= 30).length;
      expect(shortChunkCount).toBe(2);
    });

    it("should handle empty chunks array gracefully", () => {
      // Given: Empty chunks array
      const emptyChunks: TaskSelect[] = [];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      }, emptyChunks);

      // Then: Should create valid context with empty chunk info
      expect(context.chunkInfo.totalChunks).toBe(0);
      expect(context.chunkInfo.allChunkIds).toEqual([]);
      expect(context.chunkInfo.chunkDurations).toEqual([]);
    });
  });

  describe("AC: Large chunks (> 45 mins) should be spaced across multiple days", () => {
    it("should identify large chunks that need multi-day spacing", () => {
      // Given: Large chunks that should be spaced across days
      const largeChunks = createChunkedTasks(300, 3, 90); // 3 chunks of 90 minutes each

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future", // Future strategy for multi-day
      }, largeChunks);

      // Then: Should identify need for multi-day scheduling
      expect(context.chunkInfo.chunkDurations).toEqual([90, 90, 90]);
      expect(context.chunkInfo.chunkDurations.every(duration => duration > 45)).toBe(true);
      expect(context.schedulingStrategy).toBe("future");
    });

    it("should generate multi-day slots for large chunks", () => {
      // Given: Context for large chunks with historical patterns
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.85 },
          { hour: 14, averageEnergy: 0.6 },
        ]
      };

      // When: Getting available slots (simulating large chunk scheduling)
      const slots = getAvailableSlotsForContext(context, 90, { min: 0.7, max: 1.0 });

      // Then: Should generate slots across multiple days
      expect(slots.length).toBeGreaterThan(1);
      
      // Check that slots span multiple days
      const uniqueDays = new Set(slots.map(slot => slot.startTime.toDateString()));
      expect(uniqueDays.size).toBeGreaterThan(1);
    });

    it("should build appropriate prompt context for large chunks", () => {
      // Given: Large chunks needing multi-day scheduling
      const largeChunks = [
        createTask({ id: "big-1", estimatedDuration: 60 }),
        createTask({ id: "big-2", estimatedDuration: 90 }),
        createTask({ id: "big-3", estimatedDuration: 120 }),
      ];

      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: [{ hour: 9, averageEnergy: 0.85 }]
      };

      const availableSlots = [
        {
          startTime: addDays(new Date(), 1),
          endTime: addDays(addHours(new Date(), 1), 1),
          energyLevel: 0.85,
          energyStage: "morning_peak",
          hasConflict: false,
          isToday: false,
          isHistorical: true
        }
      ];

      // When: Building prompt context
      const promptContext = buildMultiChunkPromptContext(largeChunks, context, availableSlots);

      // Then: Should include multi-chunk optimization note
      expect(promptContext.note).toContain("multi-chunk scheduling request");
      expect(promptContext.note).toContain("optimize all 3 chunks");
      expect(promptContext.note).toContain("avoiding conflicts");
    });
  });

  describe("AC: Deep Work chunks need 15-minute buffer between tasks > 30 mins", () => {
    it("should analyze cognitive load for deep work tasks", () => {
      // Given: Schedule with multiple deep work tasks
      const schedule: ScheduleItem[] = [
        createScheduleItem({
          id: "deep-1",
          type: "task",
          title: "Deep Work Session 1",
          startTime: setHours(setMinutes(new Date(), 0), 9),
          endTime: setHours(setMinutes(new Date(), 30), 10)
        }),
        createScheduleItem({
          id: "deep-2", 
          type: "task",
          title: "Deep Work Session 2",
          startTime: setHours(setMinutes(new Date(), 0), 11),
          endTime: setHours(setMinutes(new Date(), 0), 12)
        }),
        createScheduleItem({
          id: "meeting-1",
          type: "event",
          title: "Team Meeting",
          startTime: setHours(setMinutes(new Date(), 0), 14),
          endTime: setHours(setMinutes(new Date(), 0), 15)
        })
      ];

      // When: Analyzing cognitive load
      const cognitiveLoad = analyzeCognitiveLoad(schedule);

      // Then: Should detect high cognitive load and recommend buffer
      expect(cognitiveLoad.recentDeepTaskCount).toBe(2);
      expect(cognitiveLoad.recommendedBuffer).toBe("At least 30 minutes between demanding tasks");
    });

    it("should count cognitive tasks correctly", () => {
      // Given: Mix of task types
      const tasks = [
        createTask({ id: "deep-1", tag: "deep" }),
        createTask({ id: "creative-1", tag: "creative" }),
        createTask({ id: "admin-1", tag: "admin" }),
        createTask({ id: "deep-2", tag: "deep" }),
        createTask({ id: "personal-1", tag: "personal" }),
      ] as TaskSelect[];

      // When: Counting cognitive tasks
      const cognitiveTasks = countCognitiveTasks(tasks);

      // Then: Should identify deep and creative tasks only
      expect(cognitiveTasks).toHaveLength(3);
      expect(cognitiveTasks.map(t => t.tag)).toEqual(expect.arrayContaining(["deep", "creative", "deep"]));
    });

    it("should recommend appropriate buffer for low cognitive load", () => {
      // Given: Schedule with minimal deep work
      const lightSchedule: ScheduleItem[] = [
        createScheduleItem({
          id: "admin-1",
          type: "task", 
          title: "Admin Task",
        }),
        createScheduleItem({
          id: "meeting-1",
          type: "event",
          title: "Quick Sync",
        })
      ];

      // When: Analyzing cognitive load
      const cognitiveLoad = analyzeCognitiveLoad(lightSchedule);

      // Then: Should not require buffer
      expect(cognitiveLoad.recentDeepTaskCount).toBe(0);
      expect(cognitiveLoad.recommendedBuffer).toBe("No buffer needed");
    });

    it("should handle buffer requirements in chunked deep work context", () => {
      // Given: Multiple deep work chunks
      const deepWorkChunks = [
        createTask({ id: "deep-chunk-1", tag: "deep", estimatedDuration: 45 }),
        createTask({ id: "deep-chunk-2", tag: "deep", estimatedDuration: 60 }),
        createTask({ id: "deep-chunk-3", tag: "deep", estimatedDuration: 90 }),
      ];

      // Schedule with existing deep work
      const existingSchedule: ScheduleItem[] = [
        createScheduleItem({
          id: "existing-deep",
          type: "task",
          title: "Existing Deep Work"
        })
      ];

      const context: SchedulingContext = {
        schedule: existingSchedule,
        energyHistory: [],
        schedulingStrategy: "today",
      };

      // When: Building multi-chunk context
      const chunkContext = buildMultiChunkContext(context, deepWorkChunks);
      const cognitiveLoad = analyzeCognitiveLoad(chunkContext.schedule);

      // Then: Should recommend buffer due to cognitive load
      expect(chunkContext.chunkInfo.totalChunks).toBe(3);
      expect(chunkContext.chunkInfo.chunkDurations.every(d => d > 30)).toBe(true);
      expect(cognitiveLoad.recommendedBuffer).toContain("30 minutes");
    });
  });

  describe("Integration Tests - Multi-Chunk Scheduling", () => {
    it("should handle mixed chunk sizes with appropriate strategies", () => {
      // Given: Mixed chunk sizes requiring different strategies
      const mixedChunks = [
        createTask({ id: "short", estimatedDuration: 25 }),    // Short - same day OK
        createTask({ id: "medium", estimatedDuration: 45 }),   // Medium - boundary case
        createTask({ id: "long", estimatedDuration: 90 }),     // Long - multi-day preferred
      ];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future", // Future for flexibility
      }, mixedChunks);

      // Then: Should capture all chunk information for optimization
      expect(context.chunkInfo.totalChunks).toBe(3);
      expect(context.chunkInfo.chunkDurations).toEqual([25, 45, 90]);
      
      // Verify chunk categorization
      const shortChunks = context.chunkInfo.chunkDurations.filter(d => d <= 30);
      const mediumChunks = context.chunkInfo.chunkDurations.filter(d => d > 30 && d <= 45);
      const longChunks = context.chunkInfo.chunkDurations.filter(d => d > 45);
      
      expect(shortChunks).toHaveLength(1);
      expect(mediumChunks).toHaveLength(1);
      expect(longChunks).toHaveLength(1);
    });

    it("should build comprehensive prompt context for complex chunking", () => {
      // Given: Complex chunking scenario
      const complexChunks = [
        createTask({ id: "research", tag: "deep", estimatedDuration: 60 }),
        createTask({ id: "design", tag: "creative", estimatedDuration: 45 }),
        createTask({ id: "review", tag: "admin", estimatedDuration: 30 }),
      ];

      const context: SchedulingContext = {
        schedule: [
          createScheduleItem({ 
            id: "existing-meeting",
            type: "event",
            startTime: setHours(new Date(), 14),
            endTime: setHours(new Date(), 15)
          })
        ],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.9 },
          { hour: 14, averageEnergy: 0.6 },
        ]
      };

      const availableSlots = [
        {
          startTime: setHours(new Date(), 9),
          endTime: setHours(new Date(), 10),
          energyLevel: 0.9,
          energyStage: "morning_peak",
          hasConflict: false,
          isToday: false,
          isHistorical: true
        }
      ];

      // When: Building prompt context
      const promptContext = buildMultiChunkPromptContext(complexChunks, context, availableSlots);

      // Then: Should include comprehensive context
      expect(promptContext.currentTime).toBeDefined();
      expect(promptContext.schedule).toEqual(context.schedule);
      expect(promptContext.availableSlots).toEqual(availableSlots);
      expect(promptContext.cognitiveLoad).toBeDefined();
      expect(promptContext.energyRequirements).toBeDefined();
      expect(promptContext.constraints).toBeDefined();
      expect(promptContext.note).toContain("multi-chunk scheduling request");
    });
  });

  describe("Edge Cases and Validation", () => {
    it("should handle chunks with null or undefined durations", () => {
      // Given: Chunks with missing duration data
      const chunksWithMissingData = [
        createTask({ estimatedDuration: null }),
        createTask({ estimatedDuration: undefined }),
        createTask({ estimatedDuration: 45 }),
      ];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      }, chunksWithMissingData);

      // Then: Should use default durations
      expect(context.chunkInfo.chunkDurations).toEqual([60, 60, 45]); // 60 is default
    });

    it("should validate chunk metadata integrity", () => {
      // Given: Chunks with various properties
      const chunks = [
        createTask({ id: "chunk-a", title: "First Chunk", estimatedDuration: 30 }),
        createTask({ id: "chunk-b", title: "Second Chunk", estimatedDuration: 60 }),
      ];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      }, chunks);

      // Then: Should maintain data integrity
      expect(context.chunkInfo.allChunkIds).toEqual(["chunk-a", "chunk-b"]);
      expect(context.chunkInfo.chunkTitles).toEqual(["First Chunk", "Second Chunk"]);
      expect(context.chunkInfo.chunkDurations).toEqual([30, 60]);
      expect(context.chunkInfo.isMultiChunkScheduling).toBe(true);
    });

    it("should handle single chunk as multi-chunk context", () => {
      // Given: Single chunk (edge case for multi-chunk logic)
      const singleChunk = [createTask({ estimatedDuration: 45 })];

      // When: Building context
      const context = buildMultiChunkContext({
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
      }, singleChunk);

      // Then: Should handle single chunk correctly
      expect(context.chunkInfo.totalChunks).toBe(1);
      expect(context.chunkInfo.isMultiChunkScheduling).toBe(true);
    });
  });
});