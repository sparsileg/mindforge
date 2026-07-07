// App Constants - Central location for all configurable values
const APP_CONFIG = {
    // Application Info
    APP_NAME: 'Mindforge',
    APP_VERSION: '2.0.5',

    // Study Session Settings
    CARDS_PER_STUDY_SESSION: 10,
    MAX_NEW_CARDS_PER_SESSION: 5,

    // Rating System
    MIN_RATING: 1,
    MAX_RATING: 4,
    RATING_LABELS: {
        1: "Nope!",
        2: "Getting there",
        3: "Almost",
        4: "Perfect"
    },

    // Spaced Repetition Algorithm
    DEFAULT_EASE_FACTOR: 2.5,
    MIN_EASE_FACTOR: 1.3,
    MAX_EASE_FACTOR: 4.0,
    DEFAULT_INTERVAL: 1,
    GRADUATION_THRESHOLD: 2,

    // Ease Factor Adjustments
    EASE_PENALTY_FAIL: -0.2,      // Rating 1
    EASE_PENALTY_HARD: -0.15,     // Rating 2
    EASE_BONUS_GOOD: 0.05,        // Rating 3
    EASE_BONUS_EASY: 0.1,         // Rating 4

    // Interval Multipliers
    LAPSE_MULTIPLIER: 0.6,        // For failed graduated cards
    EASY_BONUS_MULTIPLIER: 1.15,  // Extra boost for "Perfect" ratings

    // Learning Phase Intervals
    LEARNING_STEPS: [1, 3, 7],    // Days for learning phase

    // File Settings
    MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
    VALID_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],

    // UI Settings
    AUTO_SAVE_INTERVAL: 30000,    // 30 seconds
    TOAST_DURATION: 3000,         // 3 seconds
    ANIMATION_DURATION: 300,      // 0.3 seconds

    // CSV Settings
    CSV_HEADERS: ['Front', 'Back'],

    // Context Menu
    CONTEXT_MENU_WIDTH: 160,
    DECK_MENU_WIDTH: 160,

    // Preview settings
    CARDS_PER_PREVIEW_BATCH: 50,

    // Statistics Settings
    MAX_CARD_TIME_MINUTES: 10,
    MIN_CARDS_FOR_DAY_COUNT: 10
};

// Make constants globally available
window.APP_CONFIG = APP_CONFIG;
