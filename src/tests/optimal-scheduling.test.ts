import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addMinutes, startOfDay, differenceInMinutes, isSameDay, addDays, addHours, setHours, isAfter, isBefore, setMinutes } from "date-fns";
import { 
  getAvailableSlotsForContext,
  needsInitialScheduling,
  shouldAutoReschedule,
  determineTargetDate,
  isDateOnlyWithoutTime,
  determineSchedulingStrategy,
  calculateSchedulingWindow,
  getEnergyRequirementsForTask,
  generateFlexibleMultiDaySlots,
  analyzeAvailableSlotsToday,
  getOptimalEnergyStagesForTask,
  analyzeAvailableSlotsFuture
} from "../smart.js";
import type { EnergySelect, HistoricalEnergyPattern, ScheduleItem, SchedulingContext, TaskSelect } from "../smart.js";

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

import TestUtils from "./test-utilities.js";

describe("Smart Scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // https://linear.app/rivva/issue/RIVPRD-162/smart-scheduling-20-issue-1-basic-smart-scheduling-decision-engine
  describe("Basic Smart Scheduling Decision Engine", () => { 
    it("should schedule for the same day when an optimal slot is available", () => {
      // Set a fixed test date to ensure consistent results
      const fixedTestDate = new Date(2024, 5, 15, 8, 0, 0); // June 15, 2024 at 8:00 AM
      vi.setSystemTime(fixedTestDate);
      
      // Given: We have a task with a start date (but no time)
      const startDate = startOfDay(fixedTestDate);
      const task = TestUtils.createTestTask({
        startTime: startDate,
        priority: 5, // high priority
        estimatedDuration: 60, // 60 minutes
      });
    
      // And: We have energy and calendar data
      const meetingTime = setHours(startDate, 10); // Meeting at 10am
      
      // Mock a calendar with a meeting at 10am (high energy time)
      const schedule = [
        TestUtils.createTestScheduleItem({
          startTime: meetingTime,
          endTime: addHours(meetingTime, 1),
          type: "event", // Meeting as calendar event
        }),
      ];
      
      // Energy pattern showing 10am and 2pm as good energy times
      const historicalPatterns = [
        { hour: 10, averageEnergy: 0.9 }, // Morning peak (blocked by meeting)
        { hour: 14, averageEnergy: 0.8 }, // Afternoon rebound
      ];
      
      const context = TestUtils.createTestSchedulingContext({
        schedule,
        targetDate: startDate,
        historicalPatterns,
      });
      
      // When: We determine the best slot for the task
      const availableSlots = getAvailableSlotsForContext(context, task.estimatedDuration, { min: 0.7, max: 1.0 });
      
      // Then: It should be scheduled optimally
      expect(availableSlots.length).toBeGreaterThan(0);
      const bestSlot = availableSlots[0];
      expect(bestSlot).toBeDefined();
      
      // Since the 10am slot on the current day is blocked by a meeting,
      // and we only have patterns for 10am and 2pm,
      // the best slot should be either 2pm today or 10am tomorrow
      
      // If scheduled today, it must be at 2pm (14:00)
      expect(isSameDay(bestSlot.startTime, startDate)).toBe(true);
      expect(bestSlot.startTime.getHours()).toBe(14);
    });

    it("should schedule for the next day if no optimal slots are available today", () => {
      // Set a fixed test date to ensure consistent results
      const fixedTestDate = new Date(2024, 5, 15, 8, 0, 0); // June 15, 2024 at 8:00 AM
      vi.setSystemTime(fixedTestDate);
      
      // Given: We have a task with a start date (but no time)
      const startDate = startOfDay(fixedTestDate);
      const task = TestUtils.createTestTask({
        startTime: startDate,
        priority: 5, // high priority
        estimatedDuration: 60, // 60 minutes
      });
    
      // And: We have energy and calendar data, with meetings blocking optimal times today
      const meetingTime1 = setHours(startDate, 10); // Meeting at 10am
      const meetingTime2 = setHours(startDate, 14); // Meeting at 2pm
      
      const schedule = [
        TestUtils.createTestScheduleItem({
          startTime: meetingTime1,
          endTime: addHours(meetingTime1, 1),
          type: "event",
        }),
        TestUtils.createTestScheduleItem({
          startTime: meetingTime2,
          endTime: addHours(meetingTime2, 1),
          type: "event",
        }),
      ];
      
      // Energy pattern showing 10am and 2pm as good energy times
      const historicalPatterns = [
        { hour: 10, averageEnergy: 0.9 }, // Morning peak (blocked by meeting)
        { hour: 14, averageEnergy: 0.8 }, // Afternoon rebound (blocked by meeting)
      ];
      
      const context = TestUtils.createTestSchedulingContext({
        schedule,
        targetDate: startDate,
        historicalPatterns,
      });
      
      // When: We determine the best slot for the task
      const availableSlots = getAvailableSlotsForContext(context, task.estimatedDuration, { min: 0.7, max: 1.0 });
      
      // Then: It should be scheduled for the next day at 10am
      expect(availableSlots.length).toBeGreaterThan(0);
      const bestSlot = availableSlots[0];
      expect(bestSlot).toBeDefined();
      
      const nextDay = addDays(startDate, 1);
      expect(isSameDay(bestSlot.startTime, nextDay)).toBe(true);
      expect(bestSlot.startTime.getHours()).toBe(10);
    });

    it("should maintain a 10-minute buffer around meetings for same-day scheduling", () => {
      // Set a fixed test date for consistent results
      const fixedTestDate = new Date(2024, 5, 15, 8, 0, 0);
      vi.setSystemTime(fixedTestDate);
      
      // Given: We have a meeting at 10am
      const today = fixedTestDate;
      const meetingTime = setHours(startOfDay(today), 10);
      const meeting = TestUtils.createTestScheduleItem({
        startTime: meetingTime,
        endTime: addHours(meetingTime, 1),
        type: "event", // Calendar event type
        title: "Important Meeting"
      });
      
      // And: A task to be scheduled
      const task = TestUtils.createTestTask({
        startTime: startOfDay(today),
        estimatedDuration: 30, // 30 minute task
      });
      
      // When: We get available slots
      const context = TestUtils.createTestSchedulingContext({
        schedule: [meeting],
        targetDate: startOfDay(today),
        historicalPatterns: [
          { hour: 9, averageEnergy: 0.8 }, // Good time before meeting
          { hour: 11, averageEnergy: 0.8 }, // Right after meeting
        ],
      });
      
      const availableSlots = getAvailableSlotsForContext(context, task.estimatedDuration, { min: 0.7, max: 1.0 });
      
      // Then: No slots should immediately precede or follow the meeting within 10 minutes
      expect(availableSlots.length).toBeGreaterThan(0);
      
      // Rather than checking every slot (which might include slots from other days or times),
      // we'll focus on finding slots that are close to our meeting and verify those maintain the buffer
      const meetingDate = startOfDay(meeting.startTime);
      const sameDaySlots = availableSlots.filter(slot => isSameDay(slot.startTime, meetingDate));
      
      // Verify we have available slots
      expect(availableSlots.length).toBeGreaterThan(0);
      
      // Verify we have slots on the same day and check their buffer times
      expect(sameDaySlots.length).toBeGreaterThan(0);

      for (const slot of sameDaySlots) {
        // Check if slot is too close to meeting start
        const slotEnd = addMinutes(slot.startTime, task.estimatedDuration);
        const bufferBeforeMeeting = differenceInMinutes(meeting.startTime, slotEnd);
        
        // Check if slot is too close to meeting end
        const bufferAfterMeeting = differenceInMinutes(slot.startTime, meeting.endTime);
        
        // For slots that are actually near the meeting (not in a different part of the day)
        // either the buffer should be negative (no overlap) or >= 10 minutes
        if (bufferAfterMeeting >= 0 && bufferAfterMeeting < 60) { 
          // Verify that no slot starts within 10 minutes of meeting end
          expect(bufferAfterMeeting).toBeGreaterThanOrEqual(10);
        }

        // Similarly, check for buffer before the meeting
        if (bufferBeforeMeeting >= 0 && bufferBeforeMeeting < 60) {
            expect(bufferBeforeMeeting).toBeGreaterThanOrEqual(10);
        }
      }
    });

    it("should schedule on another day if same-day slots violate buffer rules", () => {
      // Given: A meeting at 10am that has events scheduled too close to it
      const today = new Date(2024, 5, 15, 8, 0, 0);
      vi.setSystemTime(today);
      const meetingTime = setHours(startOfDay(today), 10);

      const schedule = [
        // The main meeting
        TestUtils.createTestScheduleItem({
          startTime: meetingTime, // 10:00
          endTime: addHours(meetingTime, 1), // 11:00
        }),
        // A conflicting event that ends 5 minutes before the main meeting
        TestUtils.createTestScheduleItem({
          startTime: addMinutes(meetingTime, -35), // 9:25
          endTime: addMinutes(meetingTime, -5), // 9:55
        }),
        // A conflicting event that starts 5 minutes after the main meeting
        TestUtils.createTestScheduleItem({
          startTime: addMinutes(addHours(meetingTime, 1), 5), // 11:05
          endTime: addMinutes(addHours(meetingTime, 1), 35), // 11:35
        }),
      ];

      // And: A task to be scheduled
      const task = TestUtils.createTestTask({
        startTime: startOfDay(today),
        estimatedDuration: 30,
      });

      // And: Energy patterns that would otherwise suggest scheduling today
      const historicalPatterns = [
        { hour: 9, averageEnergy: 0.9 },
        { hour: 11, averageEnergy: 0.9 },
      ];

      const context = TestUtils.createTestSchedulingContext({
        schedule,
        targetDate: startOfDay(today),
        historicalPatterns,
      });

      // When: We get available slots
      const availableSlots = getAvailableSlotsForContext(context, task.estimatedDuration, { min: 0.7, max: 1.0 });

      // Then: The best slot should not be on the same day
      expect(availableSlots.length).toBeGreaterThan(0);
      const bestSlot = availableSlots[0];
      expect(isSameDay(bestSlot.startTime, today)).toBe(false);
    });
  });

  // https://linear.app/rivva/issue/RIVPRD-163/smart-scheduling-20-issue-2-date-range-scheduling
  describe("it should not be smart-scheduled if a specific start date and time are set", () => {
    it("should not schedule tasks without start date or deadline", () => {
    // Given: A task with no start date or deadline
    const task = TestUtils.createTestTask({
      id: "task-without-dates",
      title: "Task with no dates",
      priority: 3,
      estimatedDuration: 60,
      tag: "deep",
      isAutoSchedule: true,
      // No startTime or endTime defined
    });

    // When: We check if it needs scheduling
    const needsScheduling = needsInitialScheduling(task);
    const shouldReschedule = shouldAutoReschedule(task);

    // Then: It should not need scheduling
    expect(needsScheduling).toBe(false);
    expect(shouldReschedule).toBe(false);

    // And: Attempting to get target date should return null
    const targetDate = determineTargetDate(task);
    expect(targetDate).toBeNull();
    });

    it("should not be smart-scheduled if a specific start date and time are set", () => {
      // Given: A task with a specific start date and time
      const specificStartTime = new Date(2024, 5, 20, 10, 30, 0);
      const task = TestUtils.createTestTask({ startTime: specificStartTime });
  
      // When: We check if the start time is date-only
      const isDateOnly = isDateOnlyWithoutTime(task.startTime);
      const needsScheduling = needsInitialScheduling(task);
  
      // Then: It should be recognized as having a specific time and not need scheduling
      expect(isDateOnly).toBe(false);
      expect(needsScheduling).toBe(false);
    });

    it("should be smart-scheduled between a start date and a deadline", () => {
      // Given: A mocked current time
      const mockCurrentTime = TestUtils.TestDateUtils.createDateOnly(2024, 6, 1);
      vi.setSystemTime(mockCurrentTime);
  
      // And: A task with a start date and a deadline
      const startDate = TestUtils.TestDateUtils.createDateOnly(2024, 6, 3);
      const deadlineDate = TestUtils.TestDateUtils.createDateOnly(2024, 6, 5);
      const task = TestUtils.createTestTask({
        startTime: startDate,
        endTime: deadlineDate,
        estimatedDuration: 60,
        tag: "deep",
      });
  
      // And: A schedule with some events and historical energy patterns
      const schedule: ScheduleItem[] = [
        TestUtils.createTestScheduleItem({
          title: "Conflict on Day 1",
          startTime: setHours(startDate, 10),
          endTime: setHours(startDate, 11),
          type: "event",
        }),
      ];
      const historicalPatterns = [
        { hour: 10, averageEnergy: 0.5 }, // Low energy / conflict
        { hour: 14, averageEnergy: 0.9 }, // Optimal slot on a future day
      ];
  
      // When: We find the best available slot
      const resolvedTargetDate = determineTargetDate(task);
      const schedulingStrategy = determineSchedulingStrategy(resolvedTargetDate);
      const context: SchedulingContext = {
        schedule,
        energyHistory: [],
        historicalPatterns,
        schedulingStrategy: schedulingStrategy.strategy,
        targetDate: resolvedTargetDate,
      };
      const availableSlots = getAvailableSlotsForContext(context, task.estimatedDuration, { min: 0.7, max: 1.0 });
  
      // Then: The best slot should be within the start and deadline dates
      expect(availableSlots.length).toBeGreaterThan(0);
      const bestSlot = availableSlots[0];
      
      // Debug information
      console.log('Best slot selected:', {
        date: bestSlot.startTime.toISOString(),
        hour: bestSlot.startTime.getHours(),
        startDate: startDate.toISOString(),
        deadlineDate: deadlineDate.toISOString(),
      });
      
      // Verify slot is within start and deadline window
      expect(isAfter(bestSlot.startTime, startDate) || isSameDay(bestSlot.startTime, startDate)).toBe(true);
      expect(isBefore(bestSlot.startTime, deadlineDate) || isSameDay(bestSlot.startTime, deadlineDate)).toBe(true);
      
      // Verify it's scheduled at the optimal energy time (14:00)
      // The exact day may vary depending on algorithm optimizations
      expect(bestSlot.startTime.getHours()).toBe(14);
    });
  });
    
  // https://linear.app/rivva/issue/RIVPRD-163/smart-scheduling-20-issue-2-date-range-scheduling
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

  // https://linear.app/rivva/issue/RIVPRD-164/smart-scheduling-20-issue-3-energy-window-integration
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

  // https://linear.app/rivva/issue/RIVPRD-164/smart-scheduling-20-issue-3-energy-window-integration
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

  // https://linear.app/rivva/issue/RIVPRD-165/smart-scheduling-20-issue-4-sleep-window-and-constraint-management
  describe("AC: Scheduling exclusion and constraint management", () => {
    it("should handle scenarios with no available time slots", () => {
    // Given: A date with all time slots filled with events
    const targetDate = addDays(new Date(), 1);
    const schedule: ScheduleItem[] = [];

    // Fill the entire day with events (8am to 8pm)
    for (let hour = 8; hour < 20; hour++) {
      schedule.push(TestUtils.createTestScheduleItem({
        title: `Meeting at ${hour}:00`,
        startTime: setHours(targetDate, hour),
        endTime: setHours(targetDate, hour + 1),
        type: "event"
      }));
    }

    // When: Trying to find slots for a task on that day
    const context: SchedulingContext = {
      schedule,
      energyHistory: [],
      schedulingStrategy: "future",
      targetDate,
      historicalPatterns: [
        { hour: 9, averageEnergy: 0.8 },
        { hour: 14, averageEnergy: 0.7 }
      ]
    };

    // Then: No available slots should be found
    const availableSlots = getAvailableSlotsForContext(context, 60, { min: 0.3, max: 1.0 });
    expect(availableSlots.length).toBe(0);
    });

    it("should not displace higher priority smart-scheduled tasks", () => {
    // Given: A target date with a high priority task already scheduled
    const targetDate = addDays(new Date(), 1);

    // And: A high priority task already scheduled at 10am
    const highPriorityTask = TestUtils.createTestScheduleItemWithTaskProperties({
      id: "high-priority-task",
      title: "High Priority Task",
      startTime: setHours(targetDate, 10),
      endTime: setHours(targetDate, 11),
      type: "task",
      priority: 5, // High priority
      isAutoSchedule: true
    });

    // And: A schedule with the high priority task
    const schedule: ScheduleItem[] = [highPriorityTask];

    // When: Trying to schedule a medium priority task that overlaps
    const context: SchedulingContext = {
      schedule,
      energyHistory: [],
      schedulingStrategy: "future",
      targetDate,
      historicalPatterns: [
        { hour: 10, averageEnergy: 0.9 }, // Best time is 10am, but already taken by higher priority
        { hour: 14, averageEnergy: 0.6 }  // Alternative time
      ]
    };

    // Then: The available slots should not include the 10am slot (high priority occupied)
    const availableSlots = getAvailableSlotsForContext(context, 60, { min: 0.5, max: 1.0 });

    // Should return the 14:00 slot instead
    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === 10 && 
      isSameDay(slot.startTime, targetDate)
    )).toBe(false);

    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === 14 && 
      isSameDay(slot.startTime, targetDate)
    )).toBe(true);
    });

    it("should not displace manually scheduled tasks", () => {
    // Given: A target date with a manually scheduled task
    const targetDate = addDays(new Date(), 1);

    // And: A manually scheduled task at 10am
    const manualTask = TestUtils.createTestScheduleItemWithTaskProperties({
      id: "manual-task",
      title: "Manually Scheduled Task",
      startTime: setHours(targetDate, 10),
      endTime: setHours(targetDate, 11),
      type: "task",
      isAutoSchedule: false // Manually scheduled
    });

    // And: A schedule with the manually scheduled task
    const schedule: ScheduleItem[] = [manualTask];

    // When: Trying to schedule a task that would ideally go in the 10am slot
    const context: SchedulingContext = {
      schedule,
      energyHistory: [],
      schedulingStrategy: "future",
      targetDate,
      historicalPatterns: [
        { hour: 10, averageEnergy: 0.9 }, // Best time is 10am, but taken by manual task
        { hour: 14, averageEnergy: 0.6 }  // Alternative time
      ]
    };

    // Then: The available slots should not include the 10am slot (manually scheduled)
    const availableSlots = getAvailableSlotsForContext(context, 60, { min: 0.5, max: 1.0 });

    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === 10 && 
      isSameDay(slot.startTime, targetDate)
    )).toBe(false);

    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === 14 && 
      isSameDay(slot.startTime, targetDate)
    )).toBe(true);
    });

    it("should not schedule tasks during sleep windows", () => {
    // Given: Energy forecast including early morning hours (sleep time)
    const targetDate = addDays(new Date(), 1);
    const sleepHour = 3; // 3 AM (sleep time)
    const workHour = 9;  // 9 AM (work time)

    // And: Historical patterns with sleep window marked by very low energy
    const historicalPatterns: HistoricalEnergyPattern[] = [
      { hour: sleepHour, averageEnergy: 0.1 }, // Sleep window - very low energy
      { hour: workHour, averageEnergy: 0.8 }   // Work hours - high energy
    ];

    // When: Getting available slots for scheduling
    const context: SchedulingContext = {
      schedule: [],
      energyHistory: [],
      schedulingStrategy: "future",
      targetDate,
      historicalPatterns
    };

    const availableSlots = getAvailableSlotsForContext(
      context, 
      60, 
      { min: 0.3, max: 1.0 } // Even with low minimum energy requirement
    );

    // Then: No slots should be available during sleep windows
    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === sleepHour
    )).toBe(false);

    // But work hour slots should be available
    expect(availableSlots.some(slot => 
      slot.startTime.getHours() === workHour
    )).toBe(true);
    });
  });

  // https://linear.app/rivva/issue/RIVPRD-165/smart-scheduling-20-issue-4-sleep-window-and-constraint-management
  describe("AC: High priority task with today deadline can use early wind-down when no other time available", () => {
    it("should schedule high priority task with today deadline in early wind-down phase when all other times are blocked", () => {
      // Setup: Mock current time to early afternoon
      const mockDate = new Date(2024, 5, 15, 14, 0, 0); // 2 PM
      vi.setSystemTime(mockDate);
      const today = new Date();

      // Given: A high priority task with deadline today
      const urgentTask: TaskSelect = {
        id: "urgent-task",
        title: "Critical Deliverable",
        userId: "user-1",
        estimatedDuration: 45,
        priority: 5, // High priority
        status: "pending",
        tag: "deep", // Important work
        scheduleType: "flexible",
        isAutoSchedule: true,
        startTime: today,
        endTime: today, // Deadline is today
        createdAt: today,
        updatedAt: today,
      } as TaskSelect;

      // And: All normal work hours are blocked with meetings/tasks
      const blockedSchedule: ScheduleItem[] = [];
      
      // Block remaining work hours (2 PM to 6 PM)
      for (let hour = 14; hour <= 18; hour++) {
        blockedSchedule.push({
          id: `meeting-${hour}`,
          title: `Meeting at ${hour}:00`,
          startTime: setHours(setMinutes(today, 0), hour),
          endTime: setHours(setMinutes(today, 0), hour + 1),
          type: "event"
        });
      }

      // And: Energy forecast showing early wind-down starting at 7 PM
      const energyForecast: EnergySelect[] = [];
      
      // Add blocked hours with good energy
      for (let hour = 14; hour <= 18; hour++) {
        energyForecast.push({
            id: `energy-${hour}`,
            userId: "user-1",
            date: setHours(today, hour).toISOString(),
            hour: hour,
            energyLevel: 0.8,
            energyStage: "afternoon_rebound",
            mood: "focused",
            hasManualCheckIn: false,
        } as unknown as EnergySelect);
      }

      // Add early wind-down slots (7 PM and 8 PM)
      const earlyWindDownHours = [19, 20];
      earlyWindDownHours.forEach(hour => {
        energyForecast.push({
            id: `energy-${hour}`,
            userId: "user-1",
            date: setHours(today, hour).toISOString(),
            hour: hour,
            energyLevel: 0.45, // Lower energy but still workable
            energyStage: "wind_down",
            mood: "calm",
            hasManualCheckIn: false,
        } as unknown as EnergySelect);
      });

      // When: Analyzing available slots for the urgent task
      const context: SchedulingContext = {
        schedule: blockedSchedule,
        energyHistory: [],
        todayEnergyForecast: energyForecast,
        schedulingStrategy: "today",
        targetDate: today
      };

      // For high priority + deadline today, we can lower energy requirements
      const urgentEnergyRequirements = { 
        min: 0.4, // Lowered due to urgency
        max: 1.0 
      };

      const availableSlots = getAvailableSlotsForContext(
        context,
        urgentTask.estimatedDuration,
        urgentEnergyRequirements
      );

      // Then: It should find slots in the early wind-down period
      expect(availableSlots.length).toBeGreaterThan(0);
      
      // Should use early wind-down (7 PM or 8 PM)
      const windDownSlot = availableSlots.find(slot => 
        slot.energyStage === "wind_down" && 
        (slot.startTime.getHours() === 19 || slot.startTime.getHours() === 20)
      );
      
      expect(windDownSlot).toBeDefined();
      expect(windDownSlot?.energyLevel).toBeGreaterThanOrEqual(0.4);
      expect(windDownSlot?.energyStage).toBe("wind_down");
    });
  });

  describe("Factors that trigger task rescheduling", () => {
    describe("1. Higher Priority Task", () => {
      it("should reschedule existing task when a higher priority task needs the same optimal slot", () => {
        // Setup
        const mockDate = new Date(2024, 5, 15, 8, 0, 0);
        vi.setSystemTime(mockDate);
        const today = new Date();

        // Given: An existing medium priority task scheduled at optimal time (10 AM)
        const existingTask: ScheduleItem = {
          id: "existing-task",
          title: "Medium Priority Task",
          startTime: setHours(today, 10),
          endTime: setHours(today, 11),
          type: "task",
          priority: 3, // Medium priority
          isAutoSchedule: true
        } as ScheduleItem & { priority: number; isAutoSchedule: boolean };

        // And: A new high priority task that needs scheduling
        const highPriorityTask: TaskSelect = {
          id: "high-priority-task",
          title: "Urgent Task",
          estimatedDuration: 60,
          priority: 5, // Higher priority than existing
          tag: "deep",
          isAutoSchedule: true,
          startTime: today, // Needs to be scheduled today
        } as TaskSelect;

        // And: Energy forecast showing 10 AM as the best time
        const energyForecast: EnergySelect[] = [
          createEnergySlot(9, 0.7, today),   // Good
          createEnergySlot(10, 0.95, today), // Best energy - currently occupied
          createEnergySlot(11, 0.8, today),  // Good
          createEnergySlot(14, 0.6, today),  // Okay
        ];

        // When: System evaluates if existing task should be rescheduled
        const shouldReschedule = shouldAutoReschedule(
          existingTask as unknown as TaskSelect,
          { priority: highPriorityTask.priority }
        );

        // Then: It should recognize the need to reschedule
        expect(shouldReschedule).toBe(true);

        // And: When finding slots for the high priority task
        const availableSlots = analyzeAvailableSlotsToday({
          schedule: [], // Assuming existing task would be moved
          energyForecast,
          taskDuration: 60,
          energyRequirements: getEnergyRequirementsForTask("deep")
        });

        // The 10 AM slot should be available for the high priority task
        const optimalSlot = availableSlots.find(slot => 
          slot.startTime.getHours() === 10
        );
        expect(optimalSlot).toBeDefined();
        expect(optimalSlot?.energyLevel).toBe(0.95);
      });
    });

    describe("2. Earlier Deadline", () => {
      it("should reschedule existing task when a new task has an earlier deadline", () => {
        // Given: An existing task scheduled for tomorrow
        const existingTask: TaskSelect = {
          id: "existing-task",
          title: "Regular Task",
          estimatedDuration: 60,
          priority: 3,
          tag: "deep",
          isAutoSchedule: true,
          startTime: addDays(new Date(), 1),
          endTime: addDays(new Date(), 2), // Deadline in 2 days
        } as TaskSelect;

        // And: A new task with deadline today
        const urgentDeadlineTask: TaskSelect = {
          id: "urgent-deadline-task",
          title: "Due Today Task",
          estimatedDuration: 60,
          priority: 3, // Same priority
          tag: "deep",
          isAutoSchedule: true,
          startTime: new Date(),
          endTime: new Date(), // Deadline today!
        } as TaskSelect;

        // When: Checking if rescheduling is needed based on deadline
        const needsRescheduling = shouldAutoReschedule(
          existingTask,
          { endTime: urgentDeadlineTask.endTime }
        );

        // Then: It should recognize the earlier deadline
        // Note: The current implementation focuses on priority changes,
        // but deadline urgency should also trigger rescheduling
        expect(needsRescheduling).toBe(true);
        expect(urgentDeadlineTask.endTime!.getTime()).toBeLessThan(
          existingTask.endTime!.getTime()
        );
      });
    });

    describe("3. Calendar Event Changes", () => {
      it("should reschedule task when a new meeting conflicts with its scheduled time", () => {
        // Setup
        const mockDate = new Date(2024, 5, 15, 8, 0, 0);
        vi.setSystemTime(mockDate);
        const today = new Date();

        // Given: A task scheduled at 2 PM
        const scheduledTask: TaskSelect = {
          id: "scheduled-task",
          title: "Deep Work Session",
          estimatedDuration: 90,
          priority: 3,
          tag: "deep",
          isAutoSchedule: true,
          startTime: setHours(today, 14),
          endTime: setHours(today, 15.5), // 2:00 PM - 3:30 PM
        } as TaskSelect;

        // When: A new meeting is scheduled at the same time
        const newMeeting: ScheduleItem = {
          id: "new-meeting",
          title: "Client Call",
          startTime: setHours(today, 14),
          endTime: setHours(today, 15),
          type: "event"
        };

        // And: Energy forecast for alternative times
        const energyForecast: EnergySelect[] = [
          createEnergySlot(13, 0.7, today),  // 1 PM - available
          createEnergySlot(14, 0.8, today),  // 2 PM - now blocked by meeting
          createEnergySlot(15, 0.75, today), // 3 PM - partially blocked
          createEnergySlot(16, 0.8, today),  // 4 PM - available
        ];

        // Then: Finding new slots should exclude the meeting time
        const availableSlots = analyzeAvailableSlotsToday({
          schedule: [newMeeting],
          energyForecast,
          taskDuration: scheduledTask.estimatedDuration,
          energyRequirements: getEnergyRequirementsForTask(scheduledTask.tag)
        });

        // Should not include 2 PM slot (blocked by meeting)
        const conflictSlot = availableSlots.find(slot => 
          slot.startTime.getHours() === 14
        );
        expect(conflictSlot).toBeUndefined();

        // Should have alternative slots
        expect(availableSlots.length).toBeGreaterThan(0);
        expect(availableSlots.some(slot => 
          slot.startTime.getHours() === 16
        )).toBe(true);
      });

      it("should make time available when a meeting is cancelled", () => {
        // Setup
        const today = new Date();

        // Given: A schedule with a cancelled meeting slot
        const remainingSchedule: ScheduleItem[] = [
          {
            id: "morning-meeting",
            title: "Team Standup",
            startTime: setHours(today, 9),
            endTime: setHours(today, 10),
            type: "event"
          },
          // 2 PM meeting was cancelled - slot now available
          {
            id: "afternoon-meeting",
            title: "Review Session",
            startTime: setHours(today, 16),
            endTime: setHours(today, 17),
            type: "event"
          }
        ];

        // And: Energy data showing 2 PM as high energy time
        const energyForecast: EnergySelect[] = [
          createEnergySlot(14, 0.85, today), // 2 PM - now available!
          createEnergySlot(15, 0.8, today),  // 3 PM
        ];

        // When: Looking for available slots
        const availableSlots = analyzeAvailableSlotsToday({
          schedule: remainingSchedule,
          energyForecast,
          taskDuration: 60,
          energyRequirements: { min: 0.7, max: 1.0 }
        });

        // Then: The 2 PM slot should be available
        const freedSlot = availableSlots.find(slot => 
          slot.startTime.getHours() === 14
        );
        
        expect(freedSlot).toBeDefined();
        expect(freedSlot?.hasConflict).toBe(false);
        expect(freedSlot?.energyLevel).toBe(0.85);
      });
    });
});
});

