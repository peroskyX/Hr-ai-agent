import {
  addDays,
  addHours,
  addMinutes,
  isSameDay,
  setHours,
  setMinutes,
} from "date-fns";
import { flow } from "lodash";

export type TAG = "deep" | "creative" | "admin" | "personal";


import {
  ADMIN_WORK_MAX_ENERGY,
  ADMIN_WORK_MIN_ENERGY,
  CREATIVE_WORK_MAX_ENERGY,
  CREATIVE_WORK_MIN_ENERGY,
  DAYS_PER_WEEK,
  DEEP_WORK_MAX_ENERGY,
  DEEP_WORK_MIN_ENERGY,
  DEFAULT_MAX_ENERGY,
  DEFAULT_MIN_ENERGY,
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  PERSONAL_WORK_MAX_ENERGY,
  PERSONAL_WORK_MIN_ENERGY,
  SECONDS_PER_MINUTE,
} from "./constants.js";

//   import type { ScheduleItem } from "../schedules/dto.schedule";

export type EnergySelect = {
  userId: string;
  _id: string;
  date: string;
  _creationTime: number;
  mood: "happy" | "motivated" | "focused" | "calm" | "grateful" | "confident" | "optimistic" | "inspired" | "indifferent" | "disappointed";
  energyLevel: number;
  energyStage: "morning_rise" | "morning_peak" | "afternoon_rebound" | "midday_dip" | "wind_down" | "sleep_phase";
  hour: number;
  hasManualCheckIn: boolean;
}

export type ScheduleItem = {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  type: "task" | "event";
}

export type TaskSelect = Omit<ScheduleItem, "type"> & {
  isAutoSchedule: boolean;
  priority: number;
  estimatedDuration: number;
  tag: TAG;
  status: "pending" | "completed";
};
export type TaskBody = Omit<TaskSelect, "id" >;

export interface EnergySlot {
  startTime: Date;
  endTime: Date;
  energyLevel: number;
  energyStage: string;
  hasConflict: boolean;
  isToday: boolean;
  isHistorical?: boolean;
}

export interface HistoricalEnergyPattern {
  hour: number;
  averageEnergy: number;
}

export interface SlotAnalysisParams {
  schedule: ScheduleItem[];
  taskDuration: number;
  energyRequirements: { min: number; max: number };
}

export interface SchedulingContext {
  schedule: ScheduleItem[];
  energyHistory: EnergySelect[];
  todayEnergyForecast?: EnergySelect[];
  historicalPatterns?: HistoricalEnergyPattern[];
  schedulingStrategy: "today" | "future";
  targetDate?: Date | null;
}


export function buildMultiChunkContext(baseContext: SchedulingContext, allChunks: TaskSelect[]) {
  const chunkInfo = {
    isMultiChunkScheduling: true,
    totalChunks: allChunks.length,
    allChunkIds: allChunks.map(c => c.id),
    chunkTitles: allChunks.map(c => c.title),
    chunkDurations: allChunks.map(c => extractTaskDuration(c)),
  };

  return {
    ...baseContext,
    chunkInfo,
  };
}

export function buildMultiChunkPromptContext(
  allChunks: TaskSelect[],
  context: SchedulingContext,
  availableSlots: EnergySlot[],
) {
  const isUsingFutureStrategy = context.schedulingStrategy === "future";
  const schedulingNote = isUsingFutureStrategy
    ? "Using historical energy patterns for future scheduling since forecast is only available for today"
    : "Using today's actual energy forecast";

  const cognitiveLoad = analyzeCognitiveLoad(context.schedule);
  const energyRequirements = getEnergyRequirementsForTask(allChunks[0]?.tag || "admin");

  return {
    currentTime: new Date().toISOString(),
    schedule: context.schedule,
    energyHistory: context.energyHistory,
    todayEnergyForecast: context.todayEnergyForecast,
    historicalPatterns: context.historicalPatterns,
    availableSlots,
    schedulingStrategy: context.schedulingStrategy,
    targetDate: context.targetDate?.toISOString(),
    cognitiveLoad,
    energyRequirements,
    constraints: buildTaskConstraints(allChunks[0] || {} as TaskSelect),
    note: `${schedulingNote}. This is a multi-chunk scheduling request - optimize all ${allChunks.length} chunks as a sequence while avoiding conflicts.`,
  };
}

