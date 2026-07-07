// router.js - Simple hash-based router
class RouterManager {
    constructor() {
        this.routes = {};
        this.init();
    }

    init() {
        // Listen for hash changes only. The initial route is dispatched
        // explicitly by TheApp.init() once data loading has completed —
        // see app.js. This router no longer guesses timing on its own.
        window.addEventListener('hashchange', () => this.handleRoute());
    }

    // Register a route handler
    addRoute(pattern, handler) {
        this.routes[pattern] = handler;
    }

    // Parse current hash and execute matching route
    handleRoute() {
        const hash = window.location.hash.slice(1) || '/'; // Remove #

        // Try to match routes
        for (const pattern in this.routes) {
            const match = this.matchRoute(pattern, hash);
            if (match) {
                this.routes[pattern](match.params);
                return;
            }
        }

        // Default route if no match
        this.goToWelcome();
    }

    // Simple route matching with parameters
    matchRoute(pattern, hash) {
        const patternParts = pattern.split('/');
        const hashParts = hash.split('/');

        if (patternParts.length !== hashParts.length) {
            return null;
        }

        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            const hashPart = hashParts[i];

            if (patternPart.startsWith(':')) {
                // Parameter
                params[patternPart.slice(1)] = hashPart;
            } else if (patternPart !== hashPart) {
                // Literal doesn't match
                return null;
            }
        }

        return { params };
    }

    // Navigate to a specific route
    navigate(hash) {
        if (window.location.hash === '#' + hash) {
            // If we're already at this route, manually trigger the route handler
            this.handleRoute();
        } else {
            window.location.hash = hash;
        }
    }

    // Route handlers
    goToWelcome() {
        window.uiManager.showScreen('welcome-screen');
    }

    goToCategory(params) {
        const category = window.dataManager.findCategory(params.categoryId);
        if (category) {
            window.categoryManager.selectCategory(params.categoryId);
        } else {
            this.goToWelcome();
        }
    }

    goToStudy(params) {
        const category = window.dataManager.findCategory(params.categoryId);
        const deck = window.dataManager.findDeck(params.categoryId, params.deckId);

        if (category && deck) {
            // Always start a fresh study session when navigating via URL
            window.studyManager.startStudySession(params.categoryId, params.deckId);
        } else {
            this.goToWelcome();
        }
    }

    goToPreview(params) {
        const category = window.dataManager.findCategory(params.categoryId);
        const deck = window.dataManager.findDeck(params.categoryId, params.deckId);

        if (category && deck) {
            window.uiManager.showPreviewScreen(category, deck);
        } else {
            this.goToWelcome();
        }
    }
}

// Create global instance
window.routerManager = new RouterManager();
