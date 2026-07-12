// utils.js - Utility functions

// Generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

// Calculate next review date based on difficulty rating
// Sophisticated spaced repetition algorithm based on SM-2
function calculateNextReview(card, rating) {
    const config = APP_CONFIG;
    const now = new Date();
    let newInterval = card.interval || config.DEFAULT_INTERVAL;
    let newEaseFactor = card.easeFactor || config.DEFAULT_EASE_FACTOR;
    let graduationStep = card.graduationStep || 0;

    // Handle different rating scenarios
    switch(rating) {
        case 1: // Nope! - Reset card, it's a lapse
            newInterval = config.DEFAULT_INTERVAL;
            graduationStep = 0;
            newEaseFactor = Math.max(config.MIN_EASE_FACTOR, newEaseFactor + config.EASE_PENALTY_FAIL);
            break;

        case 2: // Getting there - Still learning
            if (graduationStep < config.GRADUATION_THRESHOLD) {
                // In learning phase
                newInterval = config.LEARNING_STEPS[graduationStep] || config.LEARNING_STEPS[0];
                graduationStep++;
            } else {
                // Was graduated, now struggling
                newInterval = Math.max(config.DEFAULT_INTERVAL, Math.floor(newInterval * config.LAPSE_MULTIPLIER));
                newEaseFactor = Math.max(config.MIN_EASE_FACTOR, newEaseFactor + config.EASE_PENALTY_HARD);
            }
            break;

        case 3: // Almost - Good recall
            if (graduationStep < config.GRADUATION_THRESHOLD) {
                // In learning phase, advance
                const nextStepIndex = graduationStep;
                newInterval = config.LEARNING_STEPS[nextStepIndex] || config.LEARNING_STEPS[config.LEARNING_STEPS.length - 1];
                graduationStep++;
            } else {
                // Graduated card, normal interval — capped so repeated good
                // ratings can't compound into an unbounded (eventually
                // date-breaking) interval
                newInterval = Math.min(config.MAX_INTERVAL,
                    Math.max(4, Math.floor(newInterval * newEaseFactor)));
                newEaseFactor = Math.min(config.MAX_EASE_FACTOR, newEaseFactor + config.EASE_BONUS_GOOD);
            }
            break;

        case 4: // Perfect - Excellent recall
            if (graduationStep < config.GRADUATION_THRESHOLD) {
                // Graduate immediately
                newInterval = config.LEARNING_STEPS[config.LEARNING_STEPS.length - 1];
                graduationStep = config.GRADUATION_THRESHOLD;
                newEaseFactor = Math.min(config.MAX_EASE_FACTOR, newEaseFactor + config.EASE_BONUS_EASY);
            } else {
                // Graduated card, boost interval and ease — capped, same
                // reasoning as case 3
                newInterval = Math.min(config.MAX_INTERVAL,
                    Math.max(config.LEARNING_STEPS[config.LEARNING_STEPS.length - 1],
                        Math.floor(newInterval * newEaseFactor * config.EASY_BONUS_MULTIPLIER)));
                newEaseFactor = Math.min(config.MAX_EASE_FACTOR, newEaseFactor + config.EASE_BONUS_EASY);
            }
            break;
    }

    // Calculate next review date
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + newInterval);

    return {
        nextReview: getLocalDateString(nextDate),
        interval: newInterval,
        easeFactor: newEaseFactor,
        graduationStep: graduationStep
    };
}

