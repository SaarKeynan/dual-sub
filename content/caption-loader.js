(() => {
  function create({ requestCaptionFromPage, sendMessage }) {
    const captionPayloadCache = new Map();
  async function requestCaptionPayload(url) {
    if (captionPayloadCache.has(url)) return captionPayloadCache.get(url);

    const requireCaptionText = (text, origin) => {
      if (String(text || "").trim()) return text;
      throw new Error(`YouTube returned an empty ${origin} response.`);
    };
    const backgroundRequest = sendMessage({ type: "fetch-captions", url }).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "Could not fetch captions.");
      return requireCaptionText(response.text, "extension-context");
    });
    const request = Promise.any([
      requestCaptionFromPage(url).then((text) => requireCaptionText(text, "page-context")),
      backgroundRequest
    ]).catch((error) => {
      captionPayloadCache.delete(url);
      const messages = Array.from(error?.errors || []).map((item) => item?.message).filter(Boolean);
      throw new Error(messages.join(" ") || error.message || "Could not fetch captions.");
    });
    captionPayloadCache.set(url, request);
    if (captionPayloadCache.size > 32) {
      captionPayloadCache.delete(captionPayloadCache.keys().next().value);
    }
    return request;
  }


    return { requestCaptionPayload };
  }
  globalThis.DualSubCaptionLoader = Object.freeze({ create });
})();
