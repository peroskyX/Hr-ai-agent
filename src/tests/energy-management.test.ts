// src/tests/energy-management.test.ts

import { addDays, addHours, setHours, setMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import type { EnergySelect, EnergySlot, HistoricalEnergyPattern, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";
import {
  getEnergyRequirementsForTask,
  getAvailableSlotsForContext,
  analyzeAvailableSlotsToday,
  analyzeAvailableSlotsFuture,
  generateFlexibleMultiDaySlots,
  getOptimalEnergyStagesForTask,
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

describe("Energy Management - Energy & Time Window Management", () => {
  describe("AC: When user has no energy/sleep data, use default chronotype", () => {
    it("should use fallback historical patterns when no energy data available", () => {
      // Given: No energy forecast or history data available
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        // No todayEnergyForecast or historicalPatterns
      };

      // When: Getting available slots
      const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

      // Then: Should return empty array (graceful fallback)
      expect(slots).toEqual([]);
    });

    it("should generate default energy patterns when no historical data", () => {
      // Given: Context with minimal data, requiring fallback to defaults
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: undefined
      };

      // When: Attempting to generate flexible slots
      const slots = generateFlexibleMultiDaySlots(context, 60, { min: 0.3, max: 1.0 });

      // Then: Should handle gracefully without crashing
      expect(slots).toEqual([]);
    });

    it("should provide appropriate energy requirements for each task type as fallback", () => {
      // When: Getting energy requirements for different task types
      const deepWorkRequirements = getEnergyRequirementsForTask("deep");
      const creativeRequirements = getEnergyRequirementsForTask("creative");
      const adminRequirements = getEnergyRequirementsForTask("admin");
      const personalRequirements = getEnergyRequirementsForTask("personal");

      // Then: Should return appropriate energy ranges as fallback
      expect(deepWorkRequirements).toEqual({ min: 0.7, max: 1.0 });
      expect(creativeRequirements).toEqual({ min: 0.4, max: 1.0 });
      expect(adminRequirements).toEqual({ min: 0.3, max: 0.7 });
      expect(personalRequirements).toEqual({ min: 0.1, max: 0.7 });
    });

    it("should use default energy range for unknown task types", () => {
      // Given: Unknown task type
      const unknownTaskType = "unknown" as any;

      // When: Getting energy requirements
      const requirements = getEnergyRequirementsForTask(unknownTaskType);

      // Then: Should return default range
      expect(requirements).toEqual({ min: 0.3, max: 1.0 });
    });
  });

  describe("AC: When user has energy/sleep data, align tasks with appropriate energy zones", () => {
    it("should filter energy slots based on task energy requirements", () => {
      // Given: Energy forecast with various energy levels
      const futureDate = addHours(new Date(), 2);
      const energyForecast = [
        createEnergySlot(futureDate.getHours(), 0.3, futureDate),     // Low energy
        createEnergySlot(futureDate.getHours() + 1, 0.8, futureDate), // High energy
        createEnergySlot(futureDate.getHours() + 2, 0.9, futureDate), // Very high energy
        createEnergySlot(futureDate.getHours() + 3, 0.5, futureDate), // Medium energy
      ];

      // When: Analyzing slots for deep work (requires high energy)
      const deepWorkSlots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: getEnergyRequirementsForTask("deep") // min: 0.7, max: 1.0
      });

      // Then: Should only return high energy slots
      expect(deepWorkSlots).toHaveLength(2);
      expect(deepWorkSlots[0]?.energyLevel).toBe(0.8);
      expect(deepWorkSlots[1]?.energyLevel).toBe(0.9);
    });

    it("should match task types to optimal energy stages", () => {
      // When: Getting optimal energy stages for different task types
      const deepWorkStages = getOptimalEnergyStagesForTask("deep");
      const creativeStages = getOptimalEnergyStagesForTask("creative");
      const adminStages = getOptimalEnergyStagesForTask("admin");
      const personalStages = getOptimalEnergyStagesForTask("personal");

      // Then: Should return appropriate energy stages
      expect(deepWorkStages).toEqual(["morning_peak"]);
      expect(creativeStages).toEqual(["morning_peak", "afternoon_rebound"]);
      expect(adminStages).toEqual(["midday_dip"]);
      expect(personalStages).toEqual(["midday_dip", "wind_down"]);
    });

    it("should use historical patterns for future scheduling when available", () => {
      // Given: Context with historical energy patterns
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        targetDate: addDays(new Date(), 2),
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.85 },  // Morning peak
          { hour: 14, averageEnergy: 0.5 },  // Midday dip
          { hour: 16, averageEnergy: 0.75 }, // Afternoon rebound
        ]
      };

      // When: Getting slots for deep work
      const slots = getAvailableSlotsForContext(
        context, 
        90, 
        getEnergyRequirementsForTask("deep")
      );

      // Then: Should return high energy slots only
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every(slot => slot.energyLevel >= 0.7)).toBe(true);
      expect(slots[0]?.isHistorical).toBe(true);
    });

    it("should prioritize morning peak for creative tasks", () => {
      // Given: Historical patterns with morning peak
      const targetDate = addDays(new Date(), 1);
      const historicalPatterns: HistoricalEnergyPattern[] = [
        { hour: 9, averageEnergy: 0.9 },   // Morning peak
        { hour: 13, averageEnergy: 0.4 },  // Midday dip
        { hour: 15, averageEnergy: 0.7 },  // Afternoon rebound
      ];

      // When: Analyzing future slots for creative task
      const slots = analyzeAvailableSlotsFuture({
        schedule: [],
        targetDate,
        taskDuration: 60,
        energyRequirements: getEnergyRequirementsForTask("creative"), // min: 0.4
        historicalPatterns
      });

      // Then: Should include morning peak and afternoon rebound
      expect(slots.length).toBeGreaterThanOrEqual(2);
      expect(slots.some(slot => slot.energyLevel === 0.9)).toBe(true); // Morning peak
      expect(slots.some(slot => slot.energyLevel === 0.7)).toBe(true); // Afternoon rebound
    });
  });

  describe("AC: Tasks should not be scheduled during sleep windows", () => {
    it("should exclude past time slots and very early morning (sleep window)", () => {
      // Given: Energy forecast including early morning hours (sleep time)
      const now = new Date();
      const earlyMorning = setHours(setMinutes(now, 0), 3); // 3 AM (sleep time)
      const normalMorning = setHours(setMinutes(now, 0), 9); // 9 AM (normal time)
      
      const energyForecast = [
        createEnergySlot(3, 0.2, earlyMorning),   // Sleep window - low energy
        createEnergySlot(9, 0.8, normalMorning), // Normal hours - high energy
      ];

      // When: Analyzing available slots
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: { min: 0.3, max: 1.0 }
      });

      // Then: Should exclude sleep window slots and past slots
      expect(slots.length).toBeLessThanOrEqual(1);
      if (slots.length > 0) {
        expect(slots[0]?.startTime.getTime()).toBeGreaterThan(now.getTime());
        expect(slots[0]?.energyLevel).toBeGreaterThanOrEqual(0.3);
      }
    });

    it("should filter out energy slots below minimum requirements (sleep-like states)", () => {
      // Given: Energy forecast with very low energy levels (sleep-like)
      const futureDate = addHours(new Date(), 2);
      const energyForecast = [
        createEnergySlot(futureDate.getHours(), 0.1, futureDate),     // Sleep-like energy
        createEnergySlot(futureDate.getHours() + 1, 0.8, futureDate), // Normal energy
      ];

      // When: Analyzing slots for admin tasks (min energy 0.3)
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: getEnergyRequirementsForTask("admin") // min: 0.3
      });

      // Then: Should exclude very low energy slots
      expect(slots).toHaveLength(1);
      expect(slots[0]?.energyLevel).toBe(0.8);
    });

    it("should respect energy stage constraints for sleep phases", () => {
      // Given: Energy data including sleep phase
      const futureDate = addHours(new Date(), 2);
      const energyForecast = [
        {
          ...createEnergySlot(futureDate.getHours(), 0.2, futureDate),
          energyStage: "sleep_phase"
        },
        {
          ...createEnergySlot(futureDate.getHours() + 1, 0.8, futureDate),
          energyStage: "morning_peak"
        }
      ];

      // When: Getting available slots
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: { min: 0.3, max: 1.0 }
      });

      // Then: Should exclude sleep phase
      expect(slots.length).toBeLessThanOrEqual(1);
      if (slots.length > 0) {
        expect(slots[0]?.energyStage).not.toBe("sleep_phase");
      }
    });
  });

  describe("AC: High priority tasks with today deadline can use early wind-down", () => {
    it("should allow scheduling in wind-down phase for urgent high priority tasks", () => {
      // Given: Energy forecast including wind-down phase
      const now = new Date();
      const windDownHour = setHours(setMinutes(now, 0), 21); // 9 PM - wind down time
      
      const energyForecast = [
        {
          ...createEnergySlot(21, 0.4, windDownHour),
          energyStage: "wind_down"
        }
      ];

      // When: Analyzing for personal tasks (which can use wind-down)
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 60,
        energyRequirements: getEnergyRequirementsForTask("personal") // min: 0.1, max: 0.7
      });

      // Then: Should include wind-down slots for appropriate tasks
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0]?.energyStage).toBe("wind_down");
    });

    it("should validate personal tasks can use wind-down energy stages", () => {
      // Given: Personal task energy requirements and stages
      const personalEnergyReqs = getEnergyRequirementsForTask("personal");
      const personalOptimalStages = getOptimalEnergyStagesForTask("personal");

      // When: Checking if wind-down is acceptable
      const windDownEnergyLevel = 0.4; // Typical wind-down energy

      // Then: Should be within acceptable range for personal tasks
      expect(windDownEnergyLevel).toBeGreaterThanOrEqual(personalEnergyReqs.min);
      expect(windDownEnergyLevel).toBeLessThanOrEqual(personalEnergyReqs.max);
      expect(personalOptimalStages).toContain("wind_down");
    });

    it("should not schedule deep work during wind-down even for urgent tasks", () => {
      // Given: Energy forecast with only wind-down available
      const windDownTime = addHours(new Date(), 2);
      const energyForecast = [
        {
          ...createEnergySlot(windDownTime.getHours(), 0.4, windDownTime),
          energyStage: "wind_down"
        }
      ];

      // When: Analyzing for deep work tasks
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast,
        taskDuration: 90,
        energyRequirements: getEnergyRequirementsForTask("deep") // min: 0.7, max: 1.0
      });

      // Then: Should not return any slots (energy too low)
      expect(slots).toHaveLength(0);
    });
  });

  describe("Multi-day Energy Pattern Generation", () => {
    it("should generate slots across multiple days when no specific target date", () => {
      // Given: Context for multi-day scheduling
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.85 },
          { hour: 14, averageEnergy: 0.6 }
        ]
      };

      // When: Generating flexible multi-day slots
      const slots = generateFlexibleMultiDaySlots(context, 60, { min: 0.7, max: 1.0 });

      // Then: Should generate slots across 7 days
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.length).toBeLessThanOrEqual(7); // One high-energy slot per day for 7 days
      
      // Verify slots span multiple days
      const uniqueDays = new Set(slots.map(slot => slot.startTime.toDateString()));
      expect(uniqueDays.size).toBeGreaterThan(1);
    });

    it("should maintain energy requirements across multi-day generation", () => {
      // Given: Context with mixed energy patterns
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.9 },   // High energy - should include
          { hour: 13, averageEnergy: 0.4 },  // Low energy - should exclude for deep work
          { hour: 15, averageEnergy: 0.8 },  // High energy - should include
        ]
      };

      // When: Generating slots for deep work
      const slots = generateFlexibleMultiDaySlots(
        context, 
        90, 
        getEnergyRequirementsForTask("deep")
      );

      // Then: Should only include high energy slots
      expect(slots.every(slot => slot.energyLevel >= 0.7)).toBe(true);
      expect(slots.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty energy forecast gracefully", () => {
      // Given: Empty energy forecast
      const emptyForecast: EnergySelect[] = [];

      // When: Analyzing slots
      const slots = analyzeAvailableSlotsToday({
        schedule: [],
        energyForecast: emptyForecast,
        taskDuration: 60,
        energyRequirements: { min: 0.3, max: 1.0 }
      });

      // Then: Should return empty array without error
      expect(slots).toEqual([]);
    });

    it("should handle missing historical patterns gracefully", () => {
      // Given: Context without historical patterns
      const context: SchedulingContext = {
        schedule: [],
        energyHistory: [],
        schedulingStrategy: "future",
        targetDate: addDays(new Date(), 1)
        // No historicalPatterns
      };

      // When: Getting available slots
      const slots = getAvailableSlotsForContext(context, 60, { min: 0.7, max: 1.0 });

      // Then: Should handle gracefully
      expect(slots).toEqual([]);
    });

    it("should validate energy level bounds", () => {
      // Given: Various task types
      const taskTypes = ["deep", "creative", "admin", "personal"] as const;

      // When: Getting energy requirements
      const requirements = taskTypes.map(type => getEnergyRequirementsForTask(type));

      // Then: All requirements should be within valid bounds (0-1)
      requirements.forEach(req => {
        expect(req.min).toBeGreaterThanOrEqual(0);
        expect(req.min).toBeLessThanOrEqual(1);
        expect(req.max).toBeGreaterThanOrEqual(0);
        expect(req.max).toBeLessThanOrEqual(1);
        expect(req.min).toBeLessThanOrEqual(req.max);
      });
    });
  });
});