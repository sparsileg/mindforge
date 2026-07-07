Issue 1, Chunk 1 of 6 — js/utils.js: harden escapeHtml, add unescapeHtml, make parseSimpleMarkdown safe
Two reasons for this chunk: the current DOM-based escapeHtml does not escape quotes, which makes it unsafe for attribute contexts (we'll need that in showRenameDeckModal, where a deck name is interpolated into value="..."). And parseSimpleMarkdown output goes straight into innerHTML, so it must escape its input before applying bold markup. We also add unescapeHtml, which the repair routine (Chunk 6) will need.
Change 1 of 2 — replace escapeHtml, add unescapeHtml
Before:
javascript// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
After:
javascript// Escape HTML to prevent XSS.
// Safe for both element content and attribute values (escapes quotes).
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Reverse of escapeHtml. Used by the one-time data repair routine
// to unwind escaping that was previously applied at storage time.
// Note: '&amp;' is replaced last so a single pass exactly reverses
// a single pass of escapeHtml.
function unescapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}
Change 2 of 2 — parseSimpleMarkdown escapes before formatting
Before:
javascript// Simple markdown parser for basic formatting
function parseSimpleMarkdown(text) {
    if (!text) return text;

    // Handle **bold** text
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
After:
javascript// Simple markdown parser for basic formatting.
// Escapes raw HTML first, so the output is always safe to assign
// to innerHTML regardless of what the stored text contains.
function parseSimpleMarkdown(text) {
    if (!text) return text;

    // Escape HTML, then apply **bold** formatting
    return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
Validation tests
Run these in the browser console after reloading the app (hard reload so the SW serves the new file — or use your local dev server):

escapeHtml('a & b <i>"x" \'y\'</i>') → returns a &amp; b &lt;i&gt;&quot;x&quot; &#39;y&#39;&lt;/i&gt;
unescapeHtml(escapeHtml('a & b <i>"x"</i>')) → returns the original string exactly (round-trip).
parseSimpleMarkdown('**bold** & <b>raw</b>') → returns <strong>bold</strong> &amp; &lt;b&gt;raw&lt;/b&gt; — bold markup applied, raw HTML neutralized.
escapeHtml(null) → returns '' (no throw).
Regression smoke: study one card of an existing deck — app loads, flip works, no console errors. (A card back containing & may now display &amp; — expected until Chunk 6.)


Once tests 1–5 pass, say the word and I'll present Chunk 2 of 6 — js/ui-manager.js: applying escapeHtml at the render points (renderCategories, renderDecks, renderHomeOverview, loadPreviewBatch, deleteCardFromPreview, showDeckIdInfo).Mindforge code reviewDocument · MD proceed with chunk 4/6Refactored HTML escaping patterns across template and dialog componentsRefactored HTML escaping patterns across template and dialog componentsConfirmed — file identified, before/after snapshots for copy-paste, tests after each change. Continuing in that format.

Issue 1, Chunk 4 of 6 — js/category-manager.js: stop escaping deck renames; escape names in the rename input and confirmation dialogs
Five changes. One removes escaping from the storage path (deck rename); four add escaping where names are interpolated into innerHTML — including the rename input's value="..." attribute, which is exactly why Chunk 1 upgraded escapeHtml to escape quotes.
One thing that needs no change here: handleImportDeck() passes raw CSV text to dataManager.addCard(). That was previously the inconsistent, XSS-vulnerable path — but now that rendering escapes everywhere (Chunks 1–3), storing raw is the correct behavior, and CSV import is automatically consistent with UI-created cards.
Change 1 of 5 — showRenameDeckModal(): escape the input value
Before:
javascript        const content = document.createElement('div');
        content.innerHTML = `
            <div class="form-group">
                <label for="rename-deck-input">Deck Name</label>
                <input type="text" id="rename-deck-input" class="form-control"
                    value="${deck.name}" maxlength="100">
            </div>
After:
javascript        const content = document.createElement('div');
        content.innerHTML = `
            <div class="form-group">
                <label for="rename-deck-input">Deck Name</label>
                <input type="text" id="rename-deck-input" class="form-control"
                    value="${escapeHtml(deck.name)}" maxlength="100">
            </div>
Change 2 of 5 — handleRenameDeck(): store the name raw
Before:
javascript        const updated = window.dataManager.updateDeck(categoryId, deckId, {
            name: escapeHtml(name)
        });
After:
javascript        // Store raw text — escaping happens at render time
        const updated = window.dataManager.updateDeck(categoryId, deckId, {
            name: name
        });
Change 3 of 5 — confirmDeleteCategory(): escape the category name
Before:
javascript        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the category "<strong>${category.name}</strong>"?</p>
After:
javascript        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the category "<strong>${escapeHtml(category.name)}</strong>"?</p>
Change 4 of 5 — confirmDeleteDeck(): escape the deck name
Before:
javascript        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the deck "<strong>${deck.name}</strong>"?</p>
After:
javascript        content.getElementById('delete-message').innerHTML = `
        <p>Are you sure you want to delete the deck "<strong>${escapeHtml(deck.name)}</strong>"?</p>
Change 5 of 5 — confirmResetDeckStats(): escape the deck name
Before:
javascript        <p>This will reset all study progress for <strong>"${deck.name}"</strong>.</p>
After:
javascript        <p>This will reset all study progress for <strong>"${escapeHtml(deck.name)}"</strong>.</p>
Validation tests

Rename round-trip with special characters. Rename an existing deck to Q&A "Advanced" <v2>. Expected: the sidebar, category screen, and home overview all display that name literally. Reopen the rename dialog — the input shows the full name intact including the quotes (this specifically validates Change 1's attribute escaping; before Chunk 1's quote handling, the text after "Advanced would have been truncated). Verify raw storage in the console:

javascriptconst cat = window.uiManager.getCurrentContext().category;
console.log(cat.decks.map(d => d.name));
Expected: Q&A "Advanced" <v2> exactly — no &amp;, no &quot;.

Rename stability. Open the rename dialog on that deck and save without changes, three times. Re-run the console check — name still byte-identical (no escape layering).
Confirmation dialogs. On that same deck: open the ⋯ menu → Delete Deck — the dialog shows the name literally; Cancel. Then ⋯ → Reset Statistics — same; Cancel. Then rename a category to A & B (via its ⋯ menu → Edit) and choose Delete from the edit dialog — the confirmation shows A & B literally; Cancel.
CSV import consistency. Import a small CSV into a category:

"Front","Back"
"Salt & Pepper <test>","**bold** & done"
Preview the new deck: front shows the literal text, back shows bold in bold with & intact. This confirms imported and UI-created cards now behave identically. Delete the test deck afterward.

Rename the test deck back (or delete it) and confirm normal names still render everywhere.

Interim note: duplicate-name checks now compare raw input against stored names — for old categories/decks whose stored names still contain &amp; etc., duplicate detection on such names stays unreliable until the Chunk 6 repair. New names are checked correctly.

When these pass, Chunk 5 of 6 is js/data-manager.js: removing escapeHtml from addCategory() and addDeck() — the last two storage-side escape calls. (handleEditCategory in this file's counterpart already stores raw; after Chunk 5 that stops being an inconsistency and becomes the rule.) Chunk 6 then adds the one-time repair routine for existing data.const cat = window.uiManager.getCurrentContext().category;
console.log(cat.decks.map(d => d.name));
VM1062:2 ['Q&amp;A &quot;Advanced&quot; &lt;v2&gt;']Diagnosed stale browser code preventing proper name storageDiagnosed stale browser code preventing proper name storageThat stored value tells us Change 2 didn't take effect — the browser is still executing the old handleRenameDeck with escapeHtml(name) in it. Let's confirm what code is actually running, then find where the disconnect is.
Step 1 — Inspect the live function. In the console:
javascriptwindow.categoryManager.handleRenameDeck.toString()
Look at the updateDeck call near the bottom of the output. If it shows name: escapeHtml(name), the browser is running the old code — proceed to Step 2. (If it shows name: name, tell me — that would mean something stranger is going on, and we'd look elsewhere.)
Step 2 — Verify the file on disk. In your bash shell:
bashgrep -n "escapeHtml(name)" G:/mindforge/src/js/category-manager.js

If grep finds a match: the edit wasn't saved, or was made to a different copy of the file. Check for an unsaved Emacs buffer (C-x C-s) and confirm you're editing the file the dev server is serving from.
If grep finds nothing: the disk is correct and the service worker is serving a stale cached copy. This is the cache-first SW doing exactly what it's designed to do. Fix: DevTools → Application → Service Workers → check "Bypass for network", then reload. I'd leave that box checked for the rest of Phase 1 — it guarantees every reload picks up your edits during development, while production deploys continue to use the CACHE_VERSION bump convention.

Step 3 — Re-verify the fix. After resolving whichever it was, reload and run the live-function check from Step 1 again — it should now show name: name.
Step 4 — Repair the test deck and re-run the validation. The deck's stored name is now escaped junk from the old code path. Open the rename dialog on it — the input will display the escaped entities literally (that's the stored value, faithfully shown). Retype Q&A "Advanced" <v2> cleanly and save, then re-run:
javascriptconst cat = window.uiManager.getCurrentContext().category;
console.log(cat.decks.map(d => d.name));
Expected this time: ['Q&A "Advanced" <v2>'] — raw, no entities.
Then continue with tests 2–5 from Chunk 4. Once they pass, I'll present Chunk 5 of 6 (js/data-manager.js — the last two storage-side escape calls) in the standard format: file identified, before/after snapshots for copy-paste, tests after.
One process note for the remainder of this phase: because the SW is cache-first, any "change didn't work" symptom should be triaged with the .toString() trick first — it takes five seconds and immediately distinguishes a code problem from a stale-cache problem.proceed with chunk 5/6Strategized removal of escape function calls from manager methodsStrategized removal of escape function calls from manager methodsThat's exactly the format we'll keep using. Here's the next chunk.

Issue 1, Chunk 5 of 6 — js/data-manager.js: store category and deck names raw
Two changes, both removing the last storage-side escape calls in the codebase. After this chunk, every storage path stores raw text and every render path escapes — the inconsistency that caused Issue 1 is fully closed for new data. (Chunk 6 then repairs old data.)
Bonus effect: the duplicate-name checks in handleAddCategory and handleAddDeck compare raw input against stored names — with storage now raw, names like A&B are compared correctly.
Change 1 of 2 — addCategory()
Before:
javascript    addCategory(name) {
        const category = {
            id: generateId(),
            name: escapeHtml(name),
            createdAt: new Date().toISOString(),
            decks: []
        };
After:
javascript    addCategory(name) {
        // Store raw text — escaping happens at render time
        const category = {
            id: generateId(),
            name: name,
            createdAt: new Date().toISOString(),
            decks: []
        };
Change 2 of 2 — addDeck()
Before:
javascript        const deck = {
            id: generateId(),
            name: escapeHtml(name),
            createdAt: new Date().toISOString(),
            cards: []
        };
After:
javascript        // Store raw text — escaping happens at render time
        const deck = {
            id: generateId(),
            name: name,
            createdAt: new Date().toISOString(),
            cards: []
        };
Validation tests

Stale-cache triage first (lesson from Chunk 4): after saving and reloading, run

javascriptwindow.dataManager.addCategory.toString()
and confirm it shows name: name. If it still shows escapeHtml(name), the SW served a stale file — verify "Bypass for network" is still checked and reload.

Raw storage proof. Create a new category named R&D "Lab" <2026>. Verify storage in the console:

javascriptconst cats = window.dataManager.getCategories();
console.log(cats[cats.length - 1].name);
Expected: R&D "Lab" <2026> exactly — no entities.

Render proof. The sidebar shows that name literally (Chunk 2's escaping doing its job). Select the category — the title heading shows it correctly too (that path uses textContent, safe by construction).
Deck raw storage. Inside that category, create a deck named Q&A <draft>. Console check:

javascriptconst cat = window.dataManager.getCategories().slice(-1)[0];
console.log(cat.decks.map(d => d.name));
Expected: ['Q&A <draft>']. The deck card on screen and the home overview line both display it literally.

Duplicate detection now works with special characters. Attempt to create a second category named R&D "Lab" <2026> — expect the "already exists" toast. Same test with a second deck named Q&A <draft> in that category — expect the duplicate toast. (Before this chunk, raw-vs-escaped comparison let these duplicates through.)
CSV export filename sanity. Export the Q&A <draft> deck (add one card first). The download succeeds; note the browser will sanitize illegal filename characters like < on its own — the file content is what matters, and it should contain the card text correctly.
Cleanup. Delete the test category (this also exercises the Chunk 4 confirmation dialog showing the name literally, and — heads-up — you'll hit the blank-screen bug from Issue 2, which is scheduled right after this issue; navigate home via the title click for now).


When these pass, the final piece is Chunk 6 of 6 — the one-time data repair routine in js/data-manager.js: a settings-gated pass that walks all categories, decks, and cards, applying unescapeHtml in a loop until stable to unwind however many escape layers accumulated, then marks itself done. That's the chunk where your existing decks stop displaying &amp; — and where the backup you made at the start becomes the cross-check.proceed with 6/6Architected repair routine and validated integration strategyArchitected repair routine and validated integration strategyFormat confirmed — file identified, before/after snapshots to copy from, tests after. Here's the final chunk of Issue 1.

Issue 1, Chunk 6 of 6 — js/data-manager.js: one-time repair of legacy escaped text
Two changes: a new named method containing all the repair logic (keeping init() free of raw logic, per your convention), and a one-line call to it from init(). The repair is gated by a settings flag (escape-repair-v1) so it runs exactly once per browser profile, and it loops unescapeHtml until the text stops changing — unwinding however many escape layers each field accumulated.
One caveat before you run it: loop-until-stable cannot distinguish corruption from intent. If any card deliberately contains text like &amp; (e.g., a flashcard about HTML entities themselves), the repair will convert it to &. Test 4 below cross-checks against your pre-phase backup; if you know you have such cards, tell me before running this and we'll add an exclusion.
Change 1 of 2 — add the repair method
Insert this as a new method directly after the closing brace of saveData():
Before:
javascript            return true;
        } catch (error) {
            console.error('Error saving data to IndexedDB:', error);
            return false;
        }
    }


    // Get all data
    getData() {
        return this.data;
    }
After:
javascript            return true;
        } catch (error) {
            console.error('Error saving data to IndexedDB:', error);
            return false;
        }
    }

    // One-time repair: unwind HTML escaping that was previously applied
    // at storage time (Issue 1). Loops unescapeHtml until stable to undo
    // multiple accumulated layers. Gated by a settings flag so it runs
    // only once.
    async repairEscapedText() {
        const flag = await window.indexedDBManager.getData('settings', 'escape-repair-v1');
        if (flag && flag.value && flag.value.completed) {
            return; // Already repaired
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


    // Get all data
    getData() {
        return this.data;
    }
Change 2 of 2 — call it from init()
Before:
javascript            // Load data from IndexedDB
            await this.loadData();

            // Set up listener for data changes from other tabs
            this.setupCrossTabSync();
After:
javascript            // Load data from IndexedDB
            await this.loadData();

            // One-time repair of legacy storage-time escaping (Issue 1)
            await this.repairEscapedText();

            // Set up listener for data changes from other tabs
            this.setupCrossTabSync();
Validation tests

Stale-cache triage: after reload, typeof window.dataManager.repairEscapedText → "function".
The repair itself. On that first reload, the console shows Escape repair complete: N field(s) repaired (N > 0 if you have legacy cards with special characters), plus the toast. Cards and names that previously displayed &amp; now display & correctly in sidebar, home overview, study, and preview.
No entities remain in storage. Console sweep:

javascriptconst pattern = /&(amp|lt|gt|quot|#39);/;
const suspects = [];
window.dataManager.getCategories().forEach(c => {
    if (pattern.test(c.name)) suspects.push(['category', c.name]);
    c.decks.forEach(d => {
        if (pattern.test(d.name)) suspects.push(['deck', d.name]);
        d.cards.forEach(card => {
            if (pattern.test(card.front + ' ' + card.back))
                suspects.push(['card', card.front.substring(0, 40)]);
        });
    });
});
console.log(suspects.length ? suspects : 'No escaped entities remain');
Expected: No escaped entities remain. Any hits should be reviewed by hand — they'd be either multi-layer stragglers (shouldn't happen) or intentional entity content (see caveat).

Idempotence. Reload again: no repair toast, and

javascriptawait window.indexedDBManager.getData('settings', 'escape-repair-v1')
shows completed: true with a fieldsRepaired count matching test 1's log.

Cross-check against the backup. Open the pre-phase backup zip, find a card you know contained & or quotes, and compare its intended text against what the app now displays — they should match. This is the definitive proof the repair restored originals rather than mangling them.
Multi-layer unwind proof (synthetic, then restored):

javascriptconst card = window.dataManager.getCategories()[0].decks[0].cards[0];
const orig = card.front;
card.front = 'A &amp;amp;amp; B';   // triple-escaped '&'
await window.indexedDBManager.deleteData('settings', 'escape-repair-v1');
await window.dataManager.repairEscapedText();
console.log(card.front);            // expected: 'A & B'
card.front = orig;
await window.dataManager.saveData();

Issue 1 close-out regression (the acceptance tests from the issue): create a card with Salt & Pepper <test> / **bold** & "quotes", edit-save it three times, confirm storage is byte-identical; import the XSS CSV row from the issue and confirm no alert in preview; rename a category to A & B <script> and confirm literal display; create A&B twice and confirm the duplicate toast. Clean up test data.


Once test 6 passes, Issue 1 can be closed — and since you're already in category-manager.js territory mentally, Issue 2 is next per the Phase 1 plan: the one-line 'welcome' → 'welcome-screen' fix in handleDeleteCategory, which you likely bumped into during Chunk 5's cleanup step. Say the word and I'll present it in the standard format, followed by Issue 3 (the UTC → local date fixes in utils.js) to complete Phase 1.