// Get cards for a 10-card study session with smart prioritization
function getCardsForStudySession(cards, maxCards = APP_CONFIG.CARDS_PER_STUDY_SESSION) {
    // Local calendar date — must match what calculateNextReview writes,
    // otherwise evenings (local vs UTC rollover) misclassify due cards
    const today = getLocalDateString();
    const now = new Date();

    // Separate cards by status
    const overdueCards = [];
    const dueCards = [];
    const newCards = [];
    const futureCards = []; // Cards not yet due

    cards.forEach(card => {
        if (!card.lastStudied) {
            newCards.push(card);
        } else if (!card.nextReview || card.nextReview < today) {
            // Calculate how overdue
            const dueDate = new Date(card.nextReview || card.lastStudied);
            const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
            overdueCards.push({ ...card, daysOverdue });
        } else if (card.nextReview === today) {
            dueCards.push(card);
        } else {
            futureCards.push(card);
        }
    });

    // Sort overdue by most overdue first
    overdueCards.sort((a, b) => {
        if (b.daysOverdue !== a.daysOverdue) {
            return b.daysOverdue - a.daysOverdue;
        }
        return Math.random() - 0.5;
    });

    // Shuffle other categories
    dueCards.sort(() => Math.random() - 0.5);
    newCards.sort(() => Math.random() - 0.5);
    futureCards.sort(() => Math.random() - 0.5);

    // Build study session with better distribution
    const studyCards = [];

    // Priority 1: Overdue cards (max 40% to leave room for variety)
    const overdueToAdd = Math.min(overdueCards.length, Math.floor(maxCards * 0.4));
    studyCards.push(...overdueCards.slice(0, overdueToAdd));

    // Priority 2: New cards (aim for 30-40% to see more variety)
    const remaining = maxCards - studyCards.length;
    const newCardsDesired = Math.min(newCards.length, Math.floor(maxCards * 0.4));
    const newToAdd = Math.min(newCardsDesired, remaining);
    studyCards.push(...newCards.slice(0, newToAdd));

    // Priority 3: Due today cards (fill some remaining)
    const stillRemaining = maxCards - studyCards.length;
    const dueToAdd = Math.min(dueCards.length, Math.floor(stillRemaining * 0.5));
    studyCards.push(...dueCards.slice(0, dueToAdd));

    // Priority 4: If still not full, pull from future cards for variety
    if (studyCards.length < maxCards) {
        const finalRemaining = maxCards - studyCards.length;
        studyCards.push(...futureCards.slice(0, finalRemaining));
    }

    // Remove the daysOverdue property
    return studyCards.map(card => {
        const { daysOverdue, ...cleanCard } = card;
        return cleanCard;
    });
}


// Calculate comprehensive study statistics
function calculateAdvancedStudyStats(cards, maxCards = APP_CONFIG.CARDS_PER_STUDY_SESSION) {
    // Local calendar date — keeps counts consistent with the scheduler
    const today = getLocalDateString();
    const total = cards.length;

    let newCards = 0;
    let learningCards = 0;
    let graduatedCards = 0;
    let overdueCards = 0;
    let dueToday = 0;

    cards.forEach(card => {
        if (!card.lastStudied) {
            newCards++;
        } else if (!card.graduationStep || card.graduationStep < 2) {
            learningCards++;
        } else {
            graduatedCards++;
        }

        if (card.nextReview) {
            if (card.nextReview < today) {
                overdueCards++;
            } else if (card.nextReview === today) {
                dueToday++;
            }
        }
    });

    // Calculate actual that need practice (limited by session size).
    // Issue 54: maxCards now reflects the user's configured
    // cardsPerSession setting when the caller passes it, falling back to
    // the config default only if no caller-provided value is given.
    const actualNeedsPractice = Math.min(
        overdueCards + dueToday + newCards,
        maxCards
    );

    return {
        total,
        newCards,
        learningCards,
        graduatedCards,
        overdueCards,
        dueToday,
        needsPractice: actualNeedsPractice
    };
}


// Shuffle array (Fisher-Yates algorithm)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Escape HTML to prevent XSS.
// Safe for both element content and attribute values (escapes quotes).
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Reverse of escapeHtml. Used by the one-time data repair routine
// to unwind escaping that was previously applied at storage time.
// Note: '&amp;' is replaced last so a single pass exactly reverses
// a single pass of escapeHtml.
function unescapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

// Debounce function for search/input
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// File handling utilities
function validateImageFile(file) {
    const config = APP_CONFIG;

    if (!config.VALID_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Please select a valid image file (JPEG, PNG, GIF, or WebP)');
    }

    if (file.size > config.MAX_IMAGE_SIZE) {
        const sizeMB = Math.round(config.MAX_IMAGE_SIZE / 1024 / 1024);
        throw new Error(`Image file size must be less than ${sizeMB}MB`);
    }

    return true;
}

// Convert file to data URL for preview
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}


