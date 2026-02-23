// Data management for Mindforge

// Data management for Mindforge - Updated to use IndexedDB

class DataManager {
    constructor() {
        this.dataFile = 'data/mindforge-data.json';
        this.data = null;
        this.defaultData = {
            settings: {
                theme: 'dark',
                defaultStudyMode: 'front-to-back',
                cardsPerSession: 10
            },
            categories: [],
            statistics: {
                daysStudied: 0,
                totalTimeStudied: 0,
                uniqueCardsStudied: 0,
                totalCardInstances: 0,
                studySessions: [],
                currentStreak: 0,
                recordStreak: 0,
                lastStudyDate: null
            }
        };
    }

    // Initialize data - load from IndexedDB or migrate from localStorage
    async init() {
        try {
            // Initialize IndexedDB
            if (!IndexedDBManager.isSupported()) {
                throw new Error('IndexedDB is not supported in this browser');
            }

            await window.indexedDBManager.init();

            // Check if we need to migrate from localStorage
            const hasLocalStorage = localStorage.getItem('mindforge-data') !== null;
            const migrationStatus = await window.indexedDBManager.getMigrationStatus();

            console.log('Migration check:', { hasLocalStorage, migrationStatus });

            if (hasLocalStorage && !migrationStatus) {
                console.log('Detected localStorage data, starting migration...');
                const migrationSuccess = await window.indexedDBManager.migrateFromLocalStorage();

                if (migrationSuccess) {
                    console.log('Migration successful!');
                    window.uiManager.showToast('Data migrated to IndexedDB successfully', 'success');
                } else {
                    console.warn('Migration had issues, but continuing...');
                }
            }

            // Load data from IndexedDB
            await this.loadData();

            // Set up listener for data changes from other tabs
            this.setupCrossTabSync();

        } catch (error) {
            console.log('No existing data found, creating default data:', error);
            this.data = { ...this.defaultData };
            await this.saveData();
        }
    }

    // Load data from IndexedDB
    async loadData() {
        const appData = await window.indexedDBManager.getData('appData', 'main');

        if (appData && appData.data) {
            this.data = appData.data;
        } else {
            throw new Error('No data found in IndexedDB');
        }
    }

    // Save data to IndexedDB
    async saveData() {
        try {
            await window.indexedDBManager.saveData('appData', {
                id: 'main',
                type: 'main',
                data: this.data
            });

            // Notify other tabs that data has changed
            await window.indexedDBManager.saveData('settings', {
                key: 'data-sync-timestamp',
                value: Date.now()
            });

            return true;
        } catch (error) {
            console.error('Error saving data to IndexedDB:', error);
            return false;
        }
    }


    // Get all data
    getData() {
        return this.data;
    }

    // Get settings
    getSettings() {
        return this.data.settings;
    }

    // Update settings
    updateSettings(newSettings) {
        this.data.settings = { ...this.data.settings, ...newSettings };
        this.saveData();
    }

    // Category operations
    getCategories() {
        return this.data.categories;
    }

    addCategory(name) {
        const category = {
            id: generateId(),
            name: escapeHtml(name),
            createdAt: new Date().toISOString(),
            decks: []
        };

        this.data.categories.push(category);
        this.saveData();
        return category;
    }

    updateCategory(categoryId, updates) {
        const category = this.findCategory(categoryId);
        if (category) {
            Object.assign(category, updates);
            this.saveData();
            return category;
        }
        return null;
    }

    deleteCategory(categoryId) {
        const index = this.data.categories.findIndex(cat => cat.id === categoryId);
        if (index !== -1) {
            this.data.categories.splice(index, 1);
            this.saveData();
            return true;
        }
        return false;
    }

    findCategory(categoryId) {
        return this.data.categories.find(cat => cat.id === categoryId);
    }

    // Deck operations
    addDeck(categoryId, name) {
        const category = this.findCategory(categoryId);
        if (!category) return null;

        const deck = {
            id: generateId(),
            name: escapeHtml(name),
            createdAt: new Date().toISOString(),
            cards: []
        };

        category.decks.push(deck);
        this.saveData();
        return deck;
    }

