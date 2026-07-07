// data-manager.js - Data management - Updated to use IndexedDB

// Thrown only when loadData() confirms no record exists at all — the one
// case init() is allowed to treat as "first launch" and reset to defaults.
class NoExistingDataError extends Error {}

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
        if (!IndexedDBManager.isSupported()) {
            throw new Error('IndexedDB is not supported in this browser');
        }

        await window.indexedDBManager.init();

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

        try {
            await this.loadData();
        } catch (error) {
            if (error instanceof NoExistingDataError) {
                console.log('No existing data found — first launch, creating default data');
                this.data = { ...this.defaultData };
                await this.saveData();
            } else {
                throw error;
            }
        }

        await this.repairEscapedText();
        await this.repairIntervalOverflow();
        await this.migrateToNormalizedStores();
        this.setupCrossTabSync();
    }

    async loadData() {
        const appData = await window.indexedDBManager.getData('appData', 'main');

        if (appData && appData.data) {
            this.data = appData.data;
        } else {
            throw new NoExistingDataError('No data found in IndexedDB');
        }
    }

    async saveData() {
        try {
            await window.indexedDBManager.saveData('appData', {
                id: 'main',
                type: 'main',
                data: this.data
            });

            this._broadcastDataChanged();

            return true;
        } catch (error) {
            console.error('Error saving data to IndexedDB:', error);
            return false;
        }
    }

    async repairEscapedText() {
        const flag = await window.indexedDBManager.getData('settings', 'escape-repair-v1');
        if (flag && flag.value && flag.value.completed) {
            return;
        }

        const unescapeUntilStable = (text) => {
            if (typeof text !== 'string' || text === '') return text;
            let current = text;
            for (let i = 0; i < 10; i++) {
                const next = unescapeHtml(current);
                if (next === current) break;
                current = next;
            }
            return current;
        };

        let changedCount = 0;
        const repairField = (obj, field) => {
            const repaired = unescapeUntilStable(obj[field]);
            if (repaired !== obj[field]) {
                obj[field] = repaired;
                changedCount++;
            }
        };

        this.data.categories.forEach(category => {
            repairField(category, 'name');
            category.decks.forEach(deck => {
                repairField(deck, 'name');
                deck.cards.forEach(card => {
                    repairField(card, 'front');
                    repairField(card, 'back');
                });
            });
        });

        if (changedCount > 0) {
            await this.saveData();
        }

        await window.indexedDBManager.saveData('settings', {
            key: 'escape-repair-v1',
            value: {
                completed: true,
                completedAt: new Date().toISOString(),
                fieldsRepaired: changedCount
            }
        });

        console.log(`Escape repair complete: ${changedCount} field(s) repaired`);
        if (changedCount > 0) {
            window.uiManager.showToast(
                `Repaired ${changedCount} text field(s) from legacy escaping`, 'success'
            );
        }
    }

    // One-time repair: fix cards whose interval/nextReview were corrupted
    // by the unbounded-interval-growth bug (fixed in calculateNextReview,
    // utils.js — repeated high ratings on a graduated card could compound
    // interval without limit, eventually overflowing into an unparseable
    // date). Clamps interval to MAX_INTERVAL and recomputes nextReview
    // from today. Gated by a settings flag so it runs only once.
    async repairIntervalOverflow() {
        const flag = await window.indexedDBManager.getData('settings', 'interval-repair-v1');
        if (flag && flag.value && flag.value.completed) {
            return;
        }

        const maxInterval = APP_CONFIG.MAX_INTERVAL || 365;
        let repairedCount = 0;

        this.data.categories.forEach(category => {
            category.decks.forEach(deck => {
                deck.cards.forEach(card => {
                    const badInterval = typeof card.interval === 'number' && card.interval > maxInterval;
                    const badDate = card.nextReview && isNaN(new Date(card.nextReview).getTime());

                    if (badInterval || badDate) {
                        card.interval = Math.min(card.interval || maxInterval, maxInterval);

                        const nextDate = new Date();
                        nextDate.setDate(nextDate.getDate() + card.interval);
                        card.nextReview = getLocalDateString(nextDate);

                        repairedCount++;
                        this._syncEntity('card', this._cardRow(card, deck.id));
                    }
                });
            });
        });

        if (repairedCount > 0) {
            await this.saveData();
        }

        await window.indexedDBManager.saveData('settings', {
            key: 'interval-repair-v1',
            value: {
                completed: true,
                completedAt: new Date().toISOString(),
                repairedCount
            }
        });

        console.log(`Interval overflow repair complete: ${repairedCount} card(s) repaired`);
        if (repairedCount > 0) {
            window.uiManager.showToast(
                `Repaired ${repairedCount} card(s) with corrupted review intervals`, 'success'
            );
        }
    }

    async migrateToNormalizedStores() {
        const flag = await window.indexedDBManager.getData('settings', 'normalized-migration-v1');
        if (flag && flag.value && flag.value.completed) {
            return;
        }

        let categoryCount = 0, deckCount = 0, cardCount = 0;
        const nowIso = new Date().toISOString();

        for (const category of this.data.categories) {
            const categoryRow = {
                id: category.id,
                name: category.name,
                createdAt: category.createdAt,
                updatedAt: category.createdAt || nowIso
            };
            await window.indexedDBManager.saveData('categories', categoryRow);
            categoryCount++;

            for (const deck of category.decks) {
                const deckRow = {
                    id: deck.id,
                    categoryId: category.id,
                    name: deck.name,
                    createdAt: deck.createdAt,
                    updatedAt: deck.createdAt || nowIso
                };
                await window.indexedDBManager.saveData('decks', deckRow);
                deckCount++;

                for (const card of deck.cards) {
                    const cardRow = {
                        ...card,
                        deckId: deck.id,
                        updatedAt: card.createdAt || nowIso
                    };
                    await window.indexedDBManager.saveData('cards', cardRow);
                    cardCount++;
                }
            }
        }

        await window.indexedDBManager.saveData('statistics', {
            key: 'main',
            ...this.data.statistics,
            updatedAt: nowIso
        });

        await window.indexedDBManager.saveData('settings', {
            key: 'normalized-migration-v1',
            value: {
                completed: true,
                completedAt: nowIso,
                categoryCount,
                deckCount,
                cardCount
            }
        });

        console.log(`Normalized-store migration complete: ${categoryCount} categories, ${deckCount} decks, ${cardCount} cards`);
    }

    // Issue 7, Chunk 4b: full rebuild of the normalized stores. Used after
    // import/restore, where the entire tree may contain different entity
    // IDs than whatever is currently sitting in the normalized stores —
    // incremental sync (_syncEntity) can't safely reconcile that case, so
    // instead: clear all four stores, then repopulate from scratch using
    // the same logic as the one-time migration.
    async rebuildNormalizedStores() {
        await window.indexedDBManager.clearStore('categories');
        await window.indexedDBManager.clearStore('decks');
        await window.indexedDBManager.clearStore('cards');
        await window.indexedDBManager.clearStore('statistics');

        let categoryCount = 0, deckCount = 0, cardCount = 0;

        for (const category of this.data.categories) {
            await window.storageAdapter.putEntity('category', this._categoryRow(category));
            categoryCount++;

            for (const deck of category.decks) {
                await window.storageAdapter.putEntity('deck', this._deckRow(deck, category.id));
                deckCount++;

                for (const card of deck.cards) {
                    await window.storageAdapter.putEntity('card', this._cardRow(card, deck.id));
                    cardCount++;
                }
            }
        }

        await window.storageAdapter.putStatistics(this.data.statistics);

        console.log(`Normalized-store rebuild complete: ${categoryCount} categories, ${deckCount} decks, ${cardCount} cards`);
    }

    // Issue 7, Chunk 4b: fire-and-forget statistics sync, same pattern as
    // _syncEntity. Called anywhere this.data.statistics is mutated and saved.
    _syncStatistics() {
        window.storageAdapter.putStatistics(this.data.statistics)
            .catch(err => console.warn('Failed to sync statistics to normalized store:', err));
    }

    // Issue 7, Chunk 4a: entity-level sync to the normalized stores.
    // These run ALONGSIDE the existing whole-blob saveData() call on every
    // mutation method below — not replacing it yet — so cross-tab sync,
    // export/import, and backups keep working completely unchanged. This
    // just keeps the normalized stores continuously correct going forward
    // (previously they were only correct as of the one-time Chunk 2
    // migration and went stale immediately after).
    // Fire-and-forget, matching this file's existing saveData() pattern:
    // errors are logged, never thrown, so a sync hiccup can't block the UI.

    _categoryRow(category) {
        return { id: category.id, name: category.name, createdAt: category.createdAt };
    }

    _deckRow(deck, categoryId) {
        return { id: deck.id, categoryId, name: deck.name, createdAt: deck.createdAt };
    }

    _cardRow(card, deckId) {
        return { ...card, deckId };
    }

    _syncEntity(type, row) {
        window.storageAdapter.putEntity(type, row)
            .catch(err => console.warn(`Failed to sync ${type} to normalized store:`, err));
    }

    _deleteEntitySync(type, id) {
        window.storageAdapter.deleteEntity(type, id)
            .catch(err => console.warn(`Failed to delete ${type} from normalized store:`, err));
    }

    async _cascadeDeleteDeckRows(deck) {
        for (const card of deck.cards) {
            await window.storageAdapter.deleteEntity('card', card.id);
        }
        await window.storageAdapter.deleteEntity('deck', deck.id);
    }

    async _cascadeDeleteCategoryRows(category) {
        for (const deck of category.decks) {
            await this._cascadeDeleteDeckRows(deck);
        }
        await window.storageAdapter.deleteEntity('category', category.id);
    }

    getData() {
        return this.data;
    }

    getSettings() {
        return this.data.settings;
    }

    updateSettings(newSettings) {
        this.data.settings = { ...this.data.settings, ...newSettings };
        this.saveData();
    }

    getCategories() {
        return this.data.categories;
    }

    addCategory(name) {
        const category = {
            id: generateId(),
            name: name,
            createdAt: new Date().toISOString(),
            decks: []
        };

        this.data.categories.push(category);
        this.saveData();
        this._syncEntity('category', this._categoryRow(category));
        return category;
    }

    updateCategory(categoryId, updates) {
        const category = this.findCategory(categoryId);
        if (category) {
            Object.assign(category, updates);
            this.saveData();
            this._syncEntity('category', this._categoryRow(category));
            return category;
        }
        return null;
    }

    deleteCategory(categoryId) {
        const index = this.data.categories.findIndex(cat => cat.id === categoryId);
        if (index !== -1) {
            const category = this.data.categories[index];
            this.data.categories.splice(index, 1);
            this.saveData();
            this._cascadeDeleteCategoryRows(category)
                .catch(err => console.warn('Failed to cascade-delete category from normalized store:', err));
            return true;
        }
        return false;
    }

    findCategory(categoryId) {
        return this.data.categories.find(cat => cat.id === categoryId);
    }

    addDeck(categoryId, name) {
        const category = this.findCategory(categoryId);
        if (!category) return null;

        const deck = {
            id: generateId(),
            name: name,
            createdAt: new Date().toISOString(),
            cards: []
        };

        category.decks.push(deck);
        this.saveData();
        this._syncEntity('deck', this._deckRow(deck, categoryId));
        return deck;
    }

    updateDeck(categoryId, deckId, updates) {
        const deck = this.findDeck(categoryId, deckId);
        if (deck) {
            Object.assign(deck, updates);
            this.saveData();
            this._syncEntity('deck', this._deckRow(deck, categoryId));
            return deck;
        }
        return null;
    }

    deleteDeck(categoryId, deckId) {
        const category = this.findCategory(categoryId);
        if (!category) return false;

        const index = category.decks.findIndex(deck => deck.id === deckId);
        if (index !== -1) {
            const deck = category.decks[index];
            category.decks.splice(index, 1);
            this.saveData();
            this._cascadeDeleteDeckRows(deck)
                .catch(err => console.warn('Failed to cascade-delete deck from normalized store:', err));
            return true;
        }
        return false;
    }

    findDeck(categoryId, deckId) {
        const category = this.findCategory(categoryId);
        if (!category) return null;
        return category.decks.find(deck => deck.id === deckId);
    }

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
            interval: APP_CONFIG.DEFAULT_INTERVAL,
            easeFactor: APP_CONFIG.DEFAULT_EASE_FACTOR,
            graduationStep: 0,
            createdAt: new Date().toISOString(),
            hiddenWordsDifficulty: 0,
            recentRatings: []
        };

        deck.cards.push(card);
        this.saveData();
        this._syncEntity('card', this._cardRow(card, deckId));
        return card;
    }

    updateCard(categoryId, deckId, cardId, updates) {
        const card = this.findCard(categoryId, deckId, cardId);
        if (card) {
            Object.assign(card, updates);
            this.saveData();
            this._syncEntity('card', this._cardRow(card, deckId));
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
            this._deleteEntitySync('card', cardId);
            return true;
        }
        return false;
    }

    findCard(categoryId, deckId, cardId) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return null;
        return deck.cards.find(card => card.id === cardId);
    }

    updateCardStudyData(categoryId, deckId, cardId, difficulty) {
        const card = this.findCard(categoryId, deckId, cardId);
        if (!card) return null;

        const today = getLocalDateString();
        card.lastStudied = today;
        card.difficulty = difficulty;

        const reviewData = calculateNextReview(card, difficulty);
        card.nextReview = reviewData.nextReview;
        card.interval = reviewData.interval;
        card.easeFactor = reviewData.easeFactor;
        card.graduationStep = reviewData.graduationStep;

        this.saveData();
        this._syncEntity('card', this._cardRow(card, deckId));
        return card;
    }

    getCardsForStudySession(categoryId, deckId, maxCards = null) {
        const deck = this.findDeck(categoryId, deckId);
        if (!deck) return [];

        const cardsPerSession = maxCards ||
              this.data.settings.cardsPerSession ||
              APP_CONFIG.CARDS_PER_STUDY_SESSION;

        return getCardsForStudySession(deck.cards, cardsPerSession);
    }

    async importData(jsonData) {
        try {
            let mainData, imageData;

            if (jsonData.data && jsonData.images) {
                mainData = jsonData.data;
                imageData = jsonData.images;
            } else {
                mainData = jsonData;
                imageData = {};
            }

            if (!mainData.settings || !mainData.categories) {
                throw new Error('Invalid data format');
            }

            this.data = mainData;
            await this.saveData();

            for (const [key, value] of Object.entries(imageData)) {
                if (key.startsWith('mindforge-image-')) {
                    try {
                        const imageDataObj = JSON.parse(value);
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

            // Rebuild the normalized stores to match the freshly imported
            // tree (Issue 7, Chunk 4b) — incremental sync can't be used here
            // since imported IDs may not match what's currently stored.
            await this.rebuildNormalizedStores();
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }

    async exportData() {
        const mainData = this.data;
        const imageData = {};

        try {
            const images = await window.indexedDBManager.getAllData('images');

            for (const img of images) {
                const key = `mindforge-image-${img.filename}`;

                try {
                    if (!img.blob || !(img.blob instanceof Blob)) {
                        console.warn(`Skipping image ${img.filename}: not a valid Blob`);
                        continue;
                    }

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

        deck.cards.forEach(card => {
            card.difficulty = null;
            card.lastStudied = null;
            card.nextReview = null;
            card.interval = APP_CONFIG.DEFAULT_INTERVAL;
            card.easeFactor = APP_CONFIG.DEFAULT_EASE_FACTOR;
            card.graduationStep = 0;
            this._syncEntity('card', this._cardRow(card, deckId));
        });

        this.saveData();
        return true;
    }

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

        const previousValidSessionsToday = stats.studySessions.filter(session =>
            session.date === today &&
                session.cardsStudied >= APP_CONFIG.MIN_CARDS_FOR_DAY_COUNT
        );
        const isFirstValidSessionToday = previousValidSessionsToday.length === 0;

        stats.studySessions.push({
            date: today,
            cardsStudied: sessionData.cardsStudied,
            timeSpent: sessionData.timeSpent,
            wasDistracted: sessionData.wasDistracted,
            cardIds: sessionData.cardIds
        });

        stats.totalCardInstances += sessionData.cardsStudied;

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

        if (sessionData.cardsStudied >= APP_CONFIG.MIN_CARDS_FOR_DAY_COUNT &&
            !sessionData.wasDistracted) {

            if (isFirstValidSessionToday) {
                stats.daysStudied++;
            }
        }

        if (!sessionData.wasDistracted) {
            stats.totalTimeStudied += sessionData.timeSpent;
        }

        if (sessionData.cardsStudied >= APP_CONFIG.MIN_CARDS_FOR_DAY_COUNT && isFirstValidSessionToday) {
            if (!stats.lastStudyDate) {
                stats.currentStreak = 1;
            } else {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = getLocalDateString(yesterday);

                if (stats.lastStudyDate === yesterdayStr) {
                    stats.currentStreak++;
                } else if (stats.lastStudyDate === today) {
                    // Already studied today - maintain current streak (don't reset)
                } else {
                    const yesterdayValidSessions = stats.studySessions.filter(session =>
                        session.date === yesterdayStr &&
                            session.cardsStudied >= APP_CONFIG.MIN_CARDS_FOR_DAY_COUNT
                    );

                    if (yesterdayValidSessions.length > 0) {
                        stats.currentStreak++;
                    } else {
                        stats.currentStreak = 1;
                    }
                }
            }

            if (stats.currentStreak > (stats.recordStreak || 0)) {
                stats.recordStreak = stats.currentStreak;
            }

            stats.lastStudyDate = today;
        }

        this.saveData();
        this._syncStatistics();
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

    async getStorageStats() {
        try {
            const images = await window.indexedDBManager.getAllData('images');
            const imageCount = images.length;
            const imageBytes = images.reduce((sum, img) => sum + (img.size || 0), 0);

            const estimate = await navigator.storage.estimate();
            const totalBytes = estimate.usage || 0;

            return {
                imageCount,
                imageBytes,
                totalBytes
            };
        } catch (error) {
            console.error('Error getting storage stats:', error);
            return { imageCount: 0, imageBytes: 0, totalBytes: 0 };
        }
    }

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
        this._syncStatistics();
    }

    setCurrentStreak(days) {
        if (!this.data.statistics) {
            this.data.statistics = {};
        }
        this.data.statistics.currentStreak = days;
        this.saveData();
        this._syncStatistics();
    }

    setRecordStreak(days) {
        if (!this.data.statistics) {
            this.data.statistics = {};
        }
        this.data.statistics.recordStreak = days;
        this.saveData();
        this._syncStatistics();
    }

    // Issue 7, Chunk 5: BroadcastChannel-based cross-tab sync, replacing
    // the old 2-second poll of a 'data-sync-timestamp' settings key. Each
    // tab posts a message right after it saves; every OTHER tab (never the
    // sender — that's a browser-guaranteed property of BroadcastChannel)
    // reacts immediately instead of waiting up to 2 seconds. This also
    // structurally eliminates the old poller's self-reload-on-own-write
    // quirk, since a tab can no longer see its own messages.
    setupCrossTabSync() {
        this.syncChannel = new BroadcastChannel('mindforge-data-sync');

        this.syncChannel.onmessage = async (event) => {
            try {
                if (event.data && event.data.type === 'data-changed') {
                    console.log('Data changed in another tab, reloading...');
                    await this._refreshFromOtherTab();
                }
            } catch (error) {
                console.warn('Error handling cross-tab update:', error);
            }
        };

        // Issue 7, Chunk 5b: a backgrounded tab can have its BroadcastChannel
        // message handling throttled by the browser for as long as it stays
        // hidden — a message sent while this tab was in the background may
        // not finish processing until well after the tab regains focus.
        // As a safety net, force a fresh reload the moment this tab becomes
        // visible again, regardless of whether a message arrived.
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible') {
                try {
                    console.log('Tab regained focus, refreshing data...');
                    await this._refreshFromOtherTab();
                } catch (error) {
                    console.warn('Error refreshing on tab focus:', error);
                }
            }
        });
    }

    // Shared by the BroadcastChannel handler and the visibilitychange
    // listener: reload from IndexedDB and refresh the UI.
    async _refreshFromOtherTab() {
        await this.loadData();

        if (window.categoryManager) {
            window.categoryManager.renderCategories();
        }
        if (window.uiManager) {
            window.uiManager.updateSidebarStats();
        }
    }

    // Notify other tabs that the whole-blob data changed. Fire-and-forget,
    // safe to call even if setupCrossTabSync() hasn't run yet (e.g. during
    // very early init before the channel exists).
    _broadcastDataChanged() {
        if (this.syncChannel) {
            this.syncChannel.postMessage({ type: 'data-changed', at: Date.now() });
        }
    }

    checkStreakValidity() {
        if (!this.data.statistics || !this.data.statistics.lastStudyDate) {
            return;
        }

        const stats = this.data.statistics;
        const today = getLocalDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterday);

        if (stats.lastStudyDate < yesterdayStr && stats.currentStreak > 0) {
            stats.currentStreak = 0;
            this.saveData();
            this._syncStatistics();
        }
    }

    async performDailyMaintenance() {
        const today = getLocalDateString();
        const lastMaintenanceDate = await window.indexedDBManager.getData('settings', 'last-maintenance-date');

        if (lastMaintenanceDate && lastMaintenanceDate.value === today) {
            return;
        }

        console.log('=== PERFORMING DAILY MAINTENANCE ===');

        try {
            const data = await this.exportData();
            const filename = `${APP_CONFIG.APP_NAME.toLowerCase()}-daily.json`;

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

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            const cutoffStr = getLocalDateString(cutoffDate);
            const beforeCount = this.data.statistics.studySessions.length;
            this.data.statistics.studySessions = this.data.statistics.studySessions.filter(
                session => session.date >= cutoffStr
            );
            const pruned = beforeCount - this.data.statistics.studySessions.length;
            if (pruned > 0) {
                console.log(`✓ Pruned ${pruned} old session record(s)`);
            } else {
                console.log('✓ No session records to prune');
            }
        } catch (error) {
            console.error('✗ Session pruning failed:', error);
        }

        await window.indexedDBManager.saveData('settings', {
            key: 'last-maintenance-date',
            value: today
        });

        console.log('=== DAILY MAINTENANCE COMPLETE ===');
    }

    async cleanupOrphanedImages() {
        try {
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

            const allImages = await window.indexedDBManager.getAllData('images');

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

// ----------------------------------------------------------------------