// CSV utility functions
function escapeCSVField(text) {
    if (!text) return '""';

    // RFC 4180 (Issue 45): quotes are escaped by doubling; embedded
    // newlines are kept as real newlines inside the quoted field, rather
    // than the literal two-character \n sequence used previously — that
    // was self-consistent for round-tripping through this app, but broke
    // opening exports cleanly in Excel/Sheets/Anki.
    const escaped = text.replace(/"/g, '""');

    // Always wrap in quotes
    return `"${escaped}"`;
}


// Issue 45: Papa Parse now handles quote-stripping and "" un-escaping
// during import, so this no longer needs to do that. What it still
// needs to do: undo the literal \n (backslash-n) two-character sequence
// used by pre-Issue-45 exports, since that's just ordinary text as far
// as CSV syntax is concerned — Papa Parse won't touch it.
function unescapeLegacyNewlines(text) {
    if (!text) return '';
    return text.replace(/\\n/g, '\n');
}

function validateCSVFormat(csvText) {
    // Issue 45: Papa Parse replaces the old split('\n')-then-parse-quotes
    // approach, which could never correctly handle a quoted field
    // containing a real embedded newline (it would split mid-field before
    // quote-parsing even started).
    const result = Papa.parse(csvText.trim(), { skipEmptyLines: true });

    if (result.errors && result.errors.length > 0) {
        const first = result.errors[0];
        throw new Error(`CSV parse error: ${first.message} (row ${first.row + 1})`);
    }

    const rows = result.data;
    if (rows.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    const header = rows[0];
    if (header.length !== 2) {
        throw new Error('CSV must have exactly 2 columns');
    }

    const col1 = (header[0] || '').toLowerCase().trim();
    const col2 = (header[1] || '').toLowerCase().trim();

    if (col1 !== 'front' || col2 !== 'back') {
        throw new Error('CSV header must be "Front","Back"');
    }

    for (let i = 1; i < rows.length; i++) {
        if (rows[i].length !== 2) {
            throw new Error(`Row ${i + 1} has ${rows[i].length} columns, expected 2`);
        }
    }

    return true;
}


// Simple markdown parser for basic formatting.
// Escapes raw HTML first, so the output is always safe to assign
// to innerHTML regardless of what the stored text contains.
function parseSimpleMarkdown(text) {
    if (!text) return text;

    // Escape HTML, then apply **bold** formatting
    return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}


// Format time based on magnitude
function formatTimeStudied(minutes) {
    if (minutes < 60) {
        return `${minutes} min`;
    } else if (minutes < (24 * 60)) {
        const hours = (minutes / 60).toFixed(1);
        return `${hours} hrs`;
    } else {
        const days = (minutes / (24 * 60)).toFixed(1);
        return `${days} days`;
    }
}


// Convert Blob to data URL
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}


// Get today's date in YYYY-MM-DD format using local timezone
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}


// for debug purposes in the console only
function debugCardIntervals() {
    const categories = window.dataManager.getCategories();
    console.log('=== CARD INTERVALS DEBUG ===');

    categories.forEach(category => {
        category.decks.forEach(deck => {
            deck.cards.forEach(card => {
                if (card.lastStudied) {
                    console.log(`Card: "${card.front.substring(0, 30)}..."`);
                    console.log(`  Last studied: ${card.lastStudied}`);
                    console.log(`  Next review: ${card.nextReview}`);
                    console.log(`  Interval: ${card.interval} days`);
                    console.log(`  Difficulty: ${card.difficulty}`);
                    console.log(`  Graduation step: ${card.graduationStep}`);
                    console.log('---');
                }
            });
        });
    });
}

// Make it globally available for debugging
if (!window.DEBUG) window.DEBUG = {};
window.DEBUG.debugCardIntervals = debugCardIntervals;


function debugRecentSessions(count = 5) {
    const stats = window.dataManager.data.statistics;
    console.log('=== RECENT STUDY SESSIONS ===');

    if (!stats.studySessions || stats.studySessions.length === 0) {
        console.log('No study sessions found');
        return;
    }

    const recent = stats.studySessions.slice(-count);
    recent.forEach((session, i) => {
        console.log(`Session ${stats.studySessions.length - count + i + 1}:`);
        console.log(`  Date: ${session.date}`);
        console.log(`  Cards studied: ${session.cardsStudied}`);
        console.log(`  Time spent: ${session.timeSpent} minutes`);
        console.log(`  Was distracted: ${session.wasDistracted}`);
        console.log('---');
    });

    // Show totals
    const totalSessions = stats.studySessions.length;
    const distractedCount = stats.studySessions.filter(s => s.wasDistracted).length;
    console.log(`Total sessions: ${totalSessions}`);
    console.log(`Distracted sessions: ${distractedCount} (${Math.round(distractedCount/totalSessions*100)}%)`);
}

// Make it available globally
if (!window.DEBUG) window.DEBUG = {};
window.DEBUG.debugRecentSessions = debugRecentSessions;

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
