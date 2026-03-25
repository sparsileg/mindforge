// Category management

class CategoryManager {
    constructor() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Add category button
        document.getElementById('add-category-btn').addEventListener('click', () => {
            this.showAddCategoryModal();
        });

        // Add deck button
        document.getElementById('add-deck-btn').addEventListener('click', () => {
            this.showAddDeckModal();
        });

        // Import deck button
        document.getElementById('import-deck-btn').addEventListener('click', () => {
            this.showImportDeckModal();
        });
    }

    // Initialize and render categories
    init() {
        this.renderCategories();
    }

    renderCategories() {
        const categories = window.dataManager.getCategories();
        window.uiManager.renderCategories(categories);
    }

    // Category operations
    showAddCategoryModal() {
        const template = document.getElementById('add-category-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'create',
                handler: () => this.handleAddCategory()
            }
        ];

        window.uiManager.showTemplateModal('Add New Category', content, actions);

        setTimeout(() => {
            document.getElementById('category-name').focus();
        }, 100);
    }

    handleAddCategory() {
        const nameInput = document.getElementById('category-name');
        const name = nameInput.value.trim();

        if (!name) {
            window.uiManager.showToast('Please enter a category name', 'error');
            return;
        }

        // Check for duplicate names
        const existingCategories = window.dataManager.getCategories();
        if (existingCategories.some(cat => cat.name.toLowerCase() === name.toLowerCase())) {
            window.uiManager.showToast('A category with this name already exists', 'error');
            return;
        }

        const category = window.dataManager.addCategory(name);
        if (category) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Category created successfully', 'success');
            this.renderCategories();

            // Auto-select the new category
            this.selectCategory(category.id);
        } else {
            window.uiManager.showToast('Error creating category', 'error');
        }
    }

    selectCategory(categoryId) {
        const category = window.dataManager.findCategory(categoryId);
        if (category) {
            window.uiManager.updateActiveSidebarItem(categoryId);
            window.uiManager.showScreen('category-screen', { category });
            window.uiManager.closeMobileSidebar();
        }
    }

    editCategory(categoryId) {
        const category = window.dataManager.findCategory(categoryId);
        if (!category) return;

        const template = document.getElementById('edit-category-template');
        const content = template.content.cloneNode(true);

        // Populate the form with existing data
        content.getElementById('category-name').value = category.name;

        const actions = [
            {
                action: 'delete',
                handler: () => this.confirmDeleteCategory(categoryId)
            },
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'save',
                handler: () => this.handleEditCategory(categoryId)
            }
        ];

        window.uiManager.showTemplateModal('Edit Category', content, actions);
    }

    handleEditCategory(categoryId) {
        const nameInput = document.getElementById('category-name');
        const name = nameInput.value.trim();

        if (!name) {
            window.uiManager.showToast('Please enter a category name', 'error');
            return;
        }

        const updated = window.dataManager.updateCategory(categoryId, { name });
        if (updated) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Category updated successfully', 'success');
            this.renderCategories();
            this.selectCategory(categoryId);
        } else {
            window.uiManager.showToast('Error updating category', 'error');
        }
    }

    confirmDeleteCategory(categoryId) {
        const category = window.dataManager.findCategory(categoryId);
        if (!category) return;

        const deckCount = category.decks.length;
        const cardCount = category.decks.reduce((sum, deck) => sum + deck.cards.length, 0);

        const template = document.getElementById('confirm-delete-template');
        const content = template.content.cloneNode(true);

        // Populate the delete message
        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the category "<strong>${category.name}</strong>"?</p>
        <p>This will permanently delete:</p>
        <ul>
            <li>${deckCount} deck(s)</li>
            <li>${cardCount} card(s)</li>
        </ul>
        <p><strong>This action cannot be undone.</strong></p>
    `;

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'delete',
                handler: () => this.handleDeleteCategory(categoryId)
            }
        ];

        window.uiManager.showTemplateModal('Confirm Delete', content, actions);
    }

    handleDeleteCategory(categoryId) {
        const deleted = window.dataManager.deleteCategory(categoryId);
        if (deleted) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Category deleted successfully', 'success');
            this.renderCategories();
            window.uiManager.showScreen('welcome');
        } else {
            window.uiManager.showToast('Error deleting category', 'error');
        }
    }

    // Deck operations
    showAddDeckModal() {
        const currentCategory = window.uiManager.getCurrentContext().category;
        if (!currentCategory) {
            window.uiManager.showToast('Please select a category first', 'error');
            return;
        }

        const template = document.getElementById('add-deck-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'create',
                handler: () => this.handleAddDeck()
            }
        ];

        window.uiManager.showTemplateModal('Add New Deck', content, actions);

        setTimeout(() => {
            document.getElementById('deck-name').focus();
        }, 100);
    }

    handleAddDeck() {
        const currentCategory = window.uiManager.getCurrentContext().category;
        const nameInput = document.getElementById('deck-name');
        const name = nameInput.value.trim();

        if (!name) {
            window.uiManager.showToast('Please enter a deck name', 'error');
            return;
        }

        // Check for duplicate names within the category
        if (currentCategory.decks.some(deck => deck.name.toLowerCase() === name.toLowerCase())) {
            window.uiManager.showToast('A deck with this name already exists in this category', 'error');
            return;
        }

        const deck = window.dataManager.addDeck(currentCategory.id, name);
        if (deck) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Deck created successfully', 'success');

            // Refresh the category view and sidebar
            const updatedCategory = window.dataManager.findCategory(currentCategory.id);
            window.uiManager.showScreen('category-screen', { category: updatedCategory });
            this.renderCategories();
        } else {
            window.uiManager.showToast('Error creating deck', 'error');
        }
    }

    showRenameDeckModal(deckId) {
        const currentCategory = window.uiManager.getCurrentContext().category;
        if (!currentCategory) {
            window.uiManager.showToast('No category selected', 'error');
            return;
        }
        const categoryId = currentCategory.id;
        const deck = window.dataManager.findDeck(categoryId, deckId);
        if (!deck) {
            window.uiManager.showToast('Deck not found', 'error');
            return;
        }

        const content = document.createElement('div');
        content.innerHTML = `
            <div class="form-group">
                <label for="rename-deck-input">Deck Name</label>
                <input type="text" id="rename-deck-input" class="form-control"
                    value="${deck.name}" maxlength="100">
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn-primary" data-action="save">Save Changes</button>
            </div>`;

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'save',
                handler: () => this.handleRenameDeck(categoryId, deckId)
            }
        ];

        window.uiManager.showTemplateModal('Rename Deck', content, actions);

        setTimeout(() => {
            const input = document.getElementById('rename-deck-input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 50);
    }

    handleRenameDeck(categoryId, deckId) {
        const input = document.getElementById('rename-deck-input');
        const name = input ? input.value.trim() : '';

        if (!name) {
            window.uiManager.showToast('Please enter a deck name', 'error');
            return;
        }

        const category = window.dataManager.findCategory(categoryId);
        if (!category) {
            window.uiManager.showToast('Category not found', 'error');
            return;
        }

        const existingDecks = category.decks.filter(d => d.id !== deckId);
        if (existingDecks.some(d => d.name.toLowerCase() === name.toLowerCase())) {
            window.uiManager.showToast('A deck with this name already exists in this category', 'error');
            return;
        }

        const updated = window.dataManager.updateDeck(categoryId, deckId, {
            name: escapeHtml(name)
        });

        if (updated) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Deck renamed successfully', 'success');
            const refreshedCategory = window.dataManager.findCategory(categoryId);
            window.uiManager.renderDecks(refreshedCategory.decks);
        } else {
            window.uiManager.showToast('Error renaming deck', 'error');
        }
    }

    exportDeck() {
        const context = window.uiManager.getCurrentContext();
        if (!context.deck || !context.category) {
            window.uiManager.showToast('No deck selected to export', 'error');
            return;
        }

        try {
            const deck = context.deck;
            const cards = deck.cards;

            if (cards.length === 0) {
                window.uiManager.showToast('Cannot export empty deck', 'warning');
                return;
            }

            // Create CSV content
            let csvContent = '"Front","Back"\n';

            cards.forEach(card => {
                const front = escapeCSVField(card.front);
                const back = escapeCSVField(card.back);
                csvContent += `${front},${back}\n`;
            });

            // Create and download file
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `${deck.name}-export.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
            window.uiManager.showToast(`Deck "${deck.name}" exported successfully`, 'success');

        } catch (error) {
            window.uiManager.showToast('Error exporting deck: ' + error.message, 'error');
        }
    }

    showImportDeckModal() {
        const currentCategory = window.uiManager.getCurrentContext().category;
        if (!currentCategory) {
            window.uiManager.showToast('Please select a category first', 'error');
            return;
        }

        const template = document.getElementById('import-deck-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'import',
                handler: () => this.handleImportDeck()
            }
        ];

        window.uiManager.showTemplateModal('Import Deck', content, actions);

        setTimeout(() => {
            document.getElementById('new-deck-name').focus();
        }, 100);
    }

    async handleImportDeck() {
        const fileInput = document.getElementById('deck-csv-file');
        const nameInput = document.getElementById('new-deck-name');

        const file = fileInput.files[0];
        const deckName = nameInput.value.trim();

        if (!file) {
            window.uiManager.showToast('Please select a CSV file', 'error');
            return;
        }

        if (!deckName) {
            window.uiManager.showToast('Please enter a deck name', 'error');
            return;
        }

        const currentCategory = window.uiManager.getCurrentContext().category;

        // Check for duplicate deck names
        if (currentCategory.decks.some(deck => deck.name.toLowerCase() === deckName.toLowerCase())) {
            window.uiManager.showToast('A deck with this name already exists in this category', 'error');
            return;
        }

        try {
            const csvText = await file.text();

            // Validate CSV format
            validateCSVFormat(csvText);

            // Parse CSV and create cards
            const lines = csvText.trim().split('\n');
            const cards = [];

            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '') continue; // Skip empty lines

                const fields = parseCSVLine(lines[i]);
                const front = unescapeCSVField(fields[0]).trim();
                const back = unescapeCSVField(fields[1]).trim();

                if (front && back) {
                    cards.push({
                        front,
                        back,
                        image: null
                    });
                }
            }

            if (cards.length === 0) {
                window.uiManager.showToast('No valid cards found in CSV file', 'warning');
                return;
            }

            // Create the deck
            const deck = window.dataManager.addDeck(currentCategory.id, deckName);
            if (!deck) {
                window.uiManager.showToast('Error creating deck', 'error');
                return;
            }

            // Add all cards to the deck
            cards.forEach(cardData => {
                window.dataManager.addCard(currentCategory.id, deck.id, cardData);
            });

            window.uiManager.closeModal();
            window.uiManager.showToast(`Deck "${deckName}" imported with ${cards.length} cards`, 'success');

            // Refresh the category view
            const updatedCategory = window.dataManager.findCategory(currentCategory.id);
            window.uiManager.showScreen('category-screen', { category: updatedCategory });
		    this.renderCategories();

        } catch (error) {
            window.uiManager.showToast('Import failed: ' + error.message, 'error');
        }
    }

    addCardToDeck(deckId) {
        const context = window.uiManager.getCurrentContext();
        const deck = window.dataManager.findDeck(context.category.id, deckId);

        if (!deck) {
            window.uiManager.showToast('Deck not found', 'error');
            return;
        }

        // Set the context for card manager and show modal
        window.uiManager.currentDeck = deck;
        window.cardManager.showAddCardModal();
    }

    exportDeckById(deckId) {
        const context = window.uiManager.getCurrentContext();
        const deck = window.dataManager.findDeck(context.category.id, deckId);

        if (!deck) {
            window.uiManager.showToast('Deck not found', 'error');
            return;
        }

        try {
            const cards = deck.cards;

            if (cards.length === 0) {
                window.uiManager.showToast('Cannot export empty deck', 'warning');
                return;
            }

            // Create CSV content
            let csvContent = '"Front","Back"\n';

            cards.forEach(card => {
                const front = escapeCSVField(card.front);
                const back = escapeCSVField(card.back);
                csvContent += `${front},${back}\n`;
            });

            // Create and download file
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `${deck.name}-export.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
            window.uiManager.showToast(`Deck "${deck.name}" exported successfully`, 'success');

        } catch (error) {
            window.uiManager.showToast('Error exporting deck: ' + error.message, 'error');
        }
    }

    confirmDeleteDeck(deckId) {
        const context = window.uiManager.getCurrentContext();
        const deck = window.dataManager.findDeck(context.category.id, deckId);

        if (!deck) return;

        const cardCount = deck.cards.length;

        const template = document.getElementById('confirm-delete-template');
        const content = template.content.cloneNode(true);

        // Populate the delete message
        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the deck "<strong>${deck.name}</strong>"?</p>
        <p>This will permanently delete <strong>${cardCount} card(s)</strong>.</p>
        <p><strong>This action cannot be undone.</strong></p>
    `;

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'delete',
                handler: () => this.handleDeleteDeck(context.category.id, deckId)
            }
        ];

        window.uiManager.showTemplateModal('Confirm Delete', content, actions);
    }

    handleDeleteDeck(categoryId, deckId) {
        const deleted = window.dataManager.deleteDeck(categoryId, deckId);

        if (deleted) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Deck deleted successfully', 'success');

            // Refresh the category view
            const updatedCategory = window.dataManager.findCategory(categoryId);
            window.uiManager.showScreen('category-screen', { category: updatedCategory });
		    this.renderCategories();
        } else {
            window.uiManager.showToast('Error deleting deck', 'error');
        }
    }

    previewDeck(deckId) {
        const context = window.uiManager.getCurrentContext();
        const deck = window.dataManager.findDeck(context.category.id, deckId);

        if (!deck) {
            window.uiManager.showToast('Deck not found', 'error');
            return;
        }

        if (deck.cards.length === 0) {
            window.uiManager.showToast('No cards to preview', 'warning');
            return;
        }

        window.uiManager.showPreviewScreen(context.category, deck);
    }

    confirmResetDeckStats(deckId) {
        const context = window.uiManager.getCurrentContext();
        const deck = window.dataManager.findDeck(context.category.id, deckId);

        if (!deck) return;

        const studiedCards = deck.cards.filter(card => card.lastStudied).length;

        const template = document.getElementById('confirm-delete-template');
        const content = template.content.cloneNode(true);

        // Populate the reset message
        content.getElementById('delete-message').innerHTML = `
        <p>Reset deck statistics as if new?</p>
        <p>This will reset all study progress for <strong>"${deck.name}"</strong>.</p>
        <p>${studiedCards} card(s) will return to "new" status.</p>
        <p><strong>This action cannot be undone.</strong></p>
    `;

        const actions = [
            {
                action: 'cancel',
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'delete',
                handler: () => this.handleResetDeckStats(context.category.id, deckId)
            }
        ];

        window.uiManager.showTemplateModal('Confirm Reset', content, actions);
    }

    handleResetDeckStats(categoryId, deckId) {
        const success = window.dataManager.resetDeckStats(categoryId, deckId);

        if (success) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Deck statistics reset successfully', 'success');

            // Refresh the category view to show updated stats
            const updatedCategory = window.dataManager.findCategory(categoryId);
            window.uiManager.showScreen('category-screen', { category: updatedCategory });
            this.renderCategories();
        } else {
            window.uiManager.showToast('Error resetting deck statistics', 'error');
        }
    }

}


// Create global instance
window.categoryManager = new CategoryManager();
