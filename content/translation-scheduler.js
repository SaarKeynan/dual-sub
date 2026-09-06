(() => {
  const { cueIndexAt } = DualSubCaptions;
  function translationPrefetchOrder(cues, timeMs, leadMs = 60000, backfillMs = 8000) {
    if (!cues.length) return [];
    let focusIndex = Math.max(0, cueIndexAt(cues, timeMs));
    if (timeMs >= cues[focusIndex].end && cues[focusIndex + 1]) focusIndex += 1;
    const firstIndex = Math.max(0, cueIndexAt(cues, Math.max(0, timeMs - backfillMs)));
    let lastIndex = focusIndex;
    while (lastIndex + 1 < cues.length && cues[lastIndex + 1].start <= timeMs + leadMs) {
      lastIndex += 1;
    }

    const order = [focusIndex];
    for (let index = firstIndex; index < focusIndex; index += 1) order.push(index);
    for (let index = focusIndex + 1; index <= lastIndex; index += 1) order.push(index);
    return order;
  }


  globalThis.DualSubScheduler = Object.freeze({ translationPrefetchOrder });
})();
