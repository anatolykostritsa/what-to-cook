const FRACTIONS = new Map([
  ["½", 1 / 2], ["¼", 1 / 4], ["¾", 3 / 4], ["⅓", 1 / 3], ["⅔", 2 / 3],
  ["⅛", 1 / 8], ["⅜", 3 / 8], ["⅝", 5 / 8], ["⅞", 7 / 8],
]);

const UNIT_ALIASES = new Map([
  ["g", "g"], ["gram", "g"], ["grams", "g"],
  ["kg", "kg"], ["kilogram", "kg"], ["kilograms", "kg"],
  ["ml", "ml"], ["milliliter", "ml"], ["milliliters", "ml"], ["millilitre", "ml"], ["millilitres", "ml"],
  ["l", "l"], ["liter", "l"], ["liters", "l"], ["litre", "l"], ["litres", "l"],
  ["tsp", "tsp"], ["teaspoon", "tsp"], ["teaspoons", "tsp"],
  ["tbsp", "tbsp"], ["tablespoon", "tbsp"], ["tablespoons", "tbsp"],
  ["cup", "cup"], ["cups", "cup"],
  ["oz", "oz"], ["ounce", "oz"], ["ounces", "oz"],
  ["lb", "lb"], ["lbs", "lb"], ["pound", "lb"], ["pounds", "lb"],
  ["clove", "clove"], ["cloves", "clove"],
  ["piece", "piece"], ["pieces", "piece"],
  ["pinch", "pinch"], ["pinches", "pinch"],
  ["handful", "handful"], ["handfuls", "handful"],
]);

const QUALITATIVE = /^(to taste|as needed|optional|for serving|for garnish)$/i;

function parseFractionToken(token) {
  if (!token) return null;
  const unicode = [...token].filter((char) => FRACTIONS.has(char));
  if (unicode.length) {
    const integerPart = Number(token.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, "").trim() || 0);
    return integerPart + unicode.reduce((sum, char) => sum + FRACTIONS.get(char), 0);
  }
  if (/^\d+\/\d+$/.test(token)) {
    const [a, b] = token.split("/").map(Number);
    return b ? a / b : null;
  }
  const decimal = Number(token.replace(",", "."));
  return Number.isFinite(decimal) ? decimal : null;
}

function parseLeadingQuantity(value) {
  const normalized = value.replace(/([0-9])([½¼¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2").trim();
  const parts = normalized.split(/\s+/);
  if (!parts.length) return { quantity: null, consumed: 0 };

  const first = parseFractionToken(parts[0]);
  if (first === null) return { quantity: null, consumed: 0 };

  if (parts[1] && (/^\d+\/\d+$/.test(parts[1]) || /^[½¼¾⅓⅔⅛⅜⅝⅞]$/.test(parts[1]))) {
    const second = parseFractionToken(parts[1]);
    if (second !== null) return { quantity: first + second, consumed: 2 };
  }
  return { quantity: first, consumed: 1 };
}

export function parseMeasure(raw) {
  const original = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!original) return { quantity: null, unit: null, raw: null, qualitative: false };
  if (QUALITATIVE.test(original)) return { quantity: null, unit: original.toLowerCase(), raw: original, qualitative: true };

  const { quantity, consumed } = parseLeadingQuantity(original);
  if (quantity === null) return { quantity: null, unit: original, raw: original, qualitative: false };

  const tokens = original.split(/\s+/);
  const rest = tokens.slice(consumed).join(" ").trim().replace(/[.,]$/, "");
  if (!rest) return { quantity, unit: null, raw: original, qualitative: false };

  const canonicalUnit = UNIT_ALIASES.get(rest.toLowerCase());
  if (canonicalUnit) return { quantity, unit: canonicalUnit, raw: original, qualitative: false };

  return { quantity: null, unit: original, raw: original, qualitative: false };
}

export function normalizeImportedIngredient(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
