let captureImage = null;
let selection = null;
let dragStart = null;
let ocrWorkerPromise = null;

const element = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function setStatus(message, state = "") {
  element("translationStatus").textContent = message;
  element("translationStatus").dataset.state = state;
}

function activateMode(mode) {
  const selected = mode === "ocr" ? "ocr" : "type";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  element("ocrPanel").hidden = selected !== "ocr";
  if (selected === "type") element("sourceText").focus();
}

function updateSelectionBox() {
  if (!selection) return;
  const box = element("selectionBox");
  box.style.left = `${selection.left}px`;
  box.style.top = `${selection.top}px`;
  box.style.width = `${selection.width}px`;
  box.style.height = `${selection.height}px`;
}

function pointInStage(event) {
  const rect = element("captureStage").getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
    width: rect.width,
    height: rect.height
  };
}

function selectionFromPoints(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.max(4, Math.abs(end.x - start.x)),
    height: Math.max(4, Math.abs(end.y - start.y))
  };
}

function beginSelection(event) {
  if (!captureImage) return;
  event.preventDefault();
  element("captureStage").setPointerCapture(event.pointerId);
  dragStart = pointInStage(event);
  selection = { left: dragStart.x, top: dragStart.y, width: 4, height: 4 };
  updateSelectionBox();
}

function moveSelection(event) {
  if (!dragStart) return;
  selection = selectionFromPoints(dragStart, pointInStage(event));
  updateSelectionBox();
}

function endSelection(event) {
  if (!dragStart) return;
  moveSelection(event);
  dragStart = null;
}

