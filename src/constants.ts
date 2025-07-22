export const MILLISECONDS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;

export const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE;
export const MILLISECONDS_PER_HOUR = MILLISECONDS_PER_MINUTE * MINUTES_PER_HOUR;
export const MILLISECONDS_PER_DAY = MILLISECONDS_PER_HOUR * HOURS_PER_DAY;
export const MILLISECONDS_PER_WEEK = MILLISECONDS_PER_DAY * DAYS_PER_WEEK;

export const DAYS_IN_TWO_WEEKS = 14;
export const DAYS_IN_MONTH = 30;
export const WEEKS_IN_MONTH = 4;

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;
export const LARGE_PAGE_SIZE = 20;

export const MAX_STRING_LENGTH_255 = 255;
export const MAX_STRING_LENGTH_256 = 256;
export const MAX_STRING_LENGTH_1000 = 1000;
export const MAX_STRING_LENGTH_1001 = 1001;
export const MIN_TASK_DURATION = 15;
export const MAX_TASK_DURATION = 720;
export const MIN_RATING = 5;
export const MIN_NAME_LENGTH = 12;
export const MIN_LIMIT = 3;
export const MAX_LIMIT = 5;

export const MIN_WAKE_GAP_MINUTES = 5;
export const SLEEP_HOURS = 8;
export const TYPICAL_SLEEP_HOURS = 7;

export const PERCENTAGE_MULTIPLIER = 100;
export const HIGH_PERCENTAGE = 90;
export const MEDIUM_PERCENTAGE = 70;
export const LOW_PERCENTAGE = 50;
export const QUALITY_THRESHOLD = 80;
export const EFFICIENCY_THRESHOLD_HIGH = 90;
export const EFFICIENCY_THRESHOLD_LOW = 40;

export const STANDARD_DEVIATION_MULTIPLIER = 2;
export const VARIANCE_DIVISOR = 2;
export const QUARTILE_DIVISOR = 4;
export const MEDIAN_POSITION = 2;
export const DECIMAL_PRECISION = 2;
export const ROUNDING_PRECISION = 0.5;

export const SHORT_DURATION = 20;
export const MEDIUM_DURATION = 30;
export const LONG_DURATION = 45;
export const EXTENDED_DURATION = 60;

export const MIN_COUNT = 2;
export const TYPICAL_COUNT = 3;
export const STANDARD_COUNT = 4;
export const MAX_COUNT = 5;
export const EXTENDED_COUNT = 6;
export const WEEK_COUNT = 7;
export const LARGE_COUNT = 8;
export const HIGHER_COUNT = 9;
export const MAXIMUM_COUNT = 10;

export const MORNING_HOUR = 5;
export const WORK_START_HOUR = 12;
export const EVENING_HOUR = 17;
export const NIGHT_HOUR = 22;

export const MIN_DATA_POINTS = 3;
export const CONFIDENCE_MULTIPLIER = 1.5;
export const CORRELATION_THRESHOLD = 0.8;
export const TREND_THRESHOLD = 0.4;
export const STABILITY_THRESHOLD = 0.3;

export const TIME_STRING_SLICE_END = 8;
export const DATE_COMPONENT_COUNT = 3;

export const FIRST_ELEMENT = 0;
export const SECOND_ELEMENT = 1;
export const THIRD_ELEMENT = 2;
export const FOURTH_ELEMENT = 3;
export const FIFTH_ELEMENT = 4;

export const TEST_YEAR = 2023;
export const TEST_MONTH = 14;
export const TEST_DAY = 30;
export const TEST_MINUTE = 45;

export const PERFECT_SCORE = 100;
export const HIGH_SCORE = 87.5;
export const MEDIUM_HIGH_SCORE = 70;
export const MEDIUM_SCORE = 50;
export const LOW_SCORE = 21.43;
export const VERY_LOW_SCORE = 28.57;
export const SPECIFIC_SCORE_7_25 = 7.25;
export const SPECIFIC_SCORE_28_7 = 28.7;
export const SPECIFIC_SCORE_21_3 = 21.3;

