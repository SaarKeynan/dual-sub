(() => {
  function create() {
    const template = document.createElement("template");
    template.innerHTML = `
        <div class="dualsub-stack">
          <div class="dualsub-status" role="status" aria-live="polite">
            <span class="dualsub-status-text"></span>
            <button class="dualsub-status-close" type="button" aria-label="Dismiss message" title="Dismiss"></button>
          </div>
          <div class="dualsub-line dualsub-source"><span class="dualsub-line-text"></span></div>
          <div class="dualsub-line dualsub-target"><span class="dualsub-line-text"></span></div>
        </div>
        <div class="dualsub-selection-card" role="dialog" aria-label="Subtitle lookup">
          <div class="dualsub-card-heading">
            <div class="dualsub-card-label">French lookup</div>
            <div class="dualsub-card-heading-actions">
              <button class="dualsub-card-pin" type="button" data-action="pin" aria-label="Keep lookup open" title="Keep open">Pin</button>
              <button class="dualsub-card-close" type="button" data-action="close" aria-label="Close lookup">&times;</button>
            </div>
          </div>
          <div class="dualsub-card-source"></div>
          <div class="dualsub-card-lexical" hidden>
            <div class="dualsub-card-lexical-info"></div>
          </div>
          <div class="dualsub-card-translation" data-group="unknown">
            <div class="dualsub-card-group" hidden></div>
            <div class="dualsub-card-result" aria-live="polite"></div>
            <div class="dualsub-card-infinitive" hidden></div>
          </div>
          <div class="dualsub-card-provenance" hidden><span></span><a target="_blank" rel="noopener noreferrer">Open engine lookup &nearr;</a></div>
          <form class="dualsub-correction-form" hidden>
            <label>Preferred English meaning<input class="dualsub-correction-input" type="text" maxlength="300" autocomplete="off"></label>
            <div><button type="submit" data-action="save-correction">Save correction</button><button type="button" data-action="cancel-correction">Cancel</button></div>
          </form>
          <div class="dualsub-card-context">
            <div class="dualsub-card-label">In this line</div>
            <div class="dualsub-card-sentence-source"></div>
            <div class="dualsub-card-sentence-target"></div>
          </div>
          <div class="dualsub-card-actions">
            <div class="dualsub-action-group dualsub-action-navigation">
              <button type="button" data-action="previous" title="Previous French word" aria-label="Previous French word">←</button>
              <button type="button" data-action="next" title="Next French word" aria-label="Next French word">→</button>
            </div>
            <div class="dualsub-action-group dualsub-action-primary">
              <button type="button" data-action="speak">Pronounce</button>
              <button type="button" data-action="save">+ Vocabulary</button>
              <button type="button" data-action="phrase">Select phrase</button>
            </div>
            <div class="dualsub-action-group dualsub-action-secondary">
              <button type="button" data-action="copy">Copy</button>
              <button type="button" data-action="correct">Correct meaning</button>
              <button type="button" data-action="replay">Replay</button>
              <button type="button" data-action="slow">Slow replay</button>
              <button type="button" data-action="loop">Loop line</button>
            </div>
          </div>
          <div class="dualsub-card-links">
            <a class="dualsub-card-link" target="_blank" rel="noopener noreferrer">Google Translate &nearr;</a>
            <a class="dualsub-card-wiktionary" target="_blank" rel="noopener noreferrer">Wiktionary &nearr;</a>
          </div>
        </div>`;
    return template.content.cloneNode(true);
  }
  globalThis.DualSubLookupView = Object.freeze({ create });
})();