export function shouldAutoReschedule(
  task: TaskSelect,
  changes?: Partial<TaskBody>,
) {
  const autoSchedulingDisabled = !task.isAutoSchedule;
  if (autoSchedulingDisabled) {
    return false;
  }

  const isInitialSchedulingCheck = !changes;
  if (isInitialSchedulingCheck) {
    return needsInitialScheduling(task);
  }

  if (changes?.endTime && task.endTime) {
    if (hasDeadlineConflict(task, changes as TaskSelect)) {
      return true;
    }
  }

  return changesRequireRescheduling(task, changes);
}

export function hasDeadlineConflict(existingTask: TaskSelect, newTask: Partial<TaskSelect>): boolean {
  if (!existingTask.endTime || !newTask.endTime) {
    return false;
  }

  const existingDeadline = new Date(existingTask.endTime);
  const newDeadline = new Date(newTask.endTime);

  return newDeadline.getTime() < existingDeadline.getTime();
}

export function needsInitialScheduling(task: TaskSelect): boolean {
  const hasDateWithoutSpecificTime = task.startTime ? isDateOnlyWithoutTime(task.startTime) : false;
  const hasDeadlineButNoStartTime = !task.startTime && !!task.endTime;

  return hasDateWithoutSpecificTime || hasDeadlineButNoStartTime;
}

function requiresReschedulingDueToTimeChanges(changes: Partial<TaskBody>) {
  const isRemovingStartTime = changes.startTime === null;
  if (isRemovingStartTime)
    return true;
  const hasNoStartTimeChange = !changes.startTime;
  if (hasNoStartTimeChange)
    return null;
  const isSettingDateOnly = isDateOnlyWithoutTime(changes.startTime as Date | null);
  return isSettingDateOnly;
}

function changesRequireRescheduling(task: TaskSelect, changes: Partial<TaskBody>) {
  const timeChangeResult = requiresReschedulingDueToTimeChanges(changes);
  const hasTimeChangeResult = timeChangeResult !== null;
  if (hasTimeChangeResult) {
    return timeChangeResult;
  }

  return hasSignificantChanges(task, changes);
}

function hasSignificantChanges(task: TaskSelect, changes: Partial<TaskBody>) {
  const priorityChangedSignificantly = hasSignificantPriorityChange(task, changes);
  const durationChangedSignificantly = hasSignificantDurationChange(task, changes);

  const requiresRescheduling = priorityChangedSignificantly || durationChangedSignificantly;
  return requiresRescheduling;
}

export function determineTargetDate(task: TaskSelect): Date | null {
  const hasStartTimeWithoutSpecificTime = task.startTime && isDateOnlyWithoutTime(task.startTime);
  if (hasStartTimeWithoutSpecificTime) {
    return task.startTime;
  }

  const hasDeadline = task.endTime;
  if (hasDeadline) {
    const deadlineBasedDate = calculateDeadlineBasedDate(task.endTime!);
    return deadlineBasedDate;
  }

  return null;
}

export function determineSchedulingStrategy(targetDate: Date | null) {
  const hasNoTargetDate = !targetDate;

  if (hasNoTargetDate) {
    return {
      isToday: false,
      strategy: "future" as const,
    };
  }

  const isTargetDateToday = isSameDay(targetDate, new Date());
  const strategy = isTargetDateToday ? ("today" as const) : ("future" as const);

  return {
    isToday: isTargetDateToday,
    strategy,
  };
}

