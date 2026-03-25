// IndexedDB Database Manager
class IndexedDBManager {
    constructor() {
        this.dbName = 'MindforgeDB';
        this.dbVersion = 1;
        this.db = null;
    }

    // Initialize the database
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object stores
                if (!db.objectStoreNames.contains('appData')) {
                    const appDataStore = db.createObjectStore('appData', { keyPath: 'id' });
                    // Index for faster queries if needed
                    appDataStore.createIndex('type', 'type', { unique: false });
                }

                if (!db.objectStoreNames.contains('images')) {
                    const imagesStore = db.createObjectStore('images', { keyPath: 'filename' });
                    imagesStore.createIndex('savedAt', 'savedAt', { unique: false });
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                console.log('IndexedDB object stores created');
            };
        });
    }

    // Generic method to get data from a store
    async getData(storeName, key = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            let request;
            if (key) {
                request = store.get(key);
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Generic method to save data to a store
    async saveData(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Generic method to delete data from a store
    async deleteData(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Get all data from a store
    async getAllData(storeName) {
        return this.getData(storeName);
    }

    // Clear a store
    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Check if IndexedDB is supported
    static isSupported() {
        return 'indexedDB' in window;
    }

    // Convert a data URL to a Blob
    async dataUrlToBlob(dataUrl) {
        const response = await fetch(dataUrl);
        return await response.blob();
    }

    // Migration helper: get all localStorage image keys
    getLocalStorageImageKeys() {
        const imageKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mindforge-image-')) {
                imageKeys.push(key);
            }
        }
        return imageKeys;
    }

    // Migration: move data from localStorage to IndexedDB
    async migrateFromLocalStorage() {
        console.log('Starting migration from localStorage to IndexedDB...');

        try {
            // Migrate main app data
            const mainData = localStorage.getItem('mindforge-data');
            if (mainData) {
                const parsedData = JSON.parse(mainData);
                await this.saveData('appData', {
                    id: 'main',
                    type: 'main',
                    data: parsedData
                });
                console.log('Main app data migrated to IndexedDB');
            }

            // Migrate images - convert from base64 to Blob
            const imageKeys = this.getLocalStorageImageKeys();
            console.log(`Migrating ${imageKeys.length} images...`);

            for (const key of imageKeys) {
                const imageDataStr = localStorage.getItem(key);
                if (imageDataStr) {
                    try {
                        const imageData = JSON.parse(imageDataStr);

                        // Convert data URL to Blob
                        const blob = await this.dataUrlToBlob(imageData.dataUrl);

                        await this.saveData('images', {
                            filename: imageData.filename,
                            blob: blob,
                            originalName: imageData.originalName,
                            size: imageData.size,
                            type: imageData.type,
                            savedAt: imageData.savedAt
                        });
                    } catch (error) {
                        console.warn(`Failed to migrate image ${key}:`, error);
                    }
                }
            }

            console.log('Migration completed successfully');

            // Mark migration as completed
            await this.saveData('settings', {
                key: 'migration',
                value: {
                    completed: true,
                    completedAt: new Date().toISOString(),
                    localStorageCleared: false
                }
            });

            return true;
        } catch (error) {
            console.error('Migration failed:', error);
            return false;
        }
    }

    // Clean up localStorage after successful migration
    async cleanupLocalStorage() {
        try {
            // Remove main data
            localStorage.removeItem('mindforge-data');

            // Remove all image data
            const imageKeys = this.getLocalStorageImageKeys();
            imageKeys.forEach(key => localStorage.removeItem(key));

            // Update migration status
            await this.saveData('settings', {
                key: 'migration',
                value: {
                    completed: true,
                    completedAt: new Date().toISOString(),
                    localStorageCleared: true
                }
            });

            console.log('localStorage cleanup completed');
            return true;
        } catch (error) {
            console.error('localStorage cleanup failed:', error);
            return false;
        }
    }

    // Check migration status
    async getMigrationStatus() {
        try {
            const migrationData = await this.getData('settings', 'migration');
            return migrationData ? migrationData.value : null;
        } catch (error) {
            return null;
        }
    }
}

// Create global instance
window.indexedDBManager = new IndexedDBManager();
