// Main application initialization

class TheApp {
    constructor() {
        this.isInitialized = false;
    }

    // Initialize the application
    async init() {
        try {
            console.log('Initializing app ...');

            this.setupAppInfo();
            await window.dataManager.init();
            window.uiManager.init();
            window.categoryManager.init();
            this.setupRouting();
            this.setupGlobalEventHandlers();
            this.checkInitialState();

            this.isInitialized = true;
            console.log('App initialized successfully');
            await this.requestPersistentStorage();

        } catch (error) {
            console.error('Error initializing app:', error);
            this.showInitializationError(error);
        }
    }

    // Request persistent storage to protect IndexedDB from eviction
    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            console.log(`Persistent storage granted: ${granted}`);
        }
    }

    // Set app name and version from config
    setupAppInfo() {
        const name = APP_CONFIG.APP_NAME;
        const nameLower = name.toLowerCase();

        document.title = `${name} - Flashcard Learning`;

        const sidebarTitle = document.querySelector('.header-top h1');
        if (sidebarTitle) sidebarTitle.textContent = name;

        const mobileTitle = document.querySelector('.mobile-header-title');
        if (mobileTitle) mobileTitle.textContent = name;

        const welcomeTitle = document.getElementById('welcome-app-name');
        if (welcomeTitle) welcomeTitle.textContent = `Welcome to ${name}`;

        const menuAbout = document.getElementById('menu-about-name');
        if (menuAbout) menuAbout.textContent = `About ${name}`;

        const gettingStarted = document.getElementById('getting-started-app-name');
        if (gettingStarted) gettingStarted.textContent = `Welcome to ${name}! 🧠`;

        const sidebarVersion = document.getElementById('sidebar-version');
        if (sidebarVersion) sidebarVersion.textContent = `Version ${APP_CONFIG.APP_VERSION}`;
    }

    // Set up global event handlers
    setupGlobalEventHandlers() {
        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            // Handle navigation state if needed
        });

        // Handle beforeunload to save data
        window.addEventListener('beforeunload', (e) => {
            // Auto-save data before closing
            if (window.dataManager && window.dataManager.data) {
                window.dataManager.saveData();
            }
        });

        // Auto-save periodically
        setInterval(() => {
            if (window.dataManager && window.dataManager.data) {
                window.dataManager.saveData();
            }
        }, APP_CONFIG.AUTO_SAVE_INTERVAL);

    }


    // Check initial application state
    checkInitialState() {
        const categories = window.dataManager.getCategories();

        if (categories.length === 0) {
            // Only show first-time guidance if there's no hash route
            if (!window.location.hash) {
                window.uiManager.showScreen('welcome-screen');
                this.showFirstTimeUserGuidance();
            }
        }
    }

    // Show guidance for first-time users
    showFirstTimeUserGuidance() {
        setTimeout(() => {
            const template = document.getElementById('getting-started-template');
            const content = template.content.cloneNode(true);

            const actions = [
                {
                    action: 'create',
                    handler: () => {
                        window.uiManager.closeModal();
                        window.categoryManager.showAddCategoryModal();
                    }
                }
            ];

            window.uiManager.showTemplateModal('Getting Started', content, actions);
        }, 1000);
    }


    // Data import/export functionality
    async exportData() {
        try {
            const data = await window.dataManager.exportData();
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `${APP_CONFIG.APP_NAME.toLowerCase()}-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
            window.uiManager.showToast('Data exported successfully', 'success');
        } catch (error) {
            window.uiManager.showToast('Error exporting data: ' + error.message, 'error');
        }
    }

    // Show initialization error
    showInitializationError(error) {
        const template = document.getElementById('initialization-error-template');
        const content = template.content.cloneNode(true);

        // Populate the error message
        content.getElementById('error-details').textContent = `Error: ${error.message}`;

        // Replace the entire body content
        document.body.innerHTML = '';
        document.body.appendChild(content);
    }

    // Get application info
    getAppInfo() {
        return {
            name: APP_CONFIG.APP_NAME,
            version: APP_CONFIG.APP_VERSION,
            initialized: this.isInitialized,
            dataManager: !!window.dataManager,
            uiManager: !!window.uiManager,
            categoryManager: !!window.categoryManager,
            cardManager: !!window.cardManager,
            studyManager: !!window.studyManager
        };
    }

    setupRouting() {
        // Small delay to ensure all managers are fully initialized
        setTimeout(() => {
            // Register routes
            window.routerManager.addRoute('/', () => {
                window.uiManager.showScreen('welcome-screen');
            });

            window.routerManager.addRoute('/category/:categoryId', (params) => {
                window.routerManager.goToCategory(params);
            });

            window.routerManager.addRoute('/study/:categoryId/:deckId', (params) => {
                window.routerManager.goToStudy(params);
            });

            window.routerManager.addRoute('/preview/:categoryId/:deckId', (params) => {
                window.routerManager.goToPreview(params);
            });
        }, 50);
    }

} // end of TheApp class

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, starting app...');

    // Create global app instance
    window.theApp = new TheApp();

    // Initialize the application
    await window.theApp.init();
});

// Handle any unhandled errors
window.addEventListener('error', (e) => {
    console.error('Unhandled error:', e.error);

    if (window.uiManager) {
        window.uiManager.showToast('An unexpected error occurred', 'error');
    }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);

    if (window.uiManager) {
        window.uiManager.showToast('An unexpected error occurred', 'error');
    }

    // Prevent the default browser behavior
    e.preventDefault();
});

// Export for debugging
window.DEBUG = {
    getAppInfo: () => window.theApp?.getAppInfo(),
    exportData: () => window.dataManager?.exportData(),
    clearData: () => {
        localStorage.clear();
        location.reload();
    },
    reloadApp: () => location.reload()
};