export function calculateSchedulingWindow(task: TaskSelect): number {
  const defaultSchedulingWindowDays = DAYS_PER_WEEK;
  const dayInMilliseconds = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;

  const hasNoDeadline = !task.endTime;
  if (hasNoDeadline) {
    return defaultSchedulingWindowDays;
  }

  const daysUntilDeadline = Math.ceil(
    (new Date(task.endTime!).getTime() - new Date().getTime())
    / dayInMilliseconds,
  );

  const maxSchedulingWindow = defaultSchedulingWindowDays;
  return Math.min(maxSchedulingWindow, daysUntilDeadline);
}

export function isStartTimeSet(task: TaskSelect) {
  return task.startTime !== null;
}

export function isDateOnlyWithoutTime(date: Date | null) {
  if (!date)
    return false;

  const hasZeroHours = date.getUTCHours() === 0;
  const hasZeroMinutes = date.getUTCMinutes() === 0;
  const hasZeroSeconds = date.getUTCSeconds() === 0;
  const hasZeroMilliseconds = date.getUTCMilliseconds() === 0;

  const isDateOnly = hasZeroHours && hasZeroMinutes && hasZeroSeconds && hasZeroMilliseconds;
  return isDateOnly;
}

function hasSignificantPriorityChange(task: TaskSelect, changes: Partial<TaskBody>) {
  const significantPriorityThreshold = 2;

  const priorityNotProvided = changes?.priority === undefined;
  const taskHasNoPriority = task.priority === null;

  const cannotComparePriority = priorityNotProvided || taskHasNoPriority;
  if (cannotComparePriority) {
    return false;
  }

  const priorityDifference = Math.abs(changes.priority! - task.priority);
  const isSignificantChange = priorityDifference >= significantPriorityThreshold;

  return isSignificantChange;
}

function hasSignificantDurationChange(task: TaskSelect, changes: Partial<TaskBody>) {
  const significantDurationThresholdMinutes = 30;

  const changesHasNoDuration = changes?.estimatedDuration == null;
  const taskHasNoDuration = task.estimatedDuration == null;

  const cannotCompareDurations = changesHasNoDuration || taskHasNoDuration;
  if (cannotCompareDurations) {
    return false;
  }

  const durationDifferenceInMinutes = Math.abs(changes.estimatedDuration! - task.estimatedDuration!);
  const isSignificantChange = durationDifferenceInMinutes >= significantDurationThresholdMinutes;

  return isSignificantChange;
}

function calculateDeadlineBasedDate(endTime: Date) {
  const deadline = new Date(endTime);
  const today = new Date();
  const isDeadlineInFuture = deadline > today;

  if (isDeadlineInFuture) {
    return deadline;
  }

  return null;
}

function shouldUseTodaySlots(context: SchedulingContext) {
  return context.schedulingStrategy === "today" && context.todayEnergyForecast;
}

function shouldUseFutureSlots(context: SchedulingContext) {
  return context.schedulingStrategy === "future" && context.historicalPatterns;
}

export function getAvailableSlotsForContext(
  context: SchedulingContext,
  taskDuration: number,
  energyRequirements: { min: number; max: number },
) {
  if (shouldUseTodaySlots(context)) {
    const todaySlots = analyzeAvailableSlotsToday({
      schedule: context.schedule,
      energyForecast: context.todayEnergyForecast!,
      taskDuration,
      energyRequirements,
    });
    return todaySlots;
  }

  if (!shouldUseFutureSlots(context)) {
    return generateFlexibleMultiDaySlots(context, taskDuration, energyRequirements);
  }

  if (context.targetDate) {
    const futureSlots = analyzeAvailableSlotsFuture({
      schedule: context.schedule,
      targetDate: context.targetDate,
      taskDuration,
      energyRequirements,
      historicalPatterns: context.historicalPatterns!,
    });
    return futureSlots;
  }

  return generateFlexibleMultiDaySlots(context, taskDuration, energyRequirements);
}