export const OPTIMAL_SLEEP_DURATION = 460;
export const GOOD_SLEEP_DURATION = 455;
export const MINIMUM_SLEEP_DURATION = 450;

export const OUTLIER_MULTIPLIER = 3.5;
export const STANDARD_MULTIPLIER = 1.63;
export const PRECISION_FACTOR = 4.17;
export const ACCURACY_FACTOR = 14.58;
export const RELIABILITY_FACTOR = 6.25;
export const CONSISTENCY_FACTOR = 3.5;

export const FUTURE_DAYS_LIMIT = 365;
export const CALENDAR_ITEM_LIMIT = 20;

export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;

export const ONE_HOUR_MS = 3600000;
export const TWO_HOURS_MS = 7200000;
export const THREE_HOURS_MS = 10800000;
export const FOUR_HOURS_MS = 14400000;
export const ONE_DAY_MS = 86400000;
export const TWO_DAYS_MS = 172800000;
export const TEN_THOUSAND_MS = 10000;

export const MAX_STEPS_PER_DAY = 100000;
export const MAX_MINUTES_PER_DAY = 1440;

export const NANOID_LENGTH = 22;
export const DEFAULT_TASK_PRIORITY = 3;

export const MAX_SUGGESTIONS = 4;
export const CALENDAR_MAX_RESULTS = 100;
export const GOOGLE_CALENDAR_DEFAULT_LIMIT = 20;
export const GOOGLE_CALENDAR_MONTH_DAYS = 30;

export const SLEEP_EFFICIENCY_THRESHOLD = 0.8;
export const SLEEP_EFFICIENCY_MULTIPLIER = 10;
export const SLEEP_CYCLES_PER_NIGHT = 3;
export const SLEEP_CYCLE_LENGTH_HOURS = 3;
export const SLEEP_RATING_DIVIDER = 7;
export const SLEEP_TARGET_HOURS = 7;

export const ENERGY_TIME_SLOTS = {
  MORNING_START: 5,
  MORNING_END: 12,
  AFTERNOON_START: 12,
  AFTERNOON_END: 17,
  EVENING_START: 17,
  EVENING_END: 22,
};

export const DAYS_FOR_STATS = 7;
export const STATS_WINDOW_DAYS = 7;
export const NEGATIVE_DAYS_OFFSET = -7;
export const ACTIVITY_TIME_OFFSET_DAYS = -3;
export const ACTIVITY_TIME_OFFSET_NEGATIVE = -6;

export const SCHEDULE_ANALYSIS_HOURS = 8;
export const SCHEDULE_COMPLETION_PERCENTAGE = 90;
export const SCHEDULE_TIME_ANALYSIS_WINDOW = 3;

export const HIGH_ENERGY_THRESHOLD = 100;
export const MEDIUM_ENERGY_THRESHOLD = 90;
export const TASK_SUGGESTION_LIMIT = 3;
export const HIGH_PRIORITY_SCORE = 70;
export const LOW_PRIORITY_SCORE = 50;
export const OVERDUE_FACTOR = 0.3;

export const TIME_SLICE_END = 5;
export const HOURS_IN_DAY_MINUS_ONE = 23;
export const MINUTES_EFFICIENCY_DIVISOR = 60;

export const COMPLETION_PERCENTAGE_THRESHOLD = 0.5;
export const ENERGY_THRESHOLD_LOW = 0.4;
export const ENERGY_THRESHOLD_HIGH = 0.7;

export const DEEP_WORK_MIN_ENERGY = 0.7;
export const DEEP_WORK_MAX_ENERGY = 1.0;
export const CREATIVE_WORK_MIN_ENERGY = 0.4;
export const CREATIVE_WORK_MAX_ENERGY = 1.0;
export const ADMIN_WORK_MIN_ENERGY = 0.3;
export const ADMIN_WORK_MAX_ENERGY = 0.7;
export const PERSONAL_WORK_MIN_ENERGY = 0.1;
export const PERSONAL_WORK_MAX_ENERGY = 0.7;
export const DEFAULT_MIN_ENERGY = 0.3;
export const DEFAULT_MAX_ENERGY = 1.0;