    updateDeck(categoryId, deckId, updates) {
        const deck = this.findDeck(categoryId, deckId);
        if (deck) {
            Object.assign(deck, updates);
            this.saveData();
            return deck;
        }
        return null;
    }

    deleteDeck(categoryId, deckId) {
        const category = this.findCategory(categoryId);
        if (!category) return false;

        const index = category.decks.findIndex(deck => deck.id === deckId);
        if (index !== -1) {
            category.decks.splice(index, 1);
            this.saveData();
            return true;
        }
        return false;
    }

    findDeck(categoryId, deckId) {
        const category = this.findCategory(categoryId);
        if (!category) return null;
        return category.decks.find(deck => deck.id === deckId);
    }

    // Card operations
    addCard(categoryId, deckId, cardData) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return null;

        const card = {
            id: generateId(),
            front: cardData.front || '',
            back: cardData.back || '',
            image: cardData.image || null,
            difficulty: null,
            lastStudied: null,
            nextReview: null,
            interval: MINDFORGE_CONFIG.DEFAULT_INTERVAL,
            easeFactor: MINDFORGE_CONFIG.DEFAULT_EASE_FACTOR,
            graduationStep: 0,
            createdAt: new Date().toISOString(),
            hiddenWordsDifficulty: 0,
            recentRatings: []
        };