export function generateFlexibleMultiDaySlots(
  context: SchedulingContext,
  taskDuration: number,
  energyRequirements: { min: number; max: number },
): EnergySlot[] {
  if (!context.historicalPatterns) {
    return [];
  }

  const daysToGenerate = 7;
  const today = new Date();
  const allSlots: EnergySlot[] = [];

  for (let dayOffset = 0; dayOffset < daysToGenerate; dayOffset++) {
    const targetDate = addDays(today, dayOffset);

    const daySlots = analyzeAvailableSlotsFuture({
      schedule: context.schedule,
      targetDate,
      taskDuration,
      energyRequirements,
      historicalPatterns: context.historicalPatterns,
    });

    allSlots.push(...daySlots);
  }

  return allSlots;
}

export function getEnergyRequirementsForTask(taskTag: TAG) {
  switch (taskTag) {
    case "deep":
      return { min: DEEP_WORK_MIN_ENERGY, max: DEEP_WORK_MAX_ENERGY };
    case "creative":
      return { min: CREATIVE_WORK_MIN_ENERGY, max: CREATIVE_WORK_MAX_ENERGY };
    case "admin":
      return { min: ADMIN_WORK_MIN_ENERGY, max: ADMIN_WORK_MAX_ENERGY };
    case "personal":
      return { min: PERSONAL_WORK_MIN_ENERGY, max: PERSONAL_WORK_MAX_ENERGY };
    default:
      return { min: DEFAULT_MIN_ENERGY, max: DEFAULT_MAX_ENERGY };
  }
}

export function extractTaskDuration(task: TaskSelect): number {
  const defaultTaskDurationMinutes = 60;
  return task.estimatedDuration ?? defaultTaskDurationMinutes;
}

export function analyzeAvailableSlotsToday(
  params: SlotAnalysisParams & { energyForecast: EnergySelect[] },
) {
  const bufferTimeMinutes = 15;

  const { schedule, energyForecast, taskDuration, energyRequirements } = params;
  const currentTime = new Date();
  const bufferedCurrentTime = addMinutes(currentTime, bufferTimeMinutes);

  return flow(
    (forecast: EnergySelect[]) => forecast.map(mapEnergyToSlot),

    (slots: EnergySlot[]) => slots.filter((slot) => {
      const slotIsFuture = slot.startTime >= bufferedCurrentTime;
      return slotIsFuture;
    }),

    processSlots(schedule, taskDuration, energyRequirements),
  )(energyForecast);
}

export function analyzeAvailableSlotsFuture(
  params: SlotAnalysisParams & {
    targetDate: Date;
    historicalPatterns: HistoricalEnergyPattern[];
  },
) {
  const { schedule, targetDate, taskDuration, energyRequirements, historicalPatterns } = params;
  const currentTime = new Date();

  return flow(
    (patterns: HistoricalEnergyPattern[]) =>
      patterns.filter(isHistoricalEnergyValid(energyRequirements)),
    (patterns: HistoricalEnergyPattern[]) =>
      patterns.map(mapPatternToSlot(targetDate)),

    (slots: EnergySlot[]) => slots.filter(slot => slot.startTime > currentTime),
    addConflictFlag(schedule, taskDuration),
    (slots: EnergySlot[]) => slots.filter((slot: EnergySlot) => !slot.hasConflict),
  )(historicalPatterns);
}

export function buildPromptContext(
  task: TaskSelect,
  context: SchedulingContext,
  availableSlots: EnergySlot[],
) {
  const isUsingFutureStrategy = context.schedulingStrategy === "future";
  const schedulingNote = isUsingFutureStrategy
    ? "Using historical energy patterns for future scheduling since forecast is only available for today"
    : "Using today's actual energy forecast";

  const cognitiveLoad = analyzeCognitiveLoad(context.schedule);
  const energyRequirements = getEnergyRequirementsForTask(task.tag);

  return {
    currentTime: new Date().toISOString(),
    schedule: context.schedule,
    energyHistory: context.energyHistory,
    todayEnergyForecast: context.todayEnergyForecast,
    historicalPatterns: context.historicalPatterns,
    availableSlots,
    schedulingStrategy: context.schedulingStrategy,
    targetDate: context.targetDate?.toISOString(),
    cognitiveLoad,
    energyRequirements,
    constraints: buildTaskConstraints(task),
    note: schedulingNote,
  };
}

