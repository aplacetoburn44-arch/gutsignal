// ocr.js — optional automatic label reading. Nothing here loads until the user
// explicitly taps "Auto-read this label", since the text-recognition library is
// several MB and we don't want to spend that data by default.

let tesseractLoadPromise = null;

export function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;

  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Could not load the text-recognition library — check your connection and try again.'));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

/**
 * Runs OCR on a data-URL image and returns raw recognized text.
 * onProgress receives Tesseract's progress messages (0-1 fractions).
 */
export async function recognizeLabel(imageDataUrl, onProgress) {
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(imageDataUrl, 'eng', {
    logger: onProgress ? (m) => onProgress(m) : undefined,
  });
  return data.text;
}

/**
 * Heuristic parser for US nutrition facts panels. OCR text from photos is noisy —
 * this is a best-effort autofill, always meant to be checked against the label, not
 * trusted blindly.
 */
export function parseNutritionText(text) {
  const t = (text || '').replace(/\r/g, '');
  const grab = (regex) => {
    const m = t.match(regex);
    return m ? parseFloat(m[1]) : null;
  };

  const out = {
    calories: grab(/calories\D{0,10}(\d{1,4})/i),
    protein: grab(/protein\D{0,10}(\d+(?:\.\d+)?)\s*g/i),
    carbs: grab(/total\s*carb\w*\D{0,10}(\d+(?:\.\d+)?)\s*g/i) ?? grab(/carbohydrate\D{0,10}(\d+(?:\.\d+)?)\s*g/i),
    fat: grab(/total\s*fat\D{0,10}(\d+(?:\.\d+)?)\s*g/i),
    fiber: grab(/(?:dietary\s*)?fiber\D{0,10}(\d+(?:\.\d+)?)\s*g/i),
    sugars: grab(/(?:total\s*)?sugars\D{0,10}(\d+(?:\.\d+)?)\s*g/i),
    sodium: grab(/sodium\D{0,10}(\d+(?:\.\d+)?)\s*mg/i),
    calcium: grab(/calcium\D{0,10}(\d+(?:\.\d+)?)\s*mg/i),
    iron: grab(/iron\D{0,10}(\d+(?:\.\d+)?)\s*mg/i),
  };

  const servingMatch = t.match(/serving\s*size\D{0,40}?([^\n]{1,40})/i);
  if (servingMatch) {
    const label = servingMatch[1].trim();
    out.servingLabel = label;
    const gramsMatch = label.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (gramsMatch) out.gramsPerServing = parseFloat(gramsMatch[1]);
  }

  return out;
}
