// Card management - Updated to use IndexedDB

class CardManager {
    constructor() {
        this.currentImageFile = null;
        this.currentImagePath = null;
    }

    // Show modal for adding new card
    showAddCardModal() {
        const context = window.uiManager.getCurrentContext();
        if (!context.deck || !context.category) {
            window.uiManager.showToast('Please select a deck first', 'error');
            return;
        }

        const template = document.getElementById('add-card-template');
        const content = template.content.cloneNode(true);

        const actions = [
            {
                action: 'cancel',
                handler: () => this.cancelCardOperation()
            },
            {
                action: 'add',
                handler: () => this.handleAddCard()
            }
        ];

        window.uiManager.showTemplateModal('Add New Card', content, actions);

        // Make modal wider for easier editing
        const modalContent = document.querySelector('.modal-content');
        modalContent.classList.add('wide');

        this.setupImagePreview();

        setTimeout(() => {
            document.getElementById('card-front').focus();
        }, 100);
    }

    // Show modal for editing existing card
    editCard(categoryId, deckId, cardId) {
        const card = window.dataManager.findCard(categoryId, deckId, cardId);
        if (!card) return;

        this.currentImagePath = card.image;

        const template = document.getElementById('edit-card-template');
        const content = template.content.cloneNode(true);

        // Populate form with existing data
        content.getElementById('card-front').value = card.front;
        content.getElementById('card-back').value = card.back;

        const actions = [
            {
                action: 'delete',
                handler: () => this.confirmDeleteCard(categoryId, deckId, cardId)
            },
            {
                action: 'cancel',
                handler: () => this.cancelCardOperation()
            },
            {
                action: 'save',
                handler: () => this.handleEditCard(categoryId, deckId, cardId)
            }
        ];

        window.uiManager.showTemplateModal('Edit Card', content, actions);

        // Make modal wider for easier editing
        const modalContent = document.querySelector('.modal-content');
        modalContent.classList.add('wide');

        this.setupImagePreview();

        // Show existing image if present
        if (card.image) {
            this.showImagePreviewAsync(card.image, false);
        }
    }

    // Setup image preview functionality
    setupImagePreview() {
        const imageInput = document.getElementById('card-image');
        const previewContainer = document.getElementById('image-preview');

        if (!imageInput || !previewContainer) return;

        imageInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                this.clearImagePreview();
                return;
            }