function mapEnergyToSlot(energy: EnergySelect): EnergySlot {
  const startTime = new Date(energy.date);
  const endTime = addHours(startTime, energy.hour);

  startTime.setSeconds(0, 0);
  endTime.setSeconds(0, 0);

  return {
    startTime,
    endTime,
    energyLevel: energy.energyLevel,
    energyStage: energy.energyStage,
    hasConflict: false,
    isToday: true,
  };
}

function processSlots(
  schedule: ScheduleItem[],
  duration: number,
  requirements: { min: number; max: number },
) {
  return flow(
    (slots: EnergySlot[]) => slots.filter(isEnergyValid(requirements)),
    addConflictFlag(schedule, duration),
    (slots: EnergySlot[]) => slots.filter((slot: EnergySlot) => !slot.hasConflict),
  );
}

function isHistoricalEnergyValid(requirements: { min: number; max: number }) {
  return (pattern: { averageEnergy: number }) => {
    const meetsMinimumEnergy = pattern.averageEnergy >= requirements.min;
    const meetsMaximumEnergy = pattern.averageEnergy <= requirements.max;
    const isWithinEnergyRange = meetsMinimumEnergy && meetsMaximumEnergy;
    return isWithinEnergyRange;
  };
}

function mapPatternToSlot(targetDate: Date) {
  return (pattern: HistoricalEnergyPattern): EnergySlot => {
    const slotDurationMinutes = 60;

    const slotStartTime = setHours(setMinutes(targetDate, 0), pattern.hour);
    const slotEndTime = addMinutes(slotStartTime, slotDurationMinutes);

    slotStartTime.setSeconds(0, 0);
    slotEndTime.setSeconds(0, 0);

    return {
      startTime: slotStartTime,
      endTime: slotEndTime,
      energyLevel: pattern.averageEnergy,
      energyStage: "historical",
      hasConflict: false,
      isToday: false,
      isHistorical: true,
    };
  };
}

function addConflictFlag(schedule: ScheduleItem[], duration: number) {
  return (slots: EnergySlot[]) =>
    slots.map((slot: EnergySlot) => ({
      ...slot,
      hasConflict: hasScheduleConflict(schedule, duration)(slot),
    }));
}

// export function analyzeCognitiveLoad(schedule: ScheduleItem[]) {
//   const highCognitiveLoadThreshold = 2;
//   const tasks = schedule.filter(item => item.type === "task") as unknown as TaskSelect[];
//   const cognitiveTasks = countCognitiveTasks(tasks);
//   const cognitiveTaskCount = cognitiveTasks.length;

//   const hasHighCognitiveLoad = cognitiveTaskCount >= highCognitiveLoadThreshold;

//   const recommendedBuffer = hasHighCognitiveLoad
//     ? "At least 30 minutes between demanding tasks"
//     : "No buffer needed";

//   return {
//     recentDeepTaskCount: cognitiveTaskCount,
//     recommendedBuffer,
//   };
// }

export function analyzeCognitiveLoad(schedule: ScheduleItem[]) {
  const highCognitiveLoadThreshold = 2;
  
  // For schedule items, we can infer cognitive load from task titles
  // This is a simplified approach since ScheduleItem doesn't have tag information
  const cognitiveTasks = schedule.filter(item => {
    if (item.type !== "task") return false;
    
    const title = item.title.toLowerCase();
    // Check if title indicates deep work or creative tasks
    return title.includes("deep") || 
           title.includes("creative") || 
           title.includes("research") || 
           title.includes("design") ||
           title.includes("analysis") ||
           title.includes("development");
  });
  
  const cognitiveTaskCount = cognitiveTasks.length;
  const hasHighCognitiveLoad = cognitiveTaskCount >= highCognitiveLoadThreshold;

  const recommendedBuffer = hasHighCognitiveLoad
    ? "At least 30 minutes between demanding tasks"
    : "No buffer needed";

  return {
    recentDeepTaskCount: cognitiveTaskCount,
    recommendedBuffer,
  };
}

