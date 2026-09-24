export type ParsedQuickProduct = {
  title: string;
  price: string;
  inventoryQuantity: string;
};

const ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  isa: 1,
  dalawa: 2,
  tatlo: 3,
  apat: 4,
  lima: 5,
  anim: 6,
  pito: 7,
  walo: 8,
  siyam: 9,
  sampu: 10,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Normalize speech quirks before parsing. */
export function normalizeSpeechText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[₱]/g, " pesos ")
    .replace(/\b(p\.?\s*h\.?\s*p\.?|piso|pesos?)\b/gi, " pesos ")
    .replace(/\b(piece|pieces|pcs|pc)\b/gi, " pieces ")
    .replace(/\b(point|dot)\b/gi, ".")
    .replace(/(\d)\s*[.,]\s*(\d)/g, "$1.$2")
    .replace(/[^\w.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert spoken number phrases to a number.
 * Handles: "250", "two hundred fifty", "one thousand two hundred"
 */
export function wordsToNumber(raw: string): number | null {
  const text = normalizeSpeechText(raw)
    .replace(/\b(and|na|ay|lang|only|pesos?|php|pieces?|price|presyo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  if (/^\d+(?:\.\d{1,2})?$/.test(text)) return Number(text);

  // Digits with leftover noise stripped ("250 pesos" already cleaned)
  const onlyDigits = text.match(/\d+(?:\.\d{1,2})?/g);
  if (onlyDigits?.length === 1 && !/[a-z]/.test(text.replace(onlyDigits[0], ""))) {
    return Number(onlyDigits[0]);
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawNumberWord = false;
  let fraction: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "." || token === "point") {
      const rest = tokens.slice(i + 1);
      let frac = "";
      for (const t of rest) {
        if (/^\d$/.test(t)) frac += t;
        else if (ONES[t] !== undefined && ONES[t] < 10) frac += String(ONES[t]);
        else break;
      }
      if (frac) fraction = Number(`0.${frac}`);
      break;
    }

    if (/^\d+(?:\.\d{1,2})?$/.test(token)) {
      current += Number(token);
      sawNumberWord = true;
      continue;
    }
    if (ONES[token] !== undefined) {
      current += ONES[token];
      sawNumberWord = true;
      continue;
    }
    if (TENS[token] !== undefined) {
      current += TENS[token];
      sawNumberWord = true;
      continue;
    }
    if (token === "hundred") {
      current = (current || 1) * 100;
      sawNumberWord = true;
      continue;
    }
    if (token === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      sawNumberWord = true;
      continue;
    }
  }

  if (!sawNumberWord) {
    // Last resort: any digit sequence in the string
    if (onlyDigits?.length) return Number(onlyDigits[onlyDigits.length - 1]);
    return null;
  }
  let value = total + current;
  if (fraction !== null) value += fraction;
  return value;
}

export function parsePriceFromSpeech(raw: string): string | null {
  const text = normalizeSpeechText(raw);
  if (!text) return null;

  // Digits first — most accurate for "250", "250 pesos", "price is 250"
  const digitMatches = [...text.matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) =>
    Number(m[0]),
  );
  if (digitMatches.length) {
    // Prefer number next to pesos; else the largest (price > qty)
    const pesoNear = text.match(
      /(?:pesos?\s*)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*pesos?/,
    );
    if (pesoNear) {
      const n = Number(pesoNear[1] || pesoNear[2]);
      if (Number.isFinite(n) && n >= 0) return formatMoney(n);
    }
    return formatMoney(Math.max(...digitMatches));
  }

  const labeled = text.match(
    /(?:price|presyo|costs?|for|ay)\s*(?:is|ng)?\s*(?:pesos?)?\s*(.+)$/i,
  );
  const candidate = labeled?.[1] || text;
  const fromWords = wordsToNumber(candidate);
  if (fromWords !== null && fromWords >= 0) return formatMoney(fromWords);

  return null;
}

export function parseQuantityFromSpeech(raw: string): string | null {
  const text = normalizeSpeechText(raw);
  if (!text) return null;

  const withUnit = text.match(
    /(\d+(?:\.\d+)?|[a-z]+(?:\s+[a-z]+)*)\s+pieces?\b/i,
  );
  if (withUnit) {
    const n = wordsToNumber(withUnit[1]);
    if (n !== null && n >= 0 && n <= 9999) return String(Math.floor(n));
  }

  const labeled = text.match(
    /(?:quantity|qty|stock|how many|meron|may)\s*(?:is|ng|ako)?\s*(.+)$/i,
  );
  if (labeled) {
    const n = wordsToNumber(labeled[1]);
    if (n !== null && n >= 0 && n <= 9999) return String(Math.floor(n));
  }

  // Plain number: "3", "three"
  const n = wordsToNumber(text);
  if (n !== null && n >= 0 && n <= 9999) return String(Math.floor(n));

  const digits = text.match(/\d+/);
  if (digits) {
    const q = Number(digits[0]);
    if (q >= 0 && q <= 9999) return String(q);
  }

  return null;
}

export function parseNameFromSpeech(raw: string): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  text = text
    .replace(
      /^(?:this is|it's|its|my|a|an|the|um|uh|so|okay|ok|product(?: name)? is|pangalan(?: is| ay)?)\s+/i,
      "",
    )
    .replace(/[.\s]+$/g, "")
    .trim();

  if (text.length < 2) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Parse a full one-liner into name / price / qty. */
export function parseQuickProductMessage(raw: string): ParsedQuickProduct | null {
  const text = normalizeSpeechText(raw);
  if (!text) return null;

  let working = text;
  let inventoryQuantity = "1";
  let price = "";

  const qtyMatch = working.match(
    /\b(\d+|[a-z]+(?:\s+[a-z]+)*)\s+pieces?\b/i,
  );
  if (qtyMatch) {
    const q = wordsToNumber(qtyMatch[1]);
    if (q !== null) inventoryQuantity = String(Math.floor(q));
    working = working.replace(qtyMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  const priceMatch =
    working.match(/\bpesos?\s+(\d+(?:\.\d{1,2})?|[a-z]+(?:\s+[a-z]+)*)\b/i) ||
    working.match(/\b(\d+(?:\.\d{1,2})?|[a-z]+(?:\s+[a-z]+)*)\s+pesos?\b/i);

  if (priceMatch) {
    const p = wordsToNumber(priceMatch[1]);
    if (p !== null) {
      price = formatMoney(p);
      working = working.replace(priceMatch[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  if (!price) {
    const trailingDigits = working.match(/^(.*?)(\d+(?:\.\d{1,2})?)\s*$/);
    if (trailingDigits && trailingDigits[1].trim()) {
      price = formatMoney(Number(trailingDigits[2]));
      working = trailingDigits[1].trim();
    }
  }

  const title = working
    .replace(/\b(pesos?|php|price|presyo|pieces?|quantity|qty)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:this is|it's|its|my|a|an|the)\s+/i, "")
    .trim();

  const niceTitle = parseNameFromSpeech(title);
  if (!niceTitle || !price || Number.isNaN(Number(price))) return null;

  return { title: niceTitle, price, inventoryQuantity };
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