function setOcrProgress(message) {
  const progress = Number(message?.progress || 0);
  const labels = {
    "loading tesseract core": "Loading OCR engine",
    "initializing tesseract": "Starting OCR engine",
    "loading language traineddata": "Loading French model",
    "initializing api": "Preparing French recognition",
    "recognizing text": "Reading selected text"
  };
  element("ocrProgress").hidden = false;
  element("ocrProgressBar").style.width = `${Math.round(progress * 100)}%`;
  element("ocrProgressText").textContent = `${labels[message?.status] || "Preparing OCR"} · ${Math.round(progress * 100)}%`;
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker("fra", 1, {
      workerPath: browser.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: browser.runtime.getURL("vendor/tesseract/tesseract-core-simd-lstm.wasm.js"),
      langPath: browser.runtime.getURL("vendor/tesseract/lang"),
      workerBlobURL: false,
      gzip: true,
      logger: setOcrProgress
    }).then(async (worker) => {
      await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
      return worker;
    }).catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

function selectedImageCanvas() {
  const image = element("captureImage");
  const displayed = image.getBoundingClientRect();
  const chosen = selection || { left: 0, top: 0, width: displayed.width, height: displayed.height };
  const ratioX = image.naturalWidth / displayed.width;
  const ratioY = image.naturalHeight / displayed.height;
  const source = {
    x: Math.round(chosen.left * ratioX),
    y: Math.round(chosen.top * ratioY),
    width: Math.max(1, Math.round(chosen.width * ratioX)),
    height: Math.max(1, Math.round(chosen.height * ratioY))
  };
  const scale = Math.max(1, Math.min(2, 2400 / source.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: element("enhanceContrast").checked });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  if (element("enhanceContrast").checked) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
      const adjusted = clamp((luminance - 128) * 1.65 + 128, 0, 255);
      pixels.data[index] = adjusted;
      pixels.data[index + 1] = adjusted;
      pixels.data[index + 2] = adjusted;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

async function runOcr() {
  const button = element("runOcr");
  button.disabled = true;
  button.textContent = "Reading…";
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(selectedImageCanvas());
    const text = String(result?.data?.text || "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("No text was recognized. Try a tighter selection or turn contrast enhancement off.");
    element("sourceText").value = text;
    element("ocrProgressBar").style.width = "100%";
    element("ocrProgressText").textContent = "Text recognized";
    setStatus("OCR complete. Check the French text, then translate.", "success");
    element("sourceText").scrollIntoView({ behavior: "smooth", block: "center" });
    element("sourceText").focus({ preventScroll: true });
  } catch (error) {
    element("ocrProgress").hidden = true;
    setStatus(error.message || "OCR could not read this selection.", "error");
  } finally {
    button.disabled = !captureImage;
    button.textContent = "Read selected area";
  }
}

function updateTranslationActions() {
  const ready = Boolean(element("sourceText").value.trim() && element("targetText").value.trim());
  element("copyTranslation").disabled = !element("targetText").value.trim();
  element("saveCorrection").disabled = !ready;
}

async function translateText() {
  const sourceText = element("sourceText").value.replace(/\s+/g, " ").trim();
  if (!sourceText) { setStatus("Enter or recognize some French text first.", "error"); return; }
  const button = element("translateText");
  button.disabled = true;
  button.textContent = "Translating…";
  setStatus("Using your selected translation engine…");
  try {
    const wordCount = (sourceText.match(/[\p{L}\p{N}]+/gu) || []).length;
    const response = await browser.runtime.sendMessage({
      type: "translate-selection",
      text: sourceText,
      sourceLanguage: "fr",
      targetLanguage: "en",
      cacheMode: wordCount <= 3 ? "word" : "phrase"
    });
    if (!response?.ok) throw new Error(response?.error || "Translation unavailable.");
    element("targetText").value = response.translatedText;
    setStatus(response.provenance === "Your correction" ? "Using your saved correction." : "Translated.", "success");
  } catch (error) {
    setStatus(error.message || "Translation unavailable.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Translate";
    updateTranslationActions();
  }
}

async function saveCorrection() {
  const sourceText = element("sourceText").value.replace(/\s+/g, " ").trim();
  const translatedText = element("targetText").value.replace(/\s+/g, " ").trim();
  if (!sourceText || !translatedText) return;
  const response = await browser.runtime.sendMessage({
    type: "save-translation-correction",
    sourceText,
    translatedText,
    sourceLanguage: "fr",
    targetLanguage: "en"
  });
  setStatus(response?.ok ? "Correction saved for this exact word or phrase." : (response?.error || "Could not save correction."), response?.ok ? "success" : "error");
}

async function loadCapture() {
  const stored = await browser.storage.local.get("ocrCaptureV1");
  const capture = stored.ocrCaptureV1;
  if (!capture?.dataUrl || Date.now() - Number(capture.capturedAt || 0) > 10 * 60_000) {
    if (capture) await browser.storage.local.remove("ocrCaptureV1");
    return;
  }
  const image = element("captureImage");
  try {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
      image.src = capture.dataUrl;
    });
  } finally {
    await browser.storage.local.remove("ocrCaptureV1");
  }
  captureImage = image;
  element("captureEmpty").hidden = true;
  element("captureStage").hidden = false;
  element("runOcr").disabled = false;
  requestAnimationFrame(() => {
    const rect = image.getBoundingClientRect();
    selection = { left: rect.width * .08, top: rect.height * .55, width: rect.width * .84, height: rect.height * .36 };
    updateSelectionBox();
  });
}

function discardCapture() {
  captureImage = null;
  selection = null;
  element("captureImage").removeAttribute("src");
  element("captureStage").hidden = true;
  element("captureEmpty").hidden = false;
  element("runOcr").disabled = true;
  element("ocrProgress").hidden = true;
  browser.storage.local.remove("ocrCaptureV1");
}

const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
modeButtons.forEach((button, index) => {
  button.addEventListener("click", () => activateMode(button.dataset.mode));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = modeButtons[(index + (event.key === "ArrowRight" ? 1 : -1) + modeButtons.length) % modeButtons.length];
    activateMode(next.dataset.mode);
    next.focus();
  });
});
element("captureStage").addEventListener("pointerdown", beginSelection);
element("captureStage").addEventListener("pointermove", moveSelection);
element("captureStage").addEventListener("pointerup", endSelection);
element("captureStage").addEventListener("pointercancel", endSelection);
element("runOcr").addEventListener("click", runOcr);
element("discardCapture").addEventListener("click", discardCapture);
element("translateText").addEventListener("click", translateText);
element("saveCorrection").addEventListener("click", saveCorrection);
element("copyTranslation").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(element("targetText").value);
    setStatus("Translation copied.", "success");
  } catch (_error) {
    element("targetText").select();
    setStatus("Press Ctrl+C to copy the selected translation.");
  }
});
element("clearText").addEventListener("click", () => {
  element("sourceText").value = "";
  element("targetText").value = "";
  setStatus("");
  updateTranslationActions();
  element("sourceText").focus();
});
element("sourceText").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); translateText(); }
});
element("sourceText").addEventListener("input", updateTranslationActions);
element("targetText").addEventListener("input", updateTranslationActions);
element("closePage").addEventListener("click", () => window.close());
window.addEventListener("pagehide", () => { ocrWorkerPromise?.then((worker) => worker.terminate()).catch(() => {}); });

if (location.hash === "#ocr") activateMode("ocr");
loadCapture().catch(() => setStatus("The captured image could not be loaded.", "error"));