function buildTaskConstraints(task: TaskSelect) {
  const hasDeadline = !!task.endTime;
  const hasStartDateWithoutTime = task.startTime && isDateOnlyWithoutTime(task.startTime);

  return {
    hasDeadline,
    deadlineUrgency: getDeadlineUrgency(task),
    hasStartDateOnly: hasStartDateWithoutTime,
    mustScheduleInFuture:
      "CRITICAL: Never schedule tasks in the past or within 15 minutes of current time",
  };
}

function isEnergyValid(requirements: { min: number; max: number }) {
  return (item: { energyLevel: number }) => {
    const meetsMinimumEnergy = item.energyLevel >= requirements.min;
    const meetsMaximumEnergy = item.energyLevel <= requirements.max;
    const isWithinEnergyRange = meetsMinimumEnergy && meetsMaximumEnergy;
    return isWithinEnergyRange;
  };
}

function hasScheduleConflict(schedule: ScheduleItem[], duration: number) {
  // Buffer time in minutes to maintain before and after meetings
  const bufferMinutes = 10;

  return (slot: { startTime: Date }) =>
    schedule.some((item: ScheduleItem) => {
      const itemHasNoEndTime = !item.endTime;
      if (itemHasNoEndTime) {
        return false;
      }

      const slotEndTime = addMinutes(slot.startTime, duration);

      const normalizedItemStart = new Date(item.startTime);
      const normalizedItemEnd = new Date(item.endTime!);
      normalizedItemStart.setSeconds(0, 0);
      normalizedItemEnd.setSeconds(0, 0);
      
      // Apply buffer only for events/meetings (not for tasks)
      if (item.type === "event") {
        // Add buffer before and after meetings
        normalizedItemStart.setTime(normalizedItemStart.getTime() - bufferMinutes * 60 * 1000);
        normalizedItemEnd.setTime(normalizedItemEnd.getTime() + bufferMinutes * 60 * 1000);
      }

      const slotStartsBeforeItemEnds = slot.startTime < normalizedItemEnd;
      const slotEndsAfterItemStarts = slotEndTime > normalizedItemStart;
      const hasTimeConflict = slotStartsBeforeItemEnds && slotEndsAfterItemStarts;
      return hasTimeConflict;
    });
}

export function countCognitiveTasks(recentTasks: TaskSelect[]) {
  const isDeepTask = (task: TaskSelect) => task.tag === "deep";
  const isCreativeTask = (task: TaskSelect) => task.tag === "creative";
  const isCognitiveTask = (task: TaskSelect) => isDeepTask(task) || isCreativeTask(task);

  return recentTasks.filter(isCognitiveTask);
}

function getDeadlineUrgency(task: TaskSelect): string {
  const hasNoDeadline = !task.endTime;
  if (hasNoDeadline) {
    return "none";
  }

  const oneDayFromNow = addDays(new Date(), 1);
  const deadlineIsWithin24Hours = new Date(task.endTime!) < oneDayFromNow;

  return deadlineIsWithin24Hours ? "urgent" : "normal";
}

export function getOptimalEnergyStagesForTask(taskTag: TAG) {
  switch (taskTag) {
    case "deep":
      return ["morning_peak"];
    case "creative":
      return ["morning_peak", "afternoon_rebound"];
    case "admin":
      return ["midday_dip"];
    case "personal":
      return ["midday_dip", "wind_down"];
    default:
      return ["midday_dip", "wind_down"];
  }
}
