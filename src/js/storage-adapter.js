// storage-adapter.js - Storage adapter interface for Mindforge
//
// This defines the contract DataManager uses to persist entities,
// independent of *how* they're actually stored. IndexedDBAdapter (below)
// is the first implementation. A future TauriAdapter (local SQLite via
// Rust) and SyncedAdapter (Cloudflare D1 via a Worker) are expected to
// implement the same contract. Once Chunk 4 wires this in, DataManager
// should only ever go through the active adapter — never call
// window.indexedDBManager directly.
//
// Contract:
//   async getEntity(type, id)        -> entity object | undefined
//   async listEntities(type, query?) -> array of entity objects
//   async putEntity(type, entity)    -> saved entity (updatedAt stamped)
//   async deleteEntity(type, id)     -> true | false
//   async getStatistics()            -> statistics object | undefined
//   async putStatistics(stats)       -> saved statistics object
//
// 'type' is one of: 'category', 'deck', 'card'
// 'query' for listEntities is optional: { categoryId } for decks,
// { deckId } for cards. Omit query to list every entity of that type.

const ENTITY_STORE_MAP = {
    category: 'categories',
    deck: 'decks',
    card: 'cards'
};

const ENTITY_INDEX_MAP = {
    deck: 'categoryId',
    card: 'deckId'
};

class IndexedDBAdapter {
    constructor(indexedDBManager) {
        this.db = indexedDBManager;
    }

    _storeFor(type) {
        const store = ENTITY_STORE_MAP[type];
        if (!store) {
            throw new Error(`IndexedDBAdapter: unknown entity type "${type}"`);
        }
        return store;
    }

    async getEntity(type, id) {
        const store = this._storeFor(type);
        return this.db.getData(store, id);
    }

    async listEntities(type, query = null) {
        const store = this._storeFor(type);

        if (query) {
            const indexName = ENTITY_INDEX_MAP[type];
            const value = indexName ? query[indexName] : undefined;
            if (indexName && value !== undefined) {
                return this.db.getByIndex(store, indexName, value);
            }
        }

        return this.db.getAllData(store);
    }

    async putEntity(type, entity) {
        const store = this._storeFor(type);
        const stamped = {
            ...entity,
            updatedAt: new Date().toISOString()
        };
        await this.db.saveData(store, stamped);
        return stamped;
    }

    async deleteEntity(type, id) {
        const store = this._storeFor(type);
        return this.db.deleteData(store, id);
    }

    async getStatistics() {
        return this.db.getData('statistics', 'main');
    }

    async putStatistics(stats) {
        const stamped = {
            ...stats,
            key: 'main',
            updatedAt: new Date().toISOString()
        };
        await this.db.saveData('statistics', stamped);
        return stamped;
    }
}

// Global instance, wired to the existing indexedDBManager singleton
window.storageAdapter = new IndexedDBAdapter(window.indexedDBManager);

// ----------------------------------------------------------------------
