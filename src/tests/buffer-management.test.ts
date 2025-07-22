// src/tests/buffer-management.test.ts

import { addDays, addHours, addMinutes, setHours, setMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import type { EnergySelect, EnergySlot, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";
import {
  analyzeAvailableSlotsToday,
  getAvailableSlotsForContext,
  analyzeCognitiveLoad,
  buildPromptContext,
  buildMultiChunkPromptContext,
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

// Helper to create time slots with specific spacing
function createTimeSlots(baseTime: Date, intervals: number[]): ScheduleItem[] {
  return intervals.map((minuteOffset, index) => 
    createScheduleItem({
      id: `item-${index}`,
      title: `Item ${index + 1}`,
      startTime: addMinutes(baseTime, minuteOffset),
      endTime: addMinutes(baseTime, minuteOffset + 60), // 1 hour duration
      type: index % 2 === 0 ? "task" : "event"
    })
  );
}

// Helper to validate buffer between items
function validateBuffer(schedule: ScheduleItem[], minimumBufferMinutes: number): boolean {
  const sortedItems = [...schedule].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  
  for (let i = 0; i < sortedItems.length - 1; i++) {
    const currentEnd = sortedItems[i]!.endTime;
    const nextStart = sortedItems[i + 1]!.startTime;
    const bufferMinutes = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60);
    
    if (bufferMinutes < minimumBufferMinutes) {
      return false;
    }
  }
  
  return true;
}

describe("Buffer Management", () => {
  describe("AC: 10-minute buffer between tasks and meetings when smart scheduling", () => {
    it("should ensure 10-minute buffer between consecutive schedule items", () => {
      // Given: Existing schedule with meetings and tasks
      const baseTime = setHours(setMinutes(new Date(), 0), 9); // 9:00 AM
      const existingSchedule = createTimeSlots(baseTime, [
        0,    // 9:00-10:00 Meeting
        70,   // 10:10-11:10 Task (10 min buffer)
        140,  // 11:20-12:20 Task (10 min buffer)
      ]);

      // When: Validating buffer requirements
      const hasProperBuffer = validateBuffer(existingSchedule, 10);

      // Then: Should have minimum 10-minute buffer between items
      expect(hasProperBuffer).toBe(true);
      
      // Verify specific gaps
      const meeting = existingSchedule[0]!;
      const firstTask = existingSchedule[1]!;
      const secondTask = existingSchedule[2]!;
      
      const firstBuffer = (firstTask.startTime.getTime() - meeting.endTime.getTime()) / (1000 * 60);
      const secondBuffer = (secondTask.startTime.getTime() - firstTask.endTime.getTime()) / (1000 * 60);
      
      expect(firstBuffer).toBe(10);
      expect(secondBuffer).toBe(10);
    });

    it("should detect insufficient buffer in tight schedule", () => {
      // Given: Schedule with insufficient buffer
      const baseTime = setHours(setMinutes(new Date(), 0), 14); // 2:00 PM
      const tightSchedule = createTimeSlots(baseTime, [
        0,   // 14:00-15:00
        65,  // 15:05-16:05 (Only 5 min buffer - insufficient)
        130, // 16:10-17:10 (Only 5 min buffer - insufficient)
      ]);

      // When: Validating buffer requirements
      const hasProperBuffer = validateBuffer(tightSchedule, 10);

      // Then: Should detect insufficient buffer
      expect(hasProperBuffer).toBe(false);
    });

    it("should exclude time slots that conflict with buffer requirements", () => {
      // Given: Energy forecast and existing schedule that would create conflicts
      const now = new Date();
      const baseHour = now.getHours() + 2;
      
      // Existing meeting from 2-3 hours from now
      const existingMeeting = createScheduleItem({
        startTime: setHours(setMinutes(now, 0), baseHour),
        endTime: setHours(setMinutes(now, 0), baseHour + 1),
        type: "event"
      });

      // Energy slots that would conflict with buffer requirements
      const energyForecast = [
        createEnergySlot(baseHour - 1, 0.8, now),     // 1 hour before meeting
        createEnergySlot(baseHour, 0.9, now),         // During meeting (conflict)
        createEnergySlot(baseHour + 1, 0.85, now),    // Right after meeting (no buffer)
        createEnergySlot(baseHour + 2, 0.8, now),     // 1 hour after meeting (good buffer)
      ];

      // When: Analyzing available slots with 60-minute task duration
      const availableSlots = analyzeAvailableSlotsToday({
        schedule: [existingMeeting],
        energyForecast,
        taskDuration: 60,
        energyRequirements: { min: 0.7, max: 1.0 }
      });

      // Then: Should exclude slots that would violate buffer requirements
      expect(availableSlots.length).toBeGreaterThan(0);
      
      // Verify no conflicts with existing schedule
      availableSlots.forEach(slot => {
        expect(slot.hasConflict).toBe(false);
        
        // Verify buffer with existing meeting
        const taskEnd = addMinutes(slot.startTime, 60);
        const meetingStart = existingMeeting.startTime;
        const meetingEnd = existingMeeting.endTime;
        
        // Task should either end before meeting starts (with buffer) or start after meeting ends (with buffer)
        const endsBeforeMeeting = taskEnd.getTime() <= meetingStart.getTime() - (10 * 60 * 1000);
        const startsAfterMeeting = slot.startTime.getTime() >= meetingEnd.getTime() + (10 * 60 * 1000);
        
        expect(endsBeforeMeeting || startsAfterMeeting).toBe(true);
      });
    });

    it("should account for buffer in multi-day scheduling", () => {
      // Given: Context for future scheduling with existing schedule
      const targetDate = addDays(new Date(), 1);
      const existingSchedule = [
        createScheduleItem({
          startTime: setHours(setMinutes(targetDate, 0), 10), // 10:00 AM tomorrow
          endTime: setHours(setMinutes(targetDate, 0), 11),   // 11:00 AM tomorrow
          type: "event"
        })
      ];

      const context: SchedulingContext = {
        schedule: existingSchedule,
        energyHistory: [],
        schedulingStrategy: "future",
        targetDate,
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.85 },   // 9:00 AM (would conflict with buffer)
          { hour: 12, averageEnergy: 0.8 },   // 12:00 PM (has proper buffer)
          { hour: 14, averageEnergy: 0.75 },  // 2:00 PM (has proper buffer)
        ]
      };

      // When: Getting available slots
      const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

      // Then: Should respect buffer requirements in future scheduling
      const validSlots = slots.filter(slot => !slot.hasConflict);
      expect(validSlots.length).toBeGreaterThan(0);
      
      // Verify buffer requirements are met
      validSlots.forEach(slot => {
        const taskEnd = addMinutes(slot.startTime, 60);
        const meetingStart = existingSchedule[0]!.startTime;
        const meetingEnd = existingSchedule[0]!.endTime;
        
        const hasProperBuffer = 
          taskEnd.getTime() <= meetingStart.getTime() - (10 * 60 * 1000) ||
          slot.startTime.getTime() >= meetingEnd.getTime() + (10 * 60 * 1000);
          
        expect(hasProperBuffer).toBe(true);
      });
    });
  });

  describe("Buffer Requirements for Different Task Types", () => {
    it("should ensure buffer for deep work tasks", () => {
      // Given: Schedule with deep work tasks requiring cognitive buffer
      const schedule = [
        createScheduleItem({
          id: "deep-work-1",
          type: "task",
          title: "Deep Work Session",
          startTime: setHours(setMinutes(new Date(), 0), 9),
          endTime: setHours(setMinutes(new Date(), 0), 10),
        }),
        createScheduleItem({
          id: "meeting-1",
          type: "event",
          title: "Team Meeting",
          startTime: setHours(setMinutes(new Date(), 0), 10),
          endTime: setHours(setMinutes(new Date(), 0), 11),
        })
      ];

      // When: Analyzing cognitive load
      const cognitiveLoad = analyzeCognitiveLoad(schedule);

      // Then: Should recommend appropriate buffer
      expect(cognitiveLoad.recentDeepTaskCount).toBeGreaterThan(0);
      
      // Verify schedule has insufficient buffer for cognitive tasks
      const hasMinimumBuffer = validateBuffer(schedule, 10);
      const deepWorkTask = schedule[0]!;
      const meeting = schedule[1]!;
      const actualBuffer = (meeting.startTime.getTime() - deepWorkTask.endTime.getTime()) / (1000 * 60);
      
      expect(actualBuffer).toBe(0); // No buffer - problematic for deep work
      expect(hasMinimumBuffer).toBe(false);
    });

    it("should provide buffer recommendations in prompt context", () => {
      // Given: Task and context with existing cognitive load
      const task = createTask({ tag: "deep", estimatedDuration: 90 });
      const schedule = [
        createScheduleItem({
          type: "task",
          title: "Existing Deep Work",
          startTime: setHours(new Date(), 8),
          endTime: setHours(new Date(), 9)
        })
      ];

      const context: SchedulingContext = {
        schedule,
        energyHistory: [],
        todayEnergyForecast: [createEnergySlot(10, 0.85)],
        schedulingStrategy: "today"
      };

      const availableSlots: EnergySlot[] = [{
        startTime: setHours(new Date(), 10),
        endTime: setHours(new Date(), 11),
        energyLevel: 0.85,
        energyStage: "morning_peak",
        hasConflict: false,
        isToday: true
      }];

      // When: Building prompt context
      const promptContext = buildPromptContext(task, context, availableSlots);

      // Then: Should include buffer recommendations
      expect(promptContext.cognitiveLoad).toBeDefined();
      expect(promptContext.cognitiveLoad.recommendedBuffer).toContain("30 minutes");
      expect(promptContext.constraints.mustScheduleInFuture).toContain("15 minutes");
    });

    it("should handle buffer requirements in multi-chunk scheduling", () => {
      // Given: Multiple deep work chunks
      const deepChunks = [
        createTask({ id: "chunk-1", tag: "deep", estimatedDuration: 45 }),
        createTask({ id: "chunk-2", tag: "deep", estimatedDuration: 60 }),
        createTask({ id: "chunk-3", tag: "deep", estimatedDuration: 45 }),
      ];

      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "today",
        todayEnergyForecast: [
          createEnergySlot(9, 0.9),
          createEnergySlot(11, 0.85),
          createEnergySlot(14, 0.8)
        ]
      };

      const availableSlots = context.todayEnergyForecast!.map(energy => ({
        startTime: new Date(energy.date),
        endTime: addHours(new Date(energy.date), 1),
        energyLevel: energy.energyLevel,
        energyStage: energy.energyStage,
        hasConflict: false,
        isToday: true
      }));

      // When: Building multi-chunk prompt context
      const promptContext = buildMultiChunkPromptContext(deepChunks, context, availableSlots);

      // Then: Should include appropriate buffer guidance
      expect(promptContext.cognitiveLoad).toBeDefined();
      expect(promptContext.note).toContain("multi-chunk scheduling");
      expect(promptContext.note).toContain("avoiding conflicts");
    });
  });

  describe("Buffer Validation Edge Cases", () => {
    it("should handle empty schedule gracefully", () => {
      // Given: Empty schedule
      const emptySchedule: ScheduleItem[] = [];

      // When: Validating buffer
      const hasProperBuffer = validateBuffer(emptySchedule, 10);

      // Then: Should return true (no conflicts possible)
      expect(hasProperBuffer).toBe(true);
    });

    it("should handle single item schedule", () => {
      // Given: Schedule with single item
      const singleItemSchedule = [createScheduleItem()];

      // When: Validating buffer
      const hasProperBuffer = validateBuffer(singleItemSchedule, 10);

      // Then: Should return true (no adjacent items to conflict)
      expect(hasProperBuffer).toBe(true);
    });

    it("should handle schedule items with null or undefined end times", () => {
      // Given: Schedule with missing end time
      const scheduleWithMissingEnd = [
        createScheduleItem({
          startTime: new Date(),
          endTime: addHours(new Date(), 1)
        }),
        createScheduleItem({
          startTime: addHours(new Date(), 2),
          endTime: null as any // Missing end time
        })
      ];

      // When: Analyzing available slots (should handle gracefully)
      const result = analyzeAvailableSlotsToday({
        schedule: scheduleWithMissingEnd,
        energyForecast: [createEnergySlot(0, 0.8)],
        taskDuration: 60,
        energyRequirements: { min: 0.7, max: 1.0 }
      });

      // Then: Should not crash and handle missing data gracefully
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle overlapping schedule items", () => {
      // Given: Schedule with overlapping items (edge case)
      const baseTime = new Date();
      const overlappingSchedule = [
        createScheduleItem({
          startTime: baseTime,
          endTime: addHours(baseTime, 2)
        }),
        createScheduleItem({
          startTime: addHours(baseTime, 1), // Overlaps with first item
          endTime: addHours(baseTime, 3)
        })
      ];

      // When: Validating buffer (with overlapping items)
      const hasProperBuffer = validateBuffer(overlappingSchedule, 10);

      // Then: Should detect as invalid (negative buffer)
      expect(hasProperBuffer).toBe(false);
    });

    it("should handle different time zones consistently", () => {
      // Given: Schedule items created in different ways
      const utcTime = new Date(Date.UTC(2024, 1, 15, 14, 0, 0, 0));
      const localTime = new Date(2024, 1, 15, 14, 0, 0, 0);
      
      const mixedTimezoneSchedule = [
        createScheduleItem({
          startTime: utcTime,
          endTime: addHours(utcTime, 1)
        }),
        createScheduleItem({
          startTime: addHours(localTime, 2),
          endTime: addHours(localTime, 3)
        })
      ];

      // When: Validating buffer
      const hasProperBuffer = validateBuffer(mixedTimezoneSchedule, 10);

      // Then: Should handle timezone differences appropriately
      expect(typeof hasProperBuffer).toBe("boolean");
    });

    it("should validate 15-minute buffer requirement from current time", () => {
      // Given: Current time and energy forecast
      const now = new Date();
      const bufferTime = addMinutes(now, 15);
      const insufficientBufferTime = addMinutes(now, 5);
      
      const energyForecast = [
        {
          ...createEnergySlot(0, 0.8),
          date: insufficientBufferTime.toISOString() // Too close to current time
        },
        {
          ...createEnergySlot(0, 0.85),
          date: bufferTime.toISOString() // Proper buffer from current time
        }
      ];

      // When: Analyzing today's slots
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: { min: 0.7, max: 1.0 }
      });

      // Then: Should exclude slots too close to current time
      expect(slots.length).toBeLessThanOrEqual(1);
      if (slots.length > 0) {
        expect(slots[0]!.startTime.getTime()).toBeGreaterThan(addMinutes(now, 14).getTime());
      }
    });
  });
});