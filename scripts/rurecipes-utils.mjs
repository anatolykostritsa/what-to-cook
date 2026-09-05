import { createHash } from "node:crypto";

export function normalizeRussianText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»„“”"']/g, " ")
    .replace(/[^a-zа-я0-9%+]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ingredientSignature(value) {
  return normalizeRussianText(value)
    .split(" ")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"))
    .join("|");
}

export function cleanIngredientName(value) {
  return String(value ?? "")
    .replace(/\([^)]*(?:для жарки|для подачи|по вкусу|по желанию)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]$/, "");
}

function parseNumberToken(raw) {
  const value = String(raw ?? "").trim().replace(",", ".");
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeRussianUnit(value) {
  const raw = String(value ?? "").trim();
  const n = normalizeRussianText(raw);
  if (!n) return null;
  if (/^(г|гр|грамм|грамма|граммов)$/.test(n)) return "г";
  if (/^(кг|килограмм|килограмма|килограммов)$/.test(n)) return "кг";
  if (/^(мл|миллилитр|миллилитра|миллилитров)$/.test(n)) return "мл";
  if (/^(л|литр|литра|литров)$/.test(n)) return "л";
  if (/^(шт|шт\.|штука|штуки|штук)$/.test(raw.toLowerCase()) || /^(шт|штука|штуки|штук)$/.test(n)) return "шт";
  if (/^(ч\.?\s*л\.?|чайн(?:ая|ые|ых)? ложк(?:а|и|ек))/.test(raw.toLowerCase()) || /^ч л/.test(n)) return "ч. л.";
  if (/^(ст\.?\s*л\.?|столов(?:ая|ые|ых)? ложк(?:а|и|ек))/.test(raw.toLowerCase()) || /^ст л/.test(n)) return "ст. л.";
  if (/^(стакан|стакана|стаканов|ст\.)$/.test(raw.toLowerCase()) || /^(стакан|стакана|стаканов|ст)$/.test(n)) return "стакан";
  if (/^зубчик/.test(n)) return "зубчик";
  if (/^щепот/.test(n)) return "щепотка";
  if (/^пуч/.test(n)) return "пучок";
  if (/^веточ/.test(n)) return "веточка";
  if (/^горст/.test(n)) return "горсть";
  if (/^бан/.test(n)) return "банка";
  if (/^упаков/.test(n)) return "упаковка";
  if (/^пакет/.test(n)) return "пакет";
  return raw || null;
}

export function parseRussianIngredientLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  const sourceName = (match?.[1] ?? raw).trim();
  const measure = (match?.[2] ?? "").trim();
  const name = cleanIngredientName(sourceName);
  const normalizedName = normalizeRussianText(name);
  if (!name || !normalizedName) return null;
  if (!/[a-zа-я]/i.test(normalizedName)) return null;
  if (/^(ингредиенты?|продукты?|для соуса|для подачи|для украшения)$/i.test(normalizedName)) return null;
  if (!measure) return { name, display_name: name, quantity: null, unit: null, optional: false, raw_measure: null };

  const qualitative = /^(по вкусу|по желанию|для жарки|для подачи|сколько потребуется|по необходимости)/i.test(measure);
  if (qualitative) {
    return { name, display_name: name, quantity: null, unit: measure, optional: /по желанию|для подачи/i.test(measure), raw_measure: measure };
  }

  if (/^(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)(?:\s+|$)/.test(measure)) {
    return { name, display_name: name, quantity: null, unit: measure, optional: false, raw_measure: measure };
  }

  const numberMatch = measure.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:[.,]\d+)?)(?:\s+|$)(.*)$/);
  if (!numberMatch) {
    const wordNumber = measure.match(/^(пара|пол(?:овина)?)(?:\s+|$)(.*)$/i);
    if (wordNumber) {
      return { name, display_name: name, quantity: /^пара$/i.test(wordNumber[1]) ? 2 : 0.5, unit: normalizeRussianUnit(wordNumber[2]), optional: false, raw_measure: measure };
    }
    return { name, display_name: name, quantity: null, unit: measure, optional: false, raw_measure: measure };
  }

  return { name, display_name: name, quantity: parseNumberToken(numberMatch[1]), unit: normalizeRussianUnit(numberMatch[2]), optional: false, raw_measure: measure };
}

export function inferCategory(title, description = "") {
  const text = normalizeRussianText(`${title} ${description}`);
  const rules = [
    ["Супы", /(суп|борщ|щи|солянк|уха|окрошк|харчо|рассольник)/],
    ["Салаты", /(салат|винегрет)/],
    ["Выпечка", /(пирог|пирожк|булочк|хлеб|кекс|печень|блин|олад|ватруш|шарлот|тесто)/],
    ["Десерты", /(десерт|торт|мусс|желе|морожен|конфет|суфле|крем|пудинг)/],
    ["Завтраки", /(завтрак|омлет|яичниц|каша|сырник|гренк)/],
    ["Рыба и морепродукты", /(рыб|лосос|семг|форел|скумбри|треск|кревет|кальмар|мид|тунец)/],
    ["Птица", /(куриц|курин|индейк|утк|гус)/],
    ["Мясо", /(говядин|свинин|баранин|теляти|мяс|фарш|котлет|стейк)/],
    ["Закуски", /(закуск|бутерброд|канапе|паштет|намазк)/],
    ["Гарниры", /(гарнир|картоф|рис|гречк|макарон|пюре)/],
    ["Напитки", /(напиток|компот|морс|лимонад|коктейль|смузи|чай|кофе)/],
  ];
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? "Другие";
}

export function inferCuisine(title, description = "") {
  const text = normalizeRussianText(`${title} ${description}`);
  const rules = [
    ["Русская", /русск/], ["Украинская", /украин/], ["Белорусская", /белорус/], ["Грузинская", /грузин/],
    ["Армянская", /армян/], ["Итальянская", /итальян/], ["Французская", /француз/], ["Китайская", /китай/],
    ["Японская", /япон/], ["Корейская", /корей/], ["Мексиканская", /мексикан/], ["Турецкая", /турец/],
    ["Индийская", /индий/], ["Греческая", /греческ/], ["Американская", /американ/],
  ];
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? null;
}

export function scoreRecipe(row) {
  const title = String(row?.title ?? "").trim();
  const ingredients = Array.isArray(row?.ingredients) ? row.ingredients : [];
  const steps = Array.isArray(row?.recipe) ? row.recipe.filter(Boolean) : [];
  const instructionsLength = steps.join(" ").length;
  if (title.length < 4 || title.length > 100) return -Infinity;
  if (ingredients.length < 3 || ingredients.length > 30) return -Infinity;
  if (steps.length < 2 || instructionsLength < 120) return -Infinity;
  const parsed = ingredients.map(parseRussianIngredientLine).filter(Boolean);
  if (parsed.length < Math.max(3, Math.ceil(ingredients.length * 0.75))) return -Infinity;
  let score = 0;
  if (row.image_link) score += 12;
  if (row.description && String(row.description).length >= 40) score += 8;
  score += ingredients.length >= 5 && ingredients.length <= 16 ? 16 : 8;
  score += steps.length >= 3 && steps.length <= 14 ? 16 : 8;
  score += instructionsLength >= 250 && instructionsLength <= 5000 ? 18 : 8;
  score += Math.round((parsed.length / ingredients.length) * 20);
  if (/20\d{2}/.test(title)) score -= 3;
  return score;
}

export function recipeExternalId(link) {
  const match = String(link ?? "").match(/[?&]rid=(\d+)/);
  return match?.[1] ?? createHash("sha256").update(String(link ?? "")).digest("hex").slice(0, 24);
}

export function stableUuid(value) {
  const h = createHash("sha256").update(String(value)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