            try {
                validateImageFile(file);
                this.currentImageFile = file;

                const dataUrl = await fileToDataUrl(file);
                this.showImagePreview(dataUrl, true);

            } catch (error) {
                window.uiManager.showToast(error.message, 'error');
                imageInput.value = '';
                this.clearImagePreview();
            }
        });
    }

    showImagePreview(imageSrc, isNewFile = false) {
        const previewContainer = document.getElementById('image-preview');
        if (!previewContainer) return;

        previewContainer.innerHTML = `
        <div class="image-preview-wrapper">
            <img src="${imageSrc}" alt="Preview">
            <button type="button" class="remove-image-btn">Remove</button>
        </div>
    `;

        // Add remove functionality
        const removeBtn = previewContainer.querySelector('.remove-image-btn');
        removeBtn.addEventListener('click', () => {
            this.clearImagePreview();
            document.getElementById('card-image').value = '';
            this.currentImageFile = null;
            if (!isNewFile) {
                this.currentImagePath = null; // Mark for removal
            }
        });
    }

    // Async version for loading from IndexedDB
    async showImagePreviewAsync(imagePath, isNewFile = false) {
        const dataUrl = await this.getImageDataUrl(imagePath);
        if (dataUrl) {
            this.showImagePreview(dataUrl, isNewFile);
        }
    }

    clearImagePreview() {
        const previewContainer = document.getElementById('image-preview');
        if (previewContainer) {
            previewContainer.innerHTML = '';
        }
    }

    // Handle adding new card
    async handleAddCard() {
        const context = window.uiManager.getCurrentContext();
        const frontInput = document.getElementById('card-front');
        const backInput = document.getElementById('card-back');

        const front = frontInput.value.trim();
        const back = backInput.value.trim();

        if (!front || !back) {
            window.uiManager.showToast('Please fill in both front and back of the card', 'error');
            return;
        }

        let imagePath = null;

        // Handle image upload if present
        if (this.currentImageFile) {
            try {
                imagePath = await this.saveImage(this.currentImageFile);
            } catch (error) {
                window.uiManager.showToast('Error saving image: ' + error.message, 'error');
                return;
            }
        }

        // Store raw text — escaping happens at render time
        const cardData = {
            front: front,
            back: back,
            image: imagePath
        };

        const card = window.dataManager.addCard(context.category.id, context.deck.id, cardData);

        if (card) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Card added successfully', 'success');

            // Refresh category view to show updated card counts
            const context = window.uiManager.getCurrentContext();
            if (context.category) {
                const updatedCategory = window.dataManager.findCategory(context.category.id);
                window.uiManager.showScreen('category-screen', { category: updatedCategory });
                window.categoryManager.renderCategories();
            }

            this.resetCardOperation();
        } else {
            window.uiManager.showToast('Error adding card', 'error');
        }
    }

    // Handle editing existing card
    async handleEditCard(categoryId, deckId, cardId) {
        const frontInput = document.getElementById('card-front');
        const backInput = document.getElementById('card-back');

        const front = frontInput.value.trim();
        const back = backInput.value.trim();

        if (!front || !back) {
            window.uiManager.showToast('Please fill in both front and back of the card', 'error');
            return;
        }

        let imagePath = this.currentImagePath;

        // Handle new image upload
        if (this.currentImageFile) {
            try {
                imagePath = await this.saveImage(this.currentImageFile);
            } catch (error) {
                window.uiManager.showToast('Error saving image: ' + error.message, 'error');
                return;
            }
        }

        // Store raw text — escaping happens at render time
        const updates = {
            front: front,
            back: back,
            image: imagePath
        };

        const updated = window.dataManager.updateCard(categoryId, deckId, cardId, updates);

        if (updated) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Card updated successfully', 'success');

            // Check if we should return to preview mode
            if (window.uiManager.previewEditState && window.uiManager.previewEditState.returnToPreview) {
                this.returnToPreviewAfterEdit();
            } else {
                this.refreshDeckView();
            }

            this.resetCardOperation();
        } else {
            window.uiManager.showToast('Error updating card', 'error');
        }
    }

    // Confirm card deletion
    confirmDeleteCard(categoryId, deckId, cardId) {
        const card = window.dataManager.findCard(categoryId, deckId, cardId);
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
                handler: () => window.uiManager.closeModal()
            },
            {
                action: 'delete',
                handler: () => this.handleDeleteCard(categoryId, deckId, cardId)
            }
        ];

        window.uiManager.showTemplateModal('Confirm Delete', content, actions);
    }

    // Handle card deletion
    handleDeleteCard(categoryId, deckId, cardId) {
        const deleted = window.dataManager.deleteCard(categoryId, deckId, cardId);

        if (deleted) {
            window.uiManager.closeModal();
            window.uiManager.showToast('Card deleted successfully', 'success');

            // Check if we should return to preview mode
            if (window.uiManager.previewEditState && window.uiManager.previewEditState.returnToPreview) {
                const editState = window.uiManager.previewEditState;
                const category = window.dataManager.findCategory(editState.categoryId);
                const deck = window.dataManager.findDeck(editState.categoryId, editState.deckId);

                if (category && deck) {
                    window.uiManager.previewEditState = null;
                    window.uiManager.showPreviewScreen(category, deck);
                }
            } else {
                this.refreshDeckView();
            }
        } else {
            window.uiManager.showToast('Error deleting card', 'error');
        }
    }

    // Save image file to IndexedDB and return path
    async saveImage(file) {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substr(2, 9);
        const extension = file.name.split('.').pop().toLowerCase();
        const filename = `card_${timestamp}_${randomId}.${extension}`;
        const imagePath = `data/images/${filename}`;

        try {
            // Store the file as a Blob directly
            const imageData = {
                filename,
                blob: file, // Store the File/Blob directly
                originalName: file.name,
                size: file.size,
                type: file.type,
                savedAt: new Date().toISOString()
            };

            await window.indexedDBManager.saveData('images', imageData);

            return imagePath;
        } catch (error) {
            throw new Error('Failed to save image');
        }
    }

    async getImageDataUrl(imagePath) {
        if (!imagePath) return null;

        try {
            const filename = imagePath.split('/').pop();
            const imageData = await window.indexedDBManager.getData('images', filename);

            if (imageData && imageData.blob) {
                // Convert Blob to data URL only when needed for display
                return await blobToDataUrl(imageData.blob);
            }

            return null;
        } catch (error) {
            console.error('Error retrieving image:', error);
            return null;
        }
    }

    // Cancel card operation and reset state
    cancelCardOperation() {
        window.uiManager.closeModal();

        // Check if we should return to preview mode
        if (window.uiManager.previewEditState && window.uiManager.previewEditState.returnToPreview) {
            this.returnToPreviewAfterEdit();
        }

        this.resetCardOperation();
    }

    // Reset card operation state
    resetCardOperation() {
        this.currentImageFile = null;
        this.currentImagePath = null;
    }

    // Refresh the current deck view
    refreshDeckView() {
        const context = window.uiManager.getCurrentContext();
        if (context.category) {
            const updatedCategory = window.dataManager.findCategory(context.category.id);
            window.uiManager.showScreen('category-screen', { category: updatedCategory });
        }
    }

    // Utility method to display card image in study mode (now async)
    async renderCardImage(imagePath, container) {
        if (!imagePath || !container) {
            container.innerHTML = '';
            return;
        }

        const dataUrl = await this.getImageDataUrl(imagePath);
        if (dataUrl) {
            container.innerHTML = `<img src="${dataUrl}" alt="Card image" style="max-width: 100%; max-height: 60vh; width: auto; height: auto; border-radius: 8px; object-fit: contain;" onclick="window.cardManager.showImageModal('${dataUrl}')">`;
        } else {
            container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">Image not found</p>';
        }
    }

    returnToPreviewAfterEdit() {
        const editState = window.uiManager.previewEditState;
        if (!editState) return;

        // Get updated data
        const category = window.dataManager.findCategory(editState.categoryId);
        const deck = window.dataManager.findDeck(editState.categoryId, editState.deckId);

        if (category && deck) {
            // Clear the edit state
            window.uiManager.previewEditState = null;

            // Return to preview screen
            window.uiManager.showPreviewScreen(category, deck);

            // Scroll to the edited card if possible
            setTimeout(() => {
                const cardElements = document.querySelectorAll('.preview-card');
                const cardIndex = deck.cards.findIndex(card => card.id === editState.cardId);
                if (cardIndex >= 0 && cardIndex < cardElements.length) {
                    cardElements[cardIndex].scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }
            }, 100);
        }
    }

    showImageModal(dataUrl) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'image-modal-overlay';

        // Create image element
        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'image-modal-image';

        // Close on click anywhere
        overlay.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        // Close on escape key
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(overlay);
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);

        overlay.appendChild(img);
        document.body.appendChild(overlay);
    }

}

// Create global instance
window.cardManager = new CardManager();
