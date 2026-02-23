// Main application initialization for Mindforge

class MindforgeApp {
    constructor() {
        this.isInitialized = false;
    }

    // Initialize the application
    async init() {
        try {
            console.log('Initializing Mindforge...');

            await window.dataManager.init();
            window.uiManager.init();
            window.categoryManager.init();
            this.setupRouting();
            this.setupGlobalEventHandlers();
            this.checkInitialState();

            this.isInitialized = true;
            console.log('Mindforge initialized successfully');

        } catch (error) {
            console.error('Error initializing Mindforge:', error);
            this.showInitializationError(error);
        }
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

        // Handle keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleGlobalKeyboardShortcuts(e);
        });

        // Auto-save periodically
        setInterval(() => {
            if (window.dataManager && window.dataManager.data) {
                window.dataManager.saveData();
            }
        }, MINDFORGE_CONFIG.AUTO_SAVE_INTERVAL);

    }

    // Handle global keyboard shortcuts
    handleGlobalKeyboardShortcuts(e) {
        // Don't handle shortcuts if user is typing in an input
        if (e.target.matches('input, textarea, select')) {
            return;
        }

        // Don't handle shortcuts if modal is open (except ESC)
        if (window.uiManager.modal && window.uiManager.modal.classList.contains('active') && e.key !== 'Escape') {
            return;
        }

        // Non-modifier shortcuts
        if (!e.ctrlKey && !e.metaKey) {
            switch (e.key) {
            case 'Escape':
                if (window.studyManager.isStudying()) {
                    window.studyManager.endStudySession();
                } else if (window.uiManager.modal && window.uiManager.modal.classList.contains('active')) {
                    window.uiManager.closeModal();
                }
                break;
            }
        }
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
            link.download = `mindforge-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
            window.uiManager.showToast('Data exported successfully', 'success');
        } catch (error) {
            window.uiManager.showToast('Error exporting data: ' + error.message, 'error');
        }
    }

    showImportModal() {
        const template = document.getElementById('import-data-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'import',
                handler: () => this.handleImportData()
            }
        ];

        window.uiManager.showTemplateModal('Import Data', content, actions);
    }

    async handleImportData() {
        const fileInput = document.getElementById('import-file');
        const file = fileInput.files[0];

        if (!file) {
            window.uiManager.showToast('Please select a file to import', 'error');
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const success = await window.dataManager.importData(data);
            if (success) {
                window.uiManager.closeModal();
                window.uiManager.showToast('Data imported successfully', 'success');

                // Refresh the UI
                window.categoryManager.renderCategories();
                window.uiManager.loadTheme();
                window.uiManager.showScreen('welcome-screen');
            } else {
                window.uiManager.showToast('Error importing data', 'error');
            }
        } catch (error) {
            window.uiManager.showToast('Invalid file format: ' + error.message, 'error');
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
            name: 'Mindforge',
            version: '1.0.0',
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

            // Add Mindforge title click handler after router is ready
            const mindforgeTitle = document.querySelector('.header-top h1');
            if (mindforgeTitle) {
                mindforgeTitle.addEventListener('click', () => {
                    window.routerManager.navigate('/');
                });
                console.log('Mindforge title click handler added in setupRouting');
            }
        }, 50);
    }

} // end of MindforgeApp class

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, starting Mindforge...');

    // Create global app instance
    window.mindforgeApp = new MindforgeApp();

    // Initialize the application
    await window.mindforgeApp.init();
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
    getAppInfo: () => window.mindforgeApp?.getAppInfo(),
    exportData: () => window.dataManager?.exportData(),
    clearData: () => {
        localStorage.clear();
        location.reload();
    },
    reloadApp: () => location.reload()
};
