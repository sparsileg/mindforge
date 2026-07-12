// UI management

class UIManager {
    constructor() {
        this.currentScreen = 'welcome';
        this.currentCategory = null;
        this.currentDeck = null;
        this.modal = null;
        this.themeSelect = null;
        this.hamburgerMenu = null;
        this.hamburgerBtn = null;
    }

    init() {
        this.modal = document.getElementById('modal');
        this.themeSelect = document.getElementById('theme-select');
        this.hamburgerMenu = document.getElementById('hamburger-menu');
        this.hamburgerBtn = document.getElementById('hamburger-menu-btn');
        this.setupEventListeners();
        this.loadTheme();
        this.updateSidebarStats();
        this.setupMobileNav();
    }

    setupEventListeners() {
        // Theme selector
        this.themeSelect.addEventListener('change', (e) => {
            this.changeTheme(e.target.value);
        });

        // Modal close
        document.getElementById('modal-close').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal when clicking outside
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        // ESC key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('active')) {
                this.closeModal();
            }
            if (e.key === 'Escape' && this.hamburgerMenu.classList.contains('active')) {
                this.closeHamburgerMenu();
            }
        });

        // Hamburger menu toggle
        this.hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleHamburgerMenu();
        });

        // Hamburger menu items
        this.hamburgerMenu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.menu-item');
            if (menuItem) {
                const action = menuItem.dataset.action;
                this.handleHamburgerMenuAction(action);
                this.closeHamburgerMenu();
            }
        });

        // Close hamburger menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.hamburgerMenu.contains(e.target) && !this.hamburgerBtn.contains(e.target)) {
                this.closeHamburgerMenu();
            }
        });

        // Make title clickable to go home
        const theAppTitle = document.querySelector('.header-top h1');
        if (theAppTitle) {
            theAppTitle.addEventListener('click', () => {
                if (window.routerManager) {
                    window.routerManager.navigate('/');
                }
            });
        }
    }

    // Theme management
    loadTheme() {
        const settings = window.dataManager.getSettings();
        const theme = settings.theme || 'dark';
        this.themeSelect.value = theme;
        this.applyTheme(theme);
    }

    changeTheme(theme) {
        window.dataManager.updateSettings({ theme });
        this.applyTheme(theme);
    }

    applyTheme(theme) {
        const themeLink = document.getElementById('theme-css');
        themeLink.href = `css/themes/${theme}.css`;
    }

    // Screen management
    showScreen(screenId, data = {}) {
        // If leaving the preview screen for anything else, release any
        // object URLs created for its card images (Issue 42) — otherwise
        // they'd stay alive until the next time preview happens to be
        // re-entered.
        if (this.currentScreen === 'preview-screen' && screenId !== 'preview-screen') {
            this.revokePreviewImageUrls();
        }

        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;

            // Update screen content based on data
            this.updateScreenContent(screenId, data);

            // Render overview if showing welcome screen
            if (screenId === 'welcome-screen') {
                this.renderHomeOverview();
            }
        }
    }

    updateScreenContent(screenId, data) {
        switch (screenId) {
        case 'category-screen':
            this.updateCategoryScreen(data);
            break;
        case 'study-screen':
            this.updateStudyScreen(data);
            break;
        }
    }

    updateCategoryScreen(data) {
        if (data.category) {
            this.currentCategory = data.category;
            document.getElementById('category-title').textContent = data.category.name;
            this.renderDecks(data.category.decks);
        }
    }

    updateStudyScreen(data) {
        // Study screen will be handled by StudyManager
    }

    // Render functions
    renderCategories(categories) {
        const container = document.getElementById('categories-list');
        container.innerHTML = '';

        categories.forEach(category => {
            const categoryEl = document.createElement('div');
            categoryEl.className = 'category-item';
            categoryEl.dataset.categoryId = category.id;

            const deckCount = category.decks.length;
            const totalCards = category.decks.reduce((sum, deck) => sum + deck.cards.length, 0);

            categoryEl.innerHTML = `
            <div class="category-info">
                <div class="category-name">${escapeHtml(category.name)}</div>
                <div class="category-stats">${deckCount} decks • ${totalCards} cards</div>
            </div>
            <button class="category-menu-btn" data-category-id="${category.id}">⋯</button>
            `;

            // Click handler for category selection (but not menu button)
            categoryEl.addEventListener('click', (e) => {
                if (!e.target.closest('.category-menu-btn')) {
                    window.categoryManager.selectCategory(category.id);
                }
            });

            // Add click handler for menu button
            const menuBtn = categoryEl.querySelector('.category-menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCategoryMenu(e, category.id);
            });

            container.appendChild(categoryEl);
        });

        // Refresh home overview if we're on the welcome screen
        if (this.currentScreen === 'welcome-screen') {
            this.renderHomeOverview();
        }
    }

	renderDecks(decks) {
		const container = document.getElementById('decks-list');
		container.innerHTML = '';

		if (decks.length === 0) {
			container.innerHTML = `
				<div class="empty-state">
					<p>No decks yet. Create your first deck to get started!</p>
				</div>
			`;
			return;
		}

		decks.forEach(deck => {
			const deckEl = document.createElement('div');
			deckEl.className = 'deck-card';
			deckEl.dataset.deckId = deck.id;

            const cardCount = deck.cards.length;
			const sessionSize = window.dataManager.getSettings().cardsPerSession || APP_CONFIG.CARDS_PER_STUDY_SESSION;
			const stats = calculateAdvancedStudyStats(deck.cards, sessionSize);

            deckEl.innerHTML = `
				<div class="deck-card-header">
					<h3>${escapeHtml(deck.name)}</h3>
					<button class="deck-menu-btn" data-deck-id="${deck.id}">⋯</button>
				</div>
                <p>${cardCount} total cards${stats.needsPractice > 0 ? ` • ${stats.needsPractice} needs practice` : ''}</p>
				<p>${stats.newCards} new • ${stats.learningCards} learning • ${stats.graduatedCards} graduated</p>
				<button class="mobile-preview-btn" data-deck-id="${deck.id}">Preview</button>
			`;

            // Add click handler for deck (but not menu button) - go directly to study
            deckEl.addEventListener('click', (e) => {
                if (!e.target.closest('.deck-menu-btn') && !e.target.closest('.mobile-preview-btn')) {
                    window.studyManager.startStudySession(this.currentCategory.id, deck.id);
                }
            });

            // Mobile preview button
            const mobilePreviewBtn = deckEl.querySelector('.mobile-preview-btn');
            mobilePreviewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.categoryManager.previewDeck(deck.id);
            });

			// Add click handler for menu button
			const menuBtn = deckEl.querySelector('.deck-menu-btn');
			menuBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent deck selection
				this.showDeckMenu(e, deck.id);
			});

			container.appendChild(deckEl);
		});
	}

    // Modal management
    showModal(title, content, actions = []) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;

        // Add action buttons
        if (actions.length > 0) {
            const actionsHTML = actions.map(action =>
                `<button class="${action.class || 'btn-primary'}" data-action="${action.action}">${action.text}</button>`
            ).join('');

            document.getElementById('modal-body').innerHTML += `
                <div class="form-actions">${actionsHTML}</div>
            `;

            // Add event listeners for action buttons
            actions.forEach(action => {
                const button = document.querySelector(`[data-action="${action.action}"]`);
                if (button && action.handler) {
                    button.addEventListener('click', action.handler);
                }
            });
        }

        this.modal.classList.add('active');
    }

    closeModal() {
        this.modal.classList.remove('active');

        // Release any tracked image-preview object URL from the add/edit
        // card modal (Issue 42). This X-button / outside-click / Escape
        // path bypasses cardManager's own cancel/save handlers, so this
        // is the catch-all cleanup point. Safe to call unconditionally —
        // it's a no-op when no card modal was open.
        if (window.cardManager) {
            window.cardManager.resetCardOperation();
        }

        // Clear modal content
        setTimeout(() => {
            document.getElementById('modal-body').innerHTML = '';
        }, 300);
    }

    // Utility functions
    showToast(message, type = 'info') {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);

		// Remove after configured duration
		setTimeout(() => {
			toast.classList.remove('show');
			setTimeout(() => {
				if (toast.parentNode) {
					toast.parentNode.removeChild(toast);
				}
			}, APP_CONFIG.ANIMATION_DURATION);
		}, APP_CONFIG.TOAST_DURATION);
    }

    // Update active category in sidebar
    updateActiveSidebarItem(categoryId) {
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('active');
        });

        if (categoryId) {
            const activeItem = document.querySelector(`[data-category-id="${categoryId}"]`);
            if (activeItem) {
                activeItem.classList.add('active');
            }
        }
    }

    // Get current context
    getCurrentContext() {
        return {
            screen: this.currentScreen,
            category: this.currentCategory,
            deck: this.currentDeck
        };
    }

    // Hamburger menu management
    toggleHamburgerMenu() {
        if (this.hamburgerMenu.classList.contains('active')) {
            this.closeHamburgerMenu();
        } else {
            this.openHamburgerMenu();
        }
    }

    openHamburgerMenu() {
        // Position the menu relative to the hamburger button
        const btnRect = this.hamburgerBtn.getBoundingClientRect();
        this.hamburgerMenu.style.position = 'fixed';
        this.hamburgerMenu.style.top = (btnRect.bottom + 5) + 'px';
        this.hamburgerMenu.style.left = (btnRect.right - 200) + 'px'; // 200px is menu width

        this.hamburgerMenu.classList.add('active');
        this.hamburgerBtn.classList.add('active');
    }

    closeHamburgerMenu() {
        this.hamburgerMenu.classList.remove('active');
        this.hamburgerBtn.classList.remove('active');
    }

    handleHamburgerMenuAction(action) {
        switch (action) {
        case 'statistics':
            this.showStatistics();
            break;
        case 'create-backup':
            this.createBackup();
            break;
        case 'import-data':
            this.showImportModal();
            break;
        case 'settings':
            this.showSettings();
            break;
        case 'reset-all-progress':
            this.confirmResetAllProgress();
            break;
        case 'about':
            this.showAbout();
            break;
        }
    }

    async createBackup() {
        try {
            const data = await window.dataManager.exportData();
            const now = new Date();
            const datePart = now.getFullYear().toString() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0');
            const timePart = String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');
            const version = APP_CONFIG.APP_VERSION;
            const appName = APP_CONFIG.APP_NAME;
            const jsonFilename = `${appName}-v${version}-${datePart}-${timePart}.json`;
            const zipFilename = `${appName}-v${version}-${datePart}-${timePart}.zip`;

            const zip = new JSZip();
            zip.file(jsonFilename, data);
            const zipBlob = await zip.generateAsync({ type: 'blob' });

            const url = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            this.showToast('Backup created successfully', 'success');
        } catch (error) {
            this.showToast('Error creating backup: ' + error.message, 'error');
        }
    }

    showImportModal() {
        const template = document.getElementById('import-data-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => this.closeModal()
            },
            {
                action: 'import',
                handler: () => this.handleImportData()
            }
        ];

        this.showTemplateModal('Import Data', content, actions);
    }

    async handleImportData() {
        const fileInput = document.getElementById('import-file');
        const file = fileInput.files[0];

        if (!file) {
            this.showToast('Please select a file to import', 'error');
            return;
        }

        try {
            let jsonText;

            if (file.name.endsWith('.zip')) {
                const zip = await JSZip.loadAsync(file);
                const jsonFile = Object.values(zip.files).find(f => f.name.endsWith('.json'));
                if (!jsonFile) {
                    this.showToast('No JSON file found inside zip', 'error');
                    return;
                }
                jsonText = await jsonFile.async('string');
            } else {
                jsonText = await file.text();
            }

            const data = JSON.parse(jsonText);
            const success = await window.dataManager.importData(data);

            if (success) {
                this.closeModal();
                this.showToast('Data imported successfully', 'success');
                window.categoryManager.renderCategories();
                window.uiManager.loadTheme();
                window.uiManager.showScreen('welcome-screen');
            } else {
                this.showToast('Error importing data', 'error');
            }
        } catch (error) {
            this.showToast('Invalid file format: ' + error.message, 'error');
        }
    }

    showTemplateModal(title, templateContent, actions = []) {
        document.getElementById('modal-title').textContent = title;

        // Clear and populate modal body
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = '';
        modalBody.appendChild(templateContent);

        // Add event listeners for action buttons
        actions.forEach(action => {
            const button = modalBody.querySelector(`[data-action="${action.action}"]`);
            if (button && action.handler) {
                button.addEventListener('click', action.handler);
            }
        });

        this.modal.classList.add('active');
    }

    showDeckMenu(event, deckId) {
        // Remove existing menu
        const existingMenu = document.querySelector('.deck-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Create menu from template
        const template = document.getElementById('deck-menu-template');
        const menuContent = template.content.cloneNode(true);
        const menu = menuContent.querySelector('.deck-context-menu');

        // Hide preview option if deck has no cards
        const deck = window.dataManager.findDeck(this.currentCategory.id, deckId);
        if (!deck || deck.cards.length === 0) {
            const previewItem = menu.querySelector('[data-action="preview-deck"]');
            if (previewItem) {
                previewItem.style.display = 'none';
            }
        }

        // Position menu near the clicked button
        const btnRect = event.target.getBoundingClientRect();
        menu.style.left = (btnRect.right - 160) + 'px'; // 160px is menu width
        menu.style.top = (btnRect.bottom + 5) + 'px';

        // Add event listeners
        menu.addEventListener('click', (e) => {
            const action = e.target.closest('.menu-item')?.dataset.action;
            if (action === 'export-deck') {
                window.categoryManager.exportDeckById(deckId);
            } else if (action === 'delete-deck') {
                window.categoryManager.confirmDeleteDeck(deckId);
            } else if (action === 'preview-deck') {
                window.categoryManager.previewDeck(deckId);
            } else if (action === 'reset-deck-stats') {
                window.categoryManager.confirmResetDeckStats(deckId);
            } else if (action === 'add-card') {
                window.categoryManager.addCardToDeck(deckId);
            } else if (action === 'rename-deck') {
                window.categoryManager.showRenameDeckModal(deckId);
            } else if (action === 'show-id') {
                this.showDeckIdInfo(deckId);
            }
            menu.remove();
        });

        // Close menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener('click', () => {
                menu.remove();
            }, { once: true });
        }, 100);

        document.body.appendChild(menu);
    }


    async showPreviewScreen(category, deck) {
        this.currentCategory = category;
        this.currentDeck = deck;

        document.getElementById('preview-title').textContent = `Preview: ${deck.name}`;

        // Revoke any object URLs left over from a previous preview
        // session before starting a new one — covers re-previewing while
        // already on the preview screen (e.g. after editing/deleting a
        // card and returning here).
        this.revokePreviewImageUrls();

        // Initialize preview state
        this.previewState = {
            categoryId: category.id,
            deckId: deck.id,
            allCards: deck.cards,
            displayedCards: 0,
            batchSize: APP_CONFIG.CARDS_PER_PREVIEW_BATCH,
            objectUrls: []
        };

        // Clear previous content
        document.getElementById('preview-content').innerHTML = '';

        // Load first batch
        await this.loadPreviewBatch();

        this.showScreen('preview-screen');
    }

    // Revoke every object URL created for the current preview session's
    // card images (Issue 42).
    revokePreviewImageUrls() {
        if (this.previewState && this.previewState.objectUrls) {
            this.previewState.objectUrls.forEach(url => URL.revokeObjectURL(url));
            this.previewState.objectUrls = [];
        }
    }


    // Issue 52: lastStudied (not interval) is the reliable "unstudied"
    // signal — interval is already set to APP_CONFIG.DEFAULT_INTERVAL at
    // card creation time (addCard(), data-manager.js), so a default
    // interval value alone doesn't mean the card is new.
    formatCardSchedulingInfo(card) {
        if (!card.lastStudied) {
            return 'New';
        }

        const interval = typeof card.interval === 'number' ? card.interval : 0;
        const intervalLabel = `${interval} day${interval === 1 ? '' : 's'}`;
        const nextReviewLabel = card.nextReview ? formatDate(card.nextReview) : '—';

        return `Interval: ${intervalLabel} • Next review: ${nextReviewLabel}`;
    }

    async loadPreviewBatch() {
        const state = this.previewState;
        const container = document.getElementById('preview-content');
        const moreButton = document.getElementById('preview-more');
        const loadMoreBtn = document.getElementById('load-more-btn');

        // Calculate cards for this batch
        const startIndex = state.displayedCards;
        const endIndex = Math.min(startIndex + state.batchSize, state.allCards.length);
        const batchCards = state.allCards.slice(startIndex, endIndex);

        // Render batch cards
        for (const card of batchCards) {
            const cardEl = document.createElement('div');
            cardEl.className = 'preview-card';

            // Prepare content — escape at render time.
            // backContent is escaped inside parseSimpleMarkdown.
            const frontContent = escapeHtml(card.front || '');
            const backContent = parseSimpleMarkdown(card.back || '');
            const imageHtml = card.image ?
                  `<div class="preview-card-image">${await this.getImageHtml(card.image)}</div>` : '';
            const schedulingText = this.formatCardSchedulingInfo(card);

            cardEl.innerHTML = `
        <button class="preview-card-delete" onclick="window.uiManager.deleteCardFromPreview('${card.id}')" title="Delete card">🗑️</button>
        <div class="preview-card-front">
            <div class="preview-card-label">Front</div>
            <div class="preview-card-scheduling" style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">${schedulingText}</div>
            ${imageHtml}
            <div class="preview-card-content">${frontContent}</div>
        </div>
        <div class="preview-card-back">
           <div class="preview-card-label">Back</div>
           <div class="preview-card-content">${backContent}</div>
        </div>
        `;

            // Add click handler for editing (but not delete button)
            cardEl.addEventListener('click', (e) => {
                if (!e.target.closest('.preview-card-delete')) {
                    this.editCardFromPreview(card.id);
                }
            });

            container.appendChild(cardEl);
        }

        // Update state
        state.displayedCards = endIndex;

        // Update count display
        document.getElementById('preview-count').textContent =
            `Showing ${state.displayedCards} of ${state.allCards.length} cards`;

        // Show/hide load more button
        if (state.displayedCards < state.allCards.length) {
            moreButton.style.display = 'block';

            // Remove existing event listener and add new one
            const newBtn = loadMoreBtn.cloneNode(true);
            loadMoreBtn.parentNode.replaceChild(newBtn, loadMoreBtn);
            newBtn.addEventListener('click', () => this.loadPreviewBatch());
        } else {
            moreButton.style.display = 'none';
        }
    }


    // Uses an object URL (not a data URL — Issue 42) and tracks it on
    // previewState so it can be revoked when the preview session ends.
    async getImageHtml(imagePath) {
        if (!imagePath) return '';

        const objectUrl = await window.cardManager.getImageObjectUrl(imagePath);
        if (objectUrl) {
            if (this.previewState && this.previewState.objectUrls) {
                this.previewState.objectUrls.push(objectUrl);
            }
            return `<img src="${objectUrl}" alt="Card image">`;
        }
        return '<p style="color: var(--text-secondary); font-style: italic;">Image not found</p>';
    }


    editCardFromPreview(cardId) {
        const state = this.previewState;
        if (!state) return;

        // Store current preview state
        this.previewEditState = {
            returnToPreview: true,
            categoryId: state.categoryId,
            deckId: state.deckId,
            cardId: cardId
        };

        // Use existing card edit functionality
        window.cardManager.editCard(state.categoryId, state.deckId, cardId);
    }


    deleteCardFromPreview(cardId) {
        const state = this.previewState;
        if (!state) return;

        const card = state.allCards.find(c => c.id === cardId);
        if (!card) return;

        const frontPreview = escapeHtml(card.front.length > 100 ?
              card.front.substring(0, 100) + '...' : card.front);

        const template = document.getElementById('confirm-delete-template');
        const content = template.content.cloneNode(true);

        // Populate the delete message
        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete this card?</p>
        <div style="background: var(--card-bg); padding: 1rem; border-radius: 6px; margin: 1rem 0;">
            <strong>Front:</strong> ${frontPreview}
        </div>
        <p><strong>This action cannot be undone.</strong></p>
    `;

        const actions = [
            {
                action: 'cancel',
                handler: () => this.closeModal()
            },
            {
                action: 'delete',
                handler: () => this.handleDeleteCardFromPreview(cardId)
            }
        ];

        this.showTemplateModal('Confirm Delete', content, actions);
    }


    handleDeleteCardFromPreview(cardId) {
        const state = this.previewState;
        if (!state) return;

        const deleted = window.dataManager.deleteCard(state.categoryId, state.deckId, cardId);

        if (deleted) {
            this.closeModal();
            this.showToast('Card deleted successfully', 'success');

            // Refresh the preview screen
            const category = window.dataManager.findCategory(state.categoryId);
            const deck = window.dataManager.findDeck(state.categoryId, state.deckId);

            if (category && deck) {
                this.showPreviewScreen(category, deck);
            }

            // Update sidebar stats
            window.categoryManager.renderCategories();
        } else {
            this.showToast('Error deleting card', 'error');
        }
    }


    async showStatistics() {
        const template = document.getElementById('statistics-template');
        const content = template.content.cloneNode(true);

        // Get statistics data
        const stats = window.dataManager.getStatistics();

        // Populate the values
        content.getElementById('mastery-value').textContent = stats.mastery + '%';
        content.getElementById('days-studied-value').textContent = stats.daysStudied;
        content.getElementById('time-studied-value').textContent = formatTimeStudied(stats.timeStudied);
        content.getElementById('unique-cards-value').textContent = stats.uniqueCardsStudied;
        content.getElementById('total-cards-value').textContent = stats.totalCardInstances;

        const actions = [
            {
                text: 'Close',
                class: 'btn-primary',
                action: 'close',
                handler: () => this.closeModal()
            }
        ];

        this.showTemplateModal('Statistics', content, actions);

        // Fetch storage stats asynchronously and update after modal is shown
        const storage = await window.dataManager.getStorageStats();
        const imageMB = (storage.imageBytes / (1024 * 1024)).toFixed(2);
        const totalMB = (storage.totalBytes / (1024 * 1024)).toFixed(2);

        const imageCountEl = document.getElementById('image-count-value');
        const imageDescEl = document.getElementById('image-storage-desc');
        if (imageCountEl) imageCountEl.textContent = storage.imageCount;
        if (imageDescEl) imageDescEl.innerHTML = `${imageMB} MB image storage<br>${totalMB} MB total storage`;
    }

    updateSidebarStats() {
        // Check if streak should be reset to 0 due to gap
        window.dataManager.checkStreakValidity();

        const stats = window.dataManager.getStatistics();
        document.getElementById('current-streak').textContent = stats.currentStreak;
        document.getElementById('record-streak').textContent = stats.recordStreak;
    }

    showDeckIdInfo(deckId) {
        const deck = window.dataManager.findDeck(this.currentCategory.id, deckId);
        if (!deck) return;

        const categoryId = this.currentCategory.id;
        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const studyUrl = `${baseUrl}#/study/${categoryId}/${deckId}`;
        const previewUrl = `${baseUrl}#/preview/${categoryId}/${deckId}`;

        const content = `
        <div class="deck-id-info">
            <p><strong>Deck:</strong> ${escapeHtml(deck.name)}</p>
            <p><strong>Category ID:</strong> ${categoryId}</p>
            <p><strong>Deck ID:</strong> ${deckId}</p>
        </div>

        <div class="deck-id-urls">
            <p><strong>Direct Study URL:</strong></p>
            <input type="text" value="${studyUrl}" readonly>
        </div>

        <div class="deck-id-urls">
            <p><strong>Direct Preview URL:</strong></p>
            <input type="text" value="${previewUrl}" readonly>
        </div>

        <p class="deck-id-note">
            Copy these URLs to bookmark or share specific decks.
        </p>
    `;

        const actions = [
            {
                text: 'Close',
                class: 'btn-primary',
                action: 'close',
                handler: () => this.closeModal()
            }
        ];

        this.showModal('Deck Information', content, actions);

        // Select text in inputs when clicked
        setTimeout(() => {
            document.querySelectorAll('input[readonly]').forEach(input => {
                input.addEventListener('click', () => input.select());
            });
        }, 100);
    }

    renderHomeOverview() {
        const container = document.getElementById('all-decks-container');
        if (!container) return;

        container.innerHTML = '';

        const categories = window.dataManager.getCategories();
        const baseUrl = `${window.location.origin}${window.location.pathname}`;

        if (categories.length === 0) {
            container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <p>No decks yet. Create your first category and deck to get started!</p>
            </div>
        `;
            return;
        }

        categories.forEach(category => {
            if (category.decks.length === 0) return; // Skip categories with no decks

            const categorySection = document.createElement('div');
            categorySection.className = 'overview-section';

            const categoryTitle = document.createElement('h3');
            categoryTitle.textContent = category.name;
            categorySection.appendChild(categoryTitle);

            const deckList = document.createElement('div');
            deckList.className = 'category-deck-list';

            category.decks.forEach(deck => {
                const sessionSize = window.dataManager.getSettings().cardsPerSession || APP_CONFIG.CARDS_PER_STUDY_SESSION;
                const stats = calculateAdvancedStudyStats(deck.cards, sessionSize);
                const studyUrl = `${baseUrl}#/study/${category.id}/${deck.id}`;
                const previewUrl = `${baseUrl}#/preview/${category.id}/${deck.id}`;

                const deckLine = document.createElement('div');
                deckLine.className = 'deck-line';

                deckLine.innerHTML = `
                <div class="deck-info">
                    <div class="deck-name">${escapeHtml(deck.name)}</div>
                    <div class="deck-stats">${deck.cards.length} cards${stats.needsPractice > 0 ? ` • ${stats.needsPractice} needs practice` : ''}</div>
                </div>
                <div class="deck-actions">
                    <a href="${studyUrl}" class="deck-action-link primary">Study</a>
                    <a href="${previewUrl}" class="deck-action-link">Preview</a>
                </div>
            `;

                deckList.appendChild(deckLine);
            });

            categorySection.appendChild(deckList);
            container.appendChild(categorySection);
        });
    }

    showSettings() {
        const template = document.getElementById('settings-template');
        const content = template.content.cloneNode(true);

        // Populate current settings
        const settings = window.dataManager.getSettings();
        content.getElementById('cards-per-session').value = settings.cardsPerSession || 10;

        const actions = [
            {
                action: 'cancel',
                handler: () => this.closeModal()
            },
            {
                action: 'save',
                handler: () => this.handleSaveSettings()
            }
        ];

        this.showTemplateModal('Settings', content, actions);
    }

    handleSaveSettings() {
        const cardsPerSession = parseInt(document.getElementById('cards-per-session').value);

        // Validate input
        if (isNaN(cardsPerSession) || cardsPerSession < 1 || cardsPerSession > 50) {
            this.showToast('Cards per session must be between 1 and 50', 'error');
            return;
        }

        // Update settings
        window.dataManager.updateSettings({
            cardsPerSession: cardsPerSession
        });

        this.closeModal();
        this.showToast('Settings saved successfully', 'success');

        // Issue 54: cardsPerSession affects calculateAdvancedStudyStats'
        // needsPractice cap — refresh whatever's currently showing
        // deck-derived counts, same pattern as handleResetAllProgress().
        window.categoryManager.renderCategories();

        const context = this.getCurrentContext();
        if (context.screen === 'category-screen' && context.category) {
            const updatedCategory = window.dataManager.findCategory(context.category.id);
            this.showScreen('category-screen', { category: updatedCategory });
        } else if (context.screen === 'welcome-screen') {
            this.renderHomeOverview();
        }
    }

    showCategoryMenu(event, categoryId) {
        // Remove existing menu
        const existingMenu = document.querySelector('.category-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Create menu from template
        const template = document.getElementById('category-menu-template');
        const menuContent = template.content.cloneNode(true);
        const menu = menuContent.querySelector('.category-context-menu');

        // Position menu near the clicked button
        const btnRect = event.target.getBoundingClientRect();
        menu.style.left = (btnRect.right - 160) + 'px'; // 160px is menu width
        menu.style.top = (btnRect.bottom + 5) + 'px';

        // Add event listeners
        menu.addEventListener('click', (e) => {
            const action = e.target.closest('.menu-item')?.dataset.action;
            if (action === 'edit-category') {
                window.categoryManager.editCategory(categoryId);
            } else if (action === 'delete-category') {
                window.categoryManager.confirmDeleteCategory(categoryId);
            }
            menu.remove();
        });

        // Close menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener('click', () => {
                menu.remove();
            }, { once: true });
        }, 100);

        document.body.appendChild(menu);
    }

    closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('sidebar-open');
    }

    setupMobileNav() {
        const hamburgerBtn = document.getElementById('mobile-hamburger-btn');
        const mobileHeader = document.querySelector('.mobile-header');
        const mobileTitle = document.querySelector('.mobile-header-title');
        const sidebar = document.getElementById('sidebar');
        if (!hamburgerBtn || !sidebar) return;

        // Toggle sidebar on hamburger click
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('sidebar-open');
        });

        // Close sidebar when tapping anywhere in the mobile header
        if (mobileHeader) {
            mobileHeader.addEventListener('click', (e) => {
                if (e.target !== hamburgerBtn) {
                    this.closeMobileSidebar();
                }
            });
        }

        // Navigate home when tapping the title
        if (mobileTitle) {
            mobileTitle.addEventListener('click', () => {
                this.closeMobileSidebar();
                window.routerManager.navigate('/');
            });
        }
    }