        deck.cards.push(card);
        this.saveData();
        return card;
    }

    updateCard(categoryId, deckId, cardId, updates) {
        const card = this.findCard(categoryId, deckId, cardId);
        if (card) {
            Object.assign(card, updates);
            this.saveData();
            return card;
        }
        return null;
    }

    deleteCard(categoryId, deckId, cardId) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return false;

        const index = deck.cards.findIndex(card => card.id === cardId);
        if (index !== -1) {
            deck.cards.splice(index, 1);
            this.saveData();
            return true;
        }
        return false;
    }

    findCard(categoryId, deckId, cardId) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return null;
        return deck.cards.find(card => card.id === cardId);
    }

    // Study operations
    updateCardStudyData(categoryId, deckId, cardId, difficulty) {
        const card = this.findCard(categoryId, deckId, cardId);
        if (!card) return null;

        const today = getLocalDateString();
        card.lastStudied = today;
        card.difficulty = difficulty;

        // Calculate new review data using sophisticated algorithm
        const reviewData = calculateNextReview(card, difficulty);
        card.nextReview = reviewData.nextReview;
        card.interval = reviewData.interval;
        card.easeFactor = reviewData.easeFactor;
        card.graduationStep = reviewData.graduationStep;

        this.saveData();
        return card;
    }

    // Get cards due for review in a deck
    getCardsForStudySession(categoryId, deckId, maxCards = null) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return [];

        const cardsPerSession = maxCards ||
              this.data.settings.cardsPerSession ||
              MINDFORGE_CONFIG.CARDS_PER_STUDY_SESSION;

        return getCardsForStudySession(deck.cards, cardsPerSession);
    }

    // Import data from JSON file
    async importData(jsonData) {
        try {
            // Handle both old format (just data) and new format (data + images)
            let mainData, imageData;

            if (jsonData.data && jsonData.images) {
                // New format with images
                mainData = jsonData.data;
                imageData = jsonData.images;
            } else {
                // Old format - assume it's just the main data
                mainData = jsonData;
                imageData = {};
            }

            // Validate the imported data structure
            if (!mainData.settings || !mainData.categories) {
                throw new Error('Invalid data format');
            }

            // Restore main data to IndexedDB
            this.data = mainData;
            await this.saveData();

            // Restore images to IndexedDB - convert from base64 to Blob
            for (const [key, value] of Object.entries(imageData)) {
                if (key.startsWith('mindforge-image-')) {
                    try {
                        const imageDataObj = JSON.parse(value);

                        // Convert data URL to Blob for storage
                        const blob = await window.indexedDBManager.dataUrlToBlob(imageDataObj.dataUrl);

                        await window.indexedDBManager.saveData('images', {
                            filename: imageDataObj.filename,
                            blob: blob,
                            originalName: imageDataObj.originalName,
                            size: imageDataObj.size,
                            type: imageDataObj.type,
                            savedAt: imageDataObj.savedAt
                        });
                    } catch (error) {
                        console.warn(`Failed to import image ${key}:`, error);
                    }
                }
            }

            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }

    // Export current data with images
    async exportData() {
        const mainData = this.data;
        const imageData = {};

        // Collect all image data from IndexedDB and convert to base64 for JSON export
        try {
            const images = await window.indexedDBManager.getAllData('images');

            for (const img of images) {
                const key = `mindforge-image-${img.filename}`;

                try {
                    // Ensure we have a valid Blob before converting
                    if (!img.blob || !(img.blob instanceof Blob)) {
                        console.warn(`Skipping image ${img.filename}: not a valid Blob`);
                        continue;
                    }

                    // Convert Blob to data URL for export
                    const dataUrl = await blobToDataUrl(img.blob);

                    imageData[key] = JSON.stringify({
                        filename: img.filename,
                        dataUrl: dataUrl,
                        originalName: img.originalName,
                        size: img.size,
                        type: img.type,
                        savedAt: img.savedAt
                    });
                } catch (error) {
                    console.warn(`Failed to export image ${img.filename}:`, error);
                    // Continue with other images even if one fails
                }
            }
        } catch (error) {
            console.warn('Error collecting images for export:', error);
        }

        return JSON.stringify({
            data: mainData,
            images: imageData
        }, null, 2);
    }


    resetDeckStats(categoryId, deckId) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return false;

        // Reset all study statistics for each card
        deck.cards.forEach(card => {
            card.difficulty = null;
            card.lastStudied = null;
            card.nextReview = null;
            card.interval = MINDFORGE_CONFIG.DEFAULT_INTERVAL;
            card.easeFactor = MINDFORGE_CONFIG.DEFAULT_EASE_FACTOR;
            card.graduationStep = 0;
        });

        this.saveData();
        return true;
    }

    // Statistics management
    updateStudyStatistics(sessionData) {
        if (!this.data.statistics) {
            this.data.statistics = {
                daysStudied: 0,
                totalTimeStudied: 0,
                uniqueCardsStudied: 0,
                totalCardInstances: 0,
                studySessions: [],
                currentStreak: 0,
                recordStreak: 0,
                lastStudyDate: null
            };
        }

        const stats = this.data.statistics;
        const today = getLocalDateString();

        // Check if this is the first valid session today BEFORE adding the new session
        const previousValidSessionsToday = stats.studySessions.filter(session =>
            session.date === today &&
                session.cardsStudied >= MINDFORGE_CONFIG.MIN_CARDS_FOR_DAY_COUNT
        );
        const isFirstValidSessionToday = previousValidSessionsToday.length === 0;

        // Add session data
        stats.studySessions.push({
            date: today,
            cardsStudied: sessionData.cardsStudied,
            timeSpent: sessionData.timeSpent,
            wasDistracted: sessionData.wasDistracted,
            cardIds: sessionData.cardIds
        });

        // Update total card instances
        stats.totalCardInstances += sessionData.cardsStudied;

        // Calculate unique cards from all cards that have been studied
        let uniqueCards = new Set();
        this.data.categories.forEach(category => {
            category.decks.forEach(deck => {
                deck.cards.forEach(card => {
                    if (card.lastStudied) {
                        uniqueCards.add(card.id);
                    }
                });
            });
        });
        stats.uniqueCardsStudied = uniqueCards.size;

        // Update days studied (only if completed full session and not distracted)
        if (sessionData.cardsStudied >= MINDFORGE_CONFIG.MIN_CARDS_FOR_DAY_COUNT &&
            !sessionData.wasDistracted) {

            if (isFirstValidSessionToday) {
                stats.daysStudied++;
            }
        }

        // Update total time (only if not distracted)
        if (!sessionData.wasDistracted) {
            stats.totalTimeStudied += sessionData.timeSpent;
        }

        // Update streaks (for any day with 10+ cards, regardless of distraction)
        if (sessionData.cardsStudied >= MINDFORGE_CONFIG.MIN_CARDS_FOR_DAY_COUNT && isFirstValidSessionToday) {
            if (!stats.lastStudyDate) {
                // First time ever studying - start streak at 1
                stats.currentStreak = 1;
            } else {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = getLocalDateString(yesterday);

                if (stats.lastStudyDate === yesterdayStr) {
                    // Consecutive day - extend streak
                    stats.currentStreak++;
                } else if (stats.lastStudyDate === today) {
                    // Already studied today - maintain current streak (don't reset)
                    // This handles interrupted sessions that restart on the same day
                } else {
                    // Gap detected - check yesterday's sessions
                    const yesterdayValidSessions = stats.studySessions.filter(session =>
                        session.date === yesterdayStr &&
                            session.cardsStudied >= MINDFORGE_CONFIG.MIN_CARDS_FOR_DAY_COUNT
                    );

                    if (yesterdayValidSessions.length > 0) {
                        // Had a valid session yesterday, continue streak
                        stats.currentStreak++;
                    } else {
                        // True gap - completing today's session starts new streak at 1
                        stats.currentStreak = 1;
                    }
                }
            }

            // Update record if current streak is new record
            if (stats.currentStreak > (stats.recordStreak || 0)) {
                stats.recordStreak = stats.currentStreak;
            }

            stats.lastStudyDate = today;
        }

        this.saveData();
    }

    getStatistics() {
        if (!this.data.statistics) {
            return {
                mastery: 0,
                daysStudied: 0,
                timeStudied: 0,
                uniqueCardsStudied: 0,
                totalCardInstances: 0
            };
        }

        const stats = this.data.statistics;

        // Calculate mastery percentage
        let totalStudiedCards = 0;
        let masteredCards = 0;

        this.data.categories.forEach(category => {
            category.decks.forEach(deck => {
                deck.cards.forEach(card => {
                    if (card.lastStudied) {
                        totalStudiedCards++;
                        if (card.difficulty === 4) {
                            masteredCards++;
                        }
                    }
                });
            });
        });

        const mastery = totalStudiedCards > 0 ? Math.round((masteredCards / totalStudiedCards) * 100) : 0;

        return {
            mastery,
            daysStudied: stats.daysStudied || 0,
            timeStudied: Math.round(stats.totalTimeStudied || 0),
            uniqueCardsStudied: typeof stats.uniqueCardsStudied === 'number' ?
                stats.uniqueCardsStudied : 0,
            totalCardInstances: stats.totalCardInstances || 0,
            currentStreak: stats.currentStreak || 0,
            recordStreak: stats.recordStreak || 0
        };
    }

    // Method to manually adjust days studied (for your 301-day import)
    setDaysStudied(days) {
        if (!this.data.statistics) {
            this.data.statistics = {
                daysStudied: 0,
                totalTimeStudied: 0,
                uniqueCardsStudied: 0,
                totalCardInstances: 0,
                studySessions: []
            };
        }
        this.data.statistics.daysStudied = days;
        this.saveData();
    }

    // Methods to manually set streak values
    setCurrentStreak(days) {
        if (!this.data.statistics) {
            this.data.statistics = {};
        }
        this.data.statistics.currentStreak = days;
        this.saveData();
    }

    setRecordStreak(days) {
        if (!this.data.statistics) {
            this.data.statistics = {};
        }
        this.data.statistics.recordStreak = days;
        this.saveData();
    }

    setupCrossTabSync() {
        // Poll for changes made by other tabs
        this.lastSyncCheck = Date.now();

        setInterval(async () => {
            try {
                const syncData = await window.indexedDBManager.getData('settings', 'data-sync-timestamp');

                if (syncData && syncData.value > this.lastSyncCheck) {
                    console.log('Data changed in another tab, reloading...');
                    await this.loadData();

                    // Update UI if managers are initialized
                    if (window.categoryManager) {
                        window.categoryManager.renderCategories();
                    }
                    if (window.uiManager) {
                        window.uiManager.updateSidebarStats();
                    }

                    this.lastSyncCheck = Date.now();
                }
            } catch (error) {
                console.warn('Error checking for cross-tab updates:', error);
            }
        }, 2000); // Check every 2 seconds
    }

    // Check if streak should be reset to 0 due to a gap
    checkStreakValidity() {
        if (!this.data.statistics || !this.data.statistics.lastStudyDate) {
            return;
        }

        const stats = this.data.statistics;
        const today = getLocalDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterday);

        // If last study was before yesterday and current streak > 0, reset to 0
        if (stats.lastStudyDate < yesterdayStr && stats.currentStreak > 0) {
            stats.currentStreak = 0;
            this.saveData();
        }
    }


    // Perform daily maintenance tasks (backup, cleanup, etc.)
    // called at the start of the first study session of a day
    async performDailyMaintenance() {
        const today = getLocalDateString();
        const lastMaintenanceDate = await window.indexedDBManager.getData('settings', 'last-maintenance-date');

        // Check if we've already done maintenance today
        if (lastMaintenanceDate && lastMaintenanceDate.value === today) {
            return; // Already performed maintenance today
        }

        console.log('=== PERFORMING DAILY MAINTENANCE ===');

        // Task 1: Create daily backup
        try {
            const data = await this.exportData();
            const filename = 'mindforge-daily.json';

            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
            console.log('✓ Daily backup created');
        } catch (error) {
            console.error('✗ Daily backup failed:', error);
        }

        // Task 2: Clean up orphaned images
        try {
            const deletedCount = await this.cleanupOrphanedImages();
            if (deletedCount > 0) {
                console.log(`✓ Cleaned up ${deletedCount} orphaned image(s)`);
            } else {
                console.log('✓ No orphaned images to clean');
            }
        } catch (error) {
            console.error('✗ Image cleanup failed:', error);
        }

        // Task 3: Check and reset streak if needed (already done in checkStreakValidity, but could add here)

        // Mark maintenance as completed for today
        await window.indexedDBManager.saveData('settings', {
            key: 'last-maintenance-date',
            value: today
        });

        console.log('=== DAILY MAINTENANCE COMPLETE ===');
    }

    // Clean up orphaned images that aren't referenced by any cards
    async cleanupOrphanedImages() {
        try {
            // Collect all image filenames currently referenced by cards
            const referencedImages = new Set();
            this.data.categories.forEach(category => {
                category.decks.forEach(deck => {
                    deck.cards.forEach(card => {
                        if (card.image) {
                            const filename = card.image.split('/').pop();
                            referencedImages.add(filename);
                        }
                    });
                });
            });

            // Get all images from IndexedDB
            const allImages = await window.indexedDBManager.getAllData('images');

            // Delete images that aren't referenced
            let deletedCount = 0;
            for (const img of allImages) {
                if (!referencedImages.has(img.filename)) {
                    await window.indexedDBManager.deleteData('images', img.filename);
                    console.log(`  Deleted orphaned image: ${img.filename}`);
                    deletedCount++;
                }
            }

            return deletedCount;
        } catch (error) {
            console.error('Error cleaning up orphaned images:', error);
            return 0;
        }
    }

}

function debugStreakData() {
    const stats = window.dataManager.data.statistics;
    console.log('=== STREAK DEBUG ===');
    console.log('Current streak:', stats.currentStreak);
    console.log('Record streak:', stats.recordStreak);
    console.log('Last study date:', stats.lastStudyDate);
    console.log('Days studied:', stats.daysStudied);

    const today = new Date().toISOString().split('T')[0];
    console.log('Today is:', today);

    // Show recent sessions
    console.log('Recent study sessions:');
    if (stats.studySessions) {
        stats.studySessions.slice(-10).forEach((session, i) => {
            console.log(`  ${session.date}: ${session.cardsStudied} cards, distracted: ${session.wasDistracted}`);
        });
    }
}

if (!window.DEBUG) window.DEBUG = {};
window.DEBUG.debugStreakData = debugStreakData;

// Create global instance
window.dataManager = new DataManager();
