// Study session management

class StudyManager {
    constructor() {
        this.currentSession = null;
        this.currentCardIndex = 0;
        this.sessionCards = [];
        this.studyMode = 'front-to-back';
        this.isAnswerVisible = false;
        this.cardStartTime = null;
        this.sessionStartTime = null;
        this.isSessionDistracted = false;
        this.cardWarningTimes = null;

        // New properties for adaptive cloze
        this.currentStudyMethod = 'Show Full Answer';
        this.sentenceIndex = 0;
        this.sentences = [];
        this.clozeData = null;
        this.showingClozeAnswer = false;

        // Function words to avoid hiding at lower difficulties
        this.functionWords = new Set([
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it',
            'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this',
            'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or',
            'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
            'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
            'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
            'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
            'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come',
            'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
            'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
            'any', 'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been',
            'has', 'had', 'were', 'said', 'each', 'did', 'does', 'am'
        ]);

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Study mode selector
        document.getElementById('study-mode-select').addEventListener('change', (e) => {
            this.studyMode = e.target.value;
            this.displayCurrentCard();
        });

        // Flip card button
        document.getElementById('flip-card-btn').addEventListener('click', () => {
            this.flipCard();
        });

        // End study button
        document.getElementById('end-study-btn').addEventListener('click', () => {
            this.endStudySession();
        });

        // Rating buttons
        document.querySelectorAll('.rating-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rating = parseInt(e.target.dataset.rating);
                this.rateCard(rating);
            });
        });
    }

    // Start a new study session
    startStudySession(categoryId, deckId) {
        const category = window.dataManager.findCategory(categoryId);
        const deck = window.dataManager.findDeck(categoryId, deckId);

        if (!category || !deck) {
            window.uiManager.showToast('Deck not found', 'error');
            return;
        }

        if (deck.cards.length === 0) {
            window.uiManager.showToast('This deck has no cards to study', 'warning');
            return;
        }

        // Perform daily maintenance (backup, cleanup, etc.)
        window.dataManager.performDailyMaintenance();

        // Get cards per session from settings
        const settings = window.dataManager.getSettings();
        const cardsPerSession = settings.cardsPerSession || APP_CONFIG.CARDS_PER_STUDY_SESSION;

        // Get optimized study session
        this.sessionCards = window.dataManager.getCardsForStudySession(categoryId, deckId, cardsPerSession);

        if (this.sessionCards.length === 0) {
            window.uiManager.showToast('No cards available for study', 'info');
            return;
        }

        this.currentCardIndex = 0;
        this.isAnswerVisible = false;

        this.currentSession = {
            categoryId,
            deckId,
            categoryName: category.name,
            deckName: deck.name,
            startTime: new Date(),
            cardsStudied: 0,
            totalAccuracyPoints: 0,
            cardIds: []
        };

        this.sessionStartTime = Date.now();
        this.isSessionDistracted = false;

        // Set default study mode
        const defaultMode = settings.defaultStudyMode || 'front-to-back';
        this.studyMode = defaultMode;
        document.getElementById('study-mode-select').value = this.studyMode;

        // Show study screen
        window.uiManager.showScreen('study-screen');
        this.displayCurrentCard();
    }

    // Display the current card
    displayCurrentCard() {
        if (!this.currentSession || this.currentCardIndex >= this.sessionCards.length) {
            this.completeStudySession();
            return;
        }

        const card = this.sessionCards[this.currentCardIndex];
        const progress = `Card ${this.currentCardIndex + 1} of ${this.sessionCards.length}`;

        document.getElementById('study-progress').textContent = progress;

        // Reset ALL states completely
        this.isAnswerVisible = false;
        this.sentenceMode = false;
        this.currentSentenceIndex = 0;
        this.sentences = [];
        this.showingClozeAnswer = false;
        this.clozeData = null;

        // Remove cloze styling
        const cardContent = document.getElementById('study-card-content');
        cardContent.classList.remove('cloze-mode');

        // Hide rating section
        document.getElementById('study-rating').style.display = 'none';

        // Get the card's preferred study mode, default to Show Full Answer
        this.currentStudyMethod = card.studyMode || 'Show Full Answer';

        // Always start by displaying the initial side based on study mode (front-to-back vs back-to-front)
        const imageContainer = document.getElementById('study-card-image');
        const textContainer = document.getElementById('study-card-text');

        if (this.studyMode === 'front-to-back') {
            // Show front (question) with image
            window.cardManager.renderCardImage(card.image, imageContainer);
            textContainer.textContent = card.front;
        } else {
            // Show back (answer) - no image for back-to-front mode
            imageContainer.innerHTML = '';
            textContainer.innerHTML = parseSimpleMarkdown(card.back);
        }

        // Setup and show study mode buttons
        this.setupStudyModeButtons();

        // Hide the flip button initially
        document.getElementById('flip-card-btn').style.display = 'none';

        // Start timing for this card
        this.cardStartTime = Date.now();

        // Clear any existing warning timer
        if (this.cardWarningTimer) {
            clearTimeout(this.cardWarningTimer);
        }

        // Set warning timer for 9 minutes
        this.cardWarningTimer = setTimeout(() => {
            window.uiManager.showToast('Finish this card in 1 minute or session won\'t count toward stats', 'warning');
        }, 9 * 60 * 1000); // 9 minutes in milliseconds
    }

    // Flip the card to show the answer
    flipCard() {
        if (this.isAnswerVisible) return;

        const card = this.sessionCards[this.currentCardIndex];
        const textContainer = document.getElementById('study-card-text');

        this.isAnswerVisible = true;

        // Handle based on current study method
        if (this.currentStudyMethod === 'Hidden Words') {
            // For Hidden Words mode, smoothly reveal the words in place
            const clozeTextDiv = textContainer.querySelector('.cloze-text');
            if (clozeTextDiv && this.clozeData) {
                // Add transition class for smooth reveal
                clozeTextDiv.style.transition = 'opacity 0.8s ease-in-out';
                clozeTextDiv.style.opacity = '0.3';

                setTimeout(() => {
                    clozeTextDiv.innerHTML = this.clozeData.originalText;
                    clozeTextDiv.style.opacity = '1';
                }, 100);

                // Update the info text
                const clozeInfo = textContainer.querySelector('.cloze-info');
                if (clozeInfo) {
                    clozeInfo.textContent = `Hidden Words Mode (Level ${(card.hiddenWordsDifficulty || 0) + 1}) • All words revealed`;
                }
            }
            this.showingClozeAnswer = true;
        } else {
            // Normal flip behavior for other modes
            const imageContainer = document.getElementById('study-card-image');

            if (this.studyMode === 'front-to-back') {
                // Show back (answer) - no image for answer side
                imageContainer.innerHTML = '';
                textContainer.innerHTML = parseSimpleMarkdown(card.back);
            } else {
                // Show front (question) with image
                window.cardManager.renderCardImage(card.image, imageContainer);
                textContainer.textContent = card.front;
            }
        }

        // Show rating buttons and hide flip button
        document.getElementById('flip-card-btn').style.display = 'none';
        document.getElementById('study-rating').style.display = 'block';
    }

    // Rate the current card and move to next
    rateCard(rating) {
        if (!this.isAnswerVisible) return;

        const card = this.sessionCards[this.currentCardIndex];

        // Clear the warning timer
        if (this.cardWarningTimer) {
            clearTimeout(this.cardWarningTimer);
            this.cardWarningTimer = null;
        }

        // Update card study data
        window.dataManager.updateCardStudyData(
            this.currentSession.categoryId,
            this.currentSession.deckId,
            card.id,
            rating
        );

        // Adjust hidden words difficulty if in Hidden Words mode
        if (this.currentStudyMethod === 'Hidden Words') {
            this.adjustHiddenWordsDifficulty(card, rating);
        }

        // Check for distraction (card took too long)
        const cardTime = Date.now() - this.cardStartTime;
        const cardTimeMinutes = cardTime / (1000 * 60);
        if (cardTimeMinutes > APP_CONFIG.MAX_CARD_TIME_MINUTES) {
            this.isSessionDistracted = true;
        }

        // Update session stats with graduated accuracy
        this.currentSession.cardsStudied++;
        this.currentSession.cardIds.push(card.id);
        const accuracyPoints = {
            1: 0,    // 0% accuracy
            2: 0.33, // 33% accuracy
            3: 0.67, // 67% accuracy
            4: 1.0   // 100% accuracy
        };
        this.currentSession.totalAccuracyPoints = (this.currentSession.totalAccuracyPoints || 0) + (accuracyPoints[rating] || 0);

        // Move to next card
        this.currentCardIndex++;

        // Small delay to show the rating before moving on
        setTimeout(() => {
            this.displayCurrentCard();
        }, 300);
    }

    // Complete the study session
    completeStudySession() {
        if (!this.currentSession) return;

        const endTime = new Date();
        const sessionTimeMinutes = (Date.now() - this.sessionStartTime) / (1000 * 60);
        const duration = Math.round(sessionTimeMinutes);
        const accuracy = this.currentSession.cardsStudied > 0 ?
              Math.round((this.currentSession.totalAccuracyPoints / this.currentSession.cardsStudied) * 100) : 0;

        // Update statistics
        const sessionData = {
            cardsStudied: this.currentSession.cardsStudied,
            timeSpent: duration,
            wasDistracted: this.isSessionDistracted,
            cardIds: this.currentSession.cardIds
        };
        window.dataManager.updateStudyStatistics(sessionData);
        window.uiManager.updateSidebarStats();

        const template = document.getElementById('study-summary-template');
        const content = template.content.cloneNode(true);

        // Populate the statistics
        content.getElementById('cards-studied').textContent = this.currentSession.cardsStudied;
        content.getElementById('accuracy').textContent = accuracy + '%';
        content.getElementById('duration').textContent = duration;

        const actions = [
            {
                action: 'study-again',
                handler: () => {
                    window.uiManager.closeModal();
                    this.startStudySession(this.currentSession.categoryId, this.currentSession.deckId);
                }
            },
            {
                action: 'back',
                handler: () => {
                    window.uiManager.closeModal();
                    this.returnToHome();
                }
            }
        ];

        window.uiManager.showTemplateModal('Session Complete', content, actions);
    }

    // End study session early
    endStudySession() {
        if (!this.currentSession) return;

        const cardsRemaining = this.sessionCards.length - this.currentCardIndex;

        if (cardsRemaining > 0) {
            const message = `
                <p>Are you sure you want to end this study session?</p>
                <p>You have ${cardsRemaining} cards remaining.</p>
            `;

            const actions = [
                {
                    text: 'Continue Studying',
                    class: 'btn-secondary',
                    action: 'continue',
                    handler: () => window.uiManager.closeModal()
                },
                {
                    text: 'End Session',
                    class: 'btn-primary',
                    action: 'end',
                    handler: () => {
                        window.uiManager.closeModal();
                        this.returnToHome();
                    }
                }
            ];

            window.uiManager.showModal('End Study Session', message, actions);
        } else {
            this.returnToDeck();
        }
    }

    // Return to the deck view
    returnToDeck() {
        if (this.currentSession) {
            const category = window.dataManager.findCategory(this.currentSession.categoryId);
            const deck = window.dataManager.findDeck(this.currentSession.categoryId, this.currentSession.deckId);

            if (category && deck) {
                window.uiManager.showScreen('category-screen', { category });
            } else {
                window.uiManager.showScreen('welcome-screen');
            }
        } else {
            window.uiManager.showScreen('welcome-screen');
        }

        // Reset all session state
        this.currentSession = null;
        this.sessionCards = [];
        this.currentCardIndex = 0;
        this.isAnswerVisible = false;
        this.currentStudyMethod = 'Show Full Answer';
        this.sentenceMode = false;
        this.showingClozeAnswer = false;
        this.clozeData = null;

        // Hide study mode buttons
        this.hideStudyModeButtons();

        // Remove cloze styling
        const cardContent = document.getElementById('study-card-content');
        if (cardContent) {
            cardContent.classList.remove('cloze-mode');
        }
    }


    // Get current session info
    getCurrentSession() {
        return this.currentSession;
    }

    // Check if currently in a study session
    isStudying() {
        return this.currentSession !== null;
    }


    showFullAnswer() {
        this.isAnswerVisible = true;

        const card = this.sessionCards[this.currentCardIndex];
        const imageContainer = document.getElementById('study-card-image');
        const textContainer = document.getElementById('study-card-text');

        if (this.studyMode === 'front-to-back') {
            // Show back (answer) - no image for answer side
            imageContainer.innerHTML = '';
            textContainer.innerHTML = parseSimpleMarkdown(card.back);
        } else {
            // Show front (question) with image
            window.cardManager.renderCardImage(card.image, imageContainer);
            textContainer.textContent = card.front;
        }

        // Show rating buttons
        document.getElementById('study-rating').style.display = 'block';

        // Hide flip button
        document.getElementById('flip-card-btn').style.display = 'none';
    }

    startSentenceReveal() {
        this.sentenceMode = true;
        this.currentSentenceIndex = 0;

        const card = this.sessionCards[this.currentCardIndex];
        let answerText;

        if (this.studyMode === 'front-to-back') {
            answerText = card.back;
        } else {
            answerText = card.front;
        }

        // Parse sentences
        this.sentences = this.parseSentences(answerText);

        // Clear image for sentence mode
        const imageContainer = document.getElementById('study-card-image');
        imageContainer.innerHTML = '';

        // Set up sentence reveal interface
        const textContainer = document.getElementById('study-card-text');
        textContainer.innerHTML = `
        <div class="sentence-reveal-container">
            <div id="revealed-sentences" class="sentence-reveal-text"></div>
            <div class="sentence-controls">
                <button id="next-sentence-btn" class="btn-primary">Next Sentence</button>
                <button id="show-remaining-btn" class="btn-secondary">Show All Remaining</button>
            </div>
        </div>
    `;

        // Add event listeners
        document.getElementById('next-sentence-btn').addEventListener('click', () => {
            this.revealNextSentence();
        });

        document.getElementById('show-remaining-btn').addEventListener('click', () => {
            this.showAllRemainingSentences();
        });

        // Hide flip button
        document.getElementById('flip-card-btn').style.display = 'none';

        // Automatically reveal the first sentence
        this.revealNextSentence();
    }

    parseSentences(text) {
        if (!text) return [];

        // Split on periods, exclamation marks, question marks, semicolons, colons, and em dashes
        return text
            .split(/(?<=[.!?;:—])\s+/)
            .map(sentence => sentence.trim())
            .filter(sentence => sentence.length > 0);
    }

    revealNextSentence() {
        if (this.currentSentenceIndex < this.sentences.length) {
            const revealedContainer = document.getElementById('revealed-sentences');
            const currentText = revealedContainer.innerHTML;
            const nextSentence = this.sentences[this.currentSentenceIndex];

            revealedContainer.innerHTML = currentText +
                (currentText ? ' ' : '') +
                parseSimpleMarkdown(nextSentence);

            this.currentSentenceIndex++;

            // Check if all sentences revealed
            if (this.currentSentenceIndex >= this.sentences.length) {
                this.finishSentenceReveal();
            }
        }
    }

    showAllRemainingSentences() {
        const revealedContainer = document.getElementById('revealed-sentences');
        const remainingSentences = this.sentences.slice(this.currentSentenceIndex);
        const currentText = revealedContainer.innerHTML;

        const allRemaining = remainingSentences.join(' ');
        revealedContainer.innerHTML = currentText +
            (currentText ? ' ' : '') +
            parseSimpleMarkdown(allRemaining);

        this.currentSentenceIndex = this.sentences.length;
        this.finishSentenceReveal();
    }

    finishSentenceReveal() {
        this.isAnswerVisible = true;

        // Hide sentence controls
        const sentenceControls = document.querySelector('.sentence-controls');
        if (sentenceControls) {
            sentenceControls.style.display = 'none';
        }

        // Show rating buttons
        document.getElementById('study-rating').style.display = 'block';
    }

    returnToHome() {
        // Clear session state
        this.currentSession = null;
        this.sessionCards = [];
        this.currentCardIndex = 0;
        this.isAnswerVisible = false;
        this.currentStudyMethod = 'Show Full Answer';
        this.sentenceMode = false;
        this.showingClozeAnswer = false;
        this.clozeData = null;

        // Hide study mode buttons
        this.hideStudyModeButtons();

        // Remove cloze styling
        const cardContent = document.getElementById('study-card-content');
        if (cardContent) {
            cardContent.classList.remove('cloze-mode');
        }

        // Navigate to home page
        window.routerManager.navigate('/');
    }

    getDifficultySettings(level) {
        const settings = [
            { percentage: 15, minWords: 2, maxWords: 15 }, // level 0 - increased from 2 to 15
            { percentage: 30, minWords: 4, maxWords: 25 }, // level 1 - increased from 4 to 25
            { percentage: 45, minWords: 6, maxWords: 35 }, // level 2 - increased from 6 to 35
            { percentage: 60, minWords: 8, maxWords: 45 }, // level 3 - increased from 8 to 45
            { percentage: 75, minWords: 10, maxWords: 60 } // level 4 - increased from 10 to 60
        ];
        return settings[Math.min(level, 4)];
    }

    createClozeText(text, difficulty) {
        const words = text.split(/(\s+)/); // Split on whitespace but keep the whitespace
        const settings = this.getDifficultySettings(difficulty);

        // Add randomness to percentage (±5%)
        const randomFactor = (Math.random() - 0.5) * 0.1;
        const targetPercentage = Math.max(0.1, Math.min(0.75, settings.percentage / 100 + randomFactor));

        // Only count actual words, not whitespace
        const actualWords = words.filter((word, index) => index % 2 === 0 && word.trim().length > 0);
        const targetHidden = Math.max(
            settings.minWords,
            Math.min(settings.maxWords, Math.ceil(actualWords.length * targetPercentage))
        );

        // Categorize only actual words for hiding priority
        const wordData = [];
        words.forEach((word, index) => {
            if (index % 2 === 0 && word.trim().length > 0) { // Only actual words
                const cleanWord = word.toLowerCase().replace(/[^\w]/g, '');
                const isFunction = this.functionWords.has(cleanWord);
                const isLong = cleanWord.length >= 4;

                wordData.push({
                    index,
                    word,
                    cleanWord,
                    isFunction,
                    isLong,
                    priority: isFunction ? (isLong ? 2 : 1) : (isLong ? 4 : 3)
                });
            }
        });

        // Sort by priority and add randomness
        const shuffledWords = [...wordData].sort((a, b) => {
            const priorityDiff = b.priority - a.priority;
            if (priorityDiff !== 0) return priorityDiff;
            return Math.random() - 0.5;
        });

        // Select words to hide
        const toHide = new Set();
        let wordsHidden = 0;

        // First pass: prioritize high-priority words
        for (let i = 0; i < shuffledWords.length && wordsHidden < targetHidden; i++) {
            const wordIndex = shuffledWords[i].index;
            if (shuffledWords[i].priority >= 3) {
                toHide.add(wordIndex);
                wordsHidden++;
            }
        }

        // Second pass: fill remaining slots
        for (let i = 0; i < shuffledWords.length && wordsHidden < targetHidden; i++) {
            const wordIndex = shuffledWords[i].index;
            if (!toHide.has(wordIndex)) {
                toHide.add(wordIndex);
                wordsHidden++;
            }
        }

        // Create cloze text preserving whitespace
        const clozeText = words.map((word, index) => {
            if (index % 2 === 1) {
                // This is whitespace, preserve it
                return word;
            } else if (toHide.has(index)) {
                // This is a word to hide
                return '<span class="cloze-blank"></span>';
            } else {
                // This is a word to show
                return word;
            }
        }).join('');

        const originalText = words.join('');

        return {
            clozeText,
            originalText,
            hiddenCount: toHide.size,
            totalWords: actualWords.length
        };
    }

    setupStudyModeButtons() {
        // Show the study mode buttons
        const modeButtons = document.querySelector('.study-mode-buttons');
        if (modeButtons) {
            modeButtons.style.display = 'block';
        }

        // Remove existing listeners to prevent duplicates
        const showFullBtn = document.getElementById('show-full-answer-btn');
        const sentenceBtn = document.getElementById('reveal-by-sentence-btn');
        const hiddenBtn = document.getElementById('hidden-words-btn');

        if (showFullBtn) {
            showFullBtn.replaceWith(showFullBtn.cloneNode(true));
            document.getElementById('show-full-answer-btn').addEventListener('click', () => {
                this.selectStudyMethod('Show Full Answer');
            });
        }

        if (sentenceBtn) {
            sentenceBtn.replaceWith(sentenceBtn.cloneNode(true));
            document.getElementById('reveal-by-sentence-btn').addEventListener('click', () => {
                this.selectStudyMethod('Reveal by Sentence');
            });
        }

        if (hiddenBtn) {
            hiddenBtn.replaceWith(hiddenBtn.cloneNode(true));
            document.getElementById('hidden-words-btn').addEventListener('click', () => {
                this.selectStudyMethod('Hidden Words');
            });
        }
    }

    selectStudyMethod(method) {
        this.currentStudyMethod = method;

        // Update button states
        document.querySelectorAll('.study-mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (method === 'Show Full Answer') {
            document.getElementById('show-full-answer-btn').classList.add('active');
        } else if (method === 'Reveal by Sentence') {
            document.getElementById('reveal-by-sentence-btn').classList.add('active');
        } else if (method === 'Hidden Words') {
            document.getElementById('hidden-words-btn').classList.add('active');
        }

        // Execute the selected study method
        this.executeStudyMethod();
    }

    executeStudyMethod() {
        // Hide the method selection buttons
        this.hideStudyModeButtons();

        switch (this.currentStudyMethod) {
        case 'Show Full Answer':
            this.showFullAnswer();
            break;
        case 'Reveal by Sentence':
            this.startSentenceReveal();
            break;
        case 'Hidden Words':
            this.startHiddenWordsMode();
            break;
        }
    }

    hideStudyModeButtons() {
        const modeButtons = document.querySelector('.study-mode-buttons');
        if (modeButtons) {
            modeButtons.style.display = 'none';
        }
    }

    startHiddenWordsMode() {
        const card = this.sessionCards[this.currentCardIndex];
        const difficulty = card.hiddenWordsDifficulty || 0;

        // Hide words in the answer text (what would normally be revealed on flip)
        let textToHide;
        if (this.studyMode === 'front-to-back') {
            textToHide = card.back;  // Hide words in back (answer) text
        } else {  // back-to-front
            textToHide = card.front; // Hide words in front (answer) text
        }

        // Create cloze text
        this.clozeData = this.createClozeText(textToHide, difficulty);

        // Update display
        const cardContent = document.getElementById('study-card-content');
        const imageContainer = document.getElementById('study-card-image');
        const textContainer = document.getElementById('study-card-text');

        // Add cloze mode styling
        cardContent.classList.add('cloze-mode');

        // For cloze mode, don't show images to focus on text
        imageContainer.innerHTML = '';

        // Show cloze info and text
        textContainer.innerHTML = `
        <div class="cloze-info">
            Hidden Words Mode (Level ${difficulty + 1}) • ${this.clozeData.hiddenCount} of ${this.clozeData.totalWords} words hidden
        </div>
        <div class="cloze-text">${this.clozeData.clozeText}</div>
    `;

        this.showingClozeAnswer = false;

        // Show reveal button
        document.getElementById('flip-card-btn').textContent = 'Show Hidden Words';
        document.getElementById('flip-card-btn').style.display = 'block';
    }

    adjustHiddenWordsDifficulty(card, rating) {
        let difficultyChange = 0;

        switch (rating) {
        case 1: // Nope! - decrease difficulty
            difficultyChange = -1;
            break;
        case 2: // Getting there - stay same
            difficultyChange = 0;
            break;
        case 3: // Almost - small increase
            difficultyChange = 0.5;
            break;
        case 4: // Perfect - larger increase
            difficultyChange = 1;
            break;
        }

        // Calculate new difficulty (0-4 scale)
        const currentDifficulty = card.hiddenWordsDifficulty || 0;
        const newDifficulty = Math.max(0, Math.min(4, currentDifficulty + difficultyChange));

        // Update recent ratings for tracking
        const recentRatings = card.recentRatings || [];
        recentRatings.push(rating);
        if (recentRatings.length > 5) {
            recentRatings.shift(); // Keep only last 5 ratings
        }

        // Update the card
        window.dataManager.updateCard(
            this.currentSession.categoryId,
            this.currentSession.deckId,
            card.id,
            {
                hiddenWordsDifficulty: newDifficulty,
                recentRatings: recentRatings
            }
        );
    }

}

// Create global instance
window.studyManager = new StudyManager();
