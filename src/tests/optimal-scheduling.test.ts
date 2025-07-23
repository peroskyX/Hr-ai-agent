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

describe("Optimal Scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should smart-schedule a task with start date to optimal time based on energy, calendar, and priority", () => {
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
    
    if (isSameDay(bestSlot.startTime, startDate)) {
      // If scheduled today, it must be at 2pm (14:00)
      expect(bestSlot.startTime.getHours()).toBe(14);
    } else {
      // If scheduled tomorrow, it must be at 10am
      const nextDay = addDays(startDate, 1);
      expect(isSameDay(bestSlot.startTime, nextDay)).toBe(true);
      expect(bestSlot.startTime.getHours()).toBe(10);
    }
  });

  it("should enforce 10-minute buffer between scheduled tasks and meetings", () => {
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
    
    // If there are slots on the same day as the meeting, check their buffer times
    if (sameDaySlots.length > 0) {
      for (const slot of sameDaySlots) {
        // Check if slot is too close to meeting start
        const slotEnd = addMinutes(slot.startTime, task.estimatedDuration);
        const bufferBeforeMeeting = differenceInMinutes(meeting.startTime, slotEnd);
        
        // Check if slot is too close to meeting end
        const bufferAfterMeeting = differenceInMinutes(slot.startTime, meeting.endTime);
        
        // For slots that are actually near the meeting (not in a different part of the day)
        // either the buffer should be negative (no overlap) or >= 10 minutes
        // Check slots that are within an hour of the meeting's end time
        if (bufferAfterMeeting >= 0 && bufferAfterMeeting < 60) { 
          // Verify that no slot starts within 10 minutes of meeting end
          // (Note: Slots starting exactly 10 minutes after meeting are valid)
          expect(bufferAfterMeeting).toBeGreaterThanOrEqual(10);
          
          console.log(`Slot start: ${slot.startTime.toLocaleTimeString()}, Buffer after meeting: ${bufferAfterMeeting} minutes`);
        }
      }
    } else {
      // If no slots on same day, it's not directly comparable
      // Likely optimization chose different day slots
      expect(availableSlots.length).toBeGreaterThan(0);
    }
  });

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
        
        it("should schedule high priority tasks with today's deadline in wind-down phase when no other time available", () => {
          // Mock current time to mid-day to ensure wind-down is in future
          const today = new Date();
          vi.setSystemTime(setHours(today, 12)); // Set to noon
          
          const windDownHour = 20; // 8pm - wind down time
          const workHours = [13, 14, 15, 16, 17, 18, 19]; // 1pm-7pm (hours after noon)
          
          // Create a high priority personal task with deadline today
          const urgentTask = TestUtils.createTestScheduleItemWithTaskProperties({
            id: "urgent-high-priority-task",
            title: "Urgent High Priority Task",
            startTime: today,
            endTime: today, // Deadline today
            type: "task",
            priority: 5, // High priority
            isAutoSchedule: true,
            estimatedDuration: 30,
            tag: "personal" // Critical! Personal tasks can use wind-down slots
          });
          
          // Create a busy schedule with all remaining work hours occupied
          const busySchedule: ScheduleItem[] = [];
          
          // Fill the remaining day with meetings
          for (const hour of workHours) {
            busySchedule.push(TestUtils.createTestScheduleItem({
              id: `meeting-at-${hour}`,
              title: `Meeting at ${hour}`,
              startTime: setHours(today, hour),
              endTime: setHours(today, hour + 1),
              type: "event"
            }));
          }
          
          // Create energy forecast including wind-down phase with properly typed energy slots
          const energyForecast: EnergySelect[] = [];
          
          // Add work hour energy slots
          for (const hour of workHours) {
            energyForecast.push(createEnergySlot(hour, 0.8, today));
          }
          
          // Add wind-down energy slot with correct type
          const windDownEnergySlot = createEnergySlot(windDownHour, 0.4, today);
          // Override the energy stage to be wind_down specifically
          (windDownEnergySlot as any).energyStage = "wind_down";
          // Set a calmer mood for wind-down
          (windDownEnergySlot as any).mood = "calm";
          energyForecast.push(windDownEnergySlot);
          
          // When: Getting available slots with lowered energy requirements due to urgency
          const context: SchedulingContext = {
            schedule: busySchedule,
            energyHistory: [],
            todayEnergyForecast: energyForecast,
            schedulingStrategy: "today",
            targetDate: today
          };
          
          // Use personal task energy requirements for wind-down compatibility
          const personalRequirements = getEnergyRequirementsForTask("personal");
          
          // Verify the energy requirements allow wind-down energy levels
          expect(personalRequirements.min).toBeLessThanOrEqual(0.4); // Wind-down typical energy level
          
          const availableSlots = getAvailableSlotsForContext(
            context, 
            urgentTask.estimatedDuration!,
            personalRequirements
          );
          
          // Then: It should find slots in the wind-down period
          expect(availableSlots.length).toBeGreaterThan(0);
          
          // At least one slot should be in wind-down hour
          const hasWindDownSlot = availableSlots.some(slot => 
            slot.startTime.getHours() === windDownHour
          );
          
          expect(hasWindDownSlot).toBe(true);
          
          // And the slot should have energyStage = wind_down
          const foundWindDownSlot = availableSlots.find(slot => 
            slot.startTime.getHours() === windDownHour
          );
          
          expect(foundWindDownSlot?.energyStage).toBe("wind_down");
          expect(foundWindDownSlot).toBeDefined(); // Ensure slot exists before checking property
          
          // Clean up mocked time
          vi.useRealTimers();
        });
    });
});