showAbout() {
        const template = document.getElementById('about-template');
        const content = template.content.cloneNode(true);

        // Populate name and version dynamically
        const nameEl = content.querySelector('.about-app-name');
        const versionEl = content.querySelector('.about-app-version');
        if (nameEl) nameEl.textContent = APP_CONFIG.APP_NAME;
        if (versionEl) versionEl.textContent = `Version ${APP_CONFIG.APP_VERSION}`;

        const actions = [
            {
                action: 'close',
                handler: () => this.closeModal()
            }
        ];

        this.showTemplateModal('About', content, actions);
    }

    // Issue 51: built with showModal() rather than reusing
    // confirm-delete-template, so the destructive button can read
    // "Reset All Progress" instead of the template's hardcoded "Delete".
    confirmResetAllProgress() {
        const totalCards = window.dataManager.getCategories()
            .reduce((sum, cat) => sum + cat.decks.reduce((s, d) => s + d.cards.length, 0), 0);

        const content = `
            <p>This will reset <strong>ALL cards</strong> in every category and deck to unstudied.</p>
            <p>Card content, categories, and decks will not be affected.</p>
            <p><strong>This cannot be undone</strong> — consider creating a backup first.</p>
            <p>${totalCards} card(s) will be affected.</p>
        `;

        const actions = [
            {
                text: 'Cancel',
                class: 'btn-secondary',
                action: 'reset-all-progress-cancel',
                handler: () => this.closeModal()
            },
            {
                text: 'Reset All Progress',
                class: 'btn-danger',
                action: 'reset-all-progress-confirm',
                handler: () => this.handleResetAllProgress()
            }
        ];

        this.showModal('Reset All Progress?', content, actions);
    }

    handleResetAllProgress() {
        const count = window.dataManager.resetAllCardsStudyData();

        this.closeModal();
        this.showToast(`Reset ${count} card${count === 1 ? '' : 's'} to unstudied`, 'success');

        // Not scoped to one category (unlike resetDeckStats' refresh
        // pattern) — refresh the sidebar always, and whichever main view
        // is currently showing card-derived stats.
        window.categoryManager.renderCategories();

        const context = this.getCurrentContext();
        if (context.screen === 'category-screen' && context.category) {
            const updatedCategory = window.dataManager.findCategory(context.category.id);
            this.showScreen('category-screen', { category: updatedCategory });
        } else if (context.screen === 'welcome-screen') {
            this.renderHomeOverview();
        }
    }

}

// Create global instance
window.uiManager = new UIManager();

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
