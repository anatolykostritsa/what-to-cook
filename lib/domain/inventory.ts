export type InventoryProduct = { id: string; name: string; quantity: number | null; unit: string | null; expiry_date?: string | null };
export type InventoryIngredient = { id: string; name: string; quantity: number | null; unit: string | null; optional?: boolean | null };
export type CanonicalUnit = "г" | "мл" | "шт" | string;

const NAME_ALIASES: Record<string, string> = {
  яйцо: "яйца", яйца: "яйца", паста: "макароны", спагетти: "макароны", лапша: "макароны",
  помидор: "помидоры", томат: "помидоры", томаты: "помидоры", "куриное филе": "курица",
  "куриная грудка": "курица", "репчатый лук": "лук",
};

export function normalizeName(value: string) {
  const normalized = value.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
  return NAME_ALIASES[normalized] ?? normalized;
}

export function namesMatch(left: string, right: string) {
  const a = normalizeName(left); const b = normalizeName(right);
  return a === b || a.includes(b) || b.includes(a);
}

export function normalizeUnit(unit: string | null | undefined): CanonicalUnit | null {
  const value = unit?.toLowerCase().trim().replace(/\.$/, "") ?? "";
  if (!value) return null;
  if (value === "кг" || value === "г") return "г";
  if (value === "л" || value === "мл") return "мл";
  if (value === "шт" || value === "штука" || value === "штук") return "шт";
  return value;
}

export function toCanonical(quantity: number, unit: string | null | undefined) {
  const normalizedUnit = normalizeUnit(unit);
  const multiplier = unit?.toLowerCase().trim() === "кг" || unit?.toLowerCase().trim() === "л" ? 1000 : 1;
  return { quantity: quantity * multiplier, unit: normalizedUnit };
}

export function fromCanonical(quantity: number, originalUnit: string | null | undefined) {
  const divisor = originalUnit?.toLowerCase().trim() === "кг" || originalUnit?.toLowerCase().trim() === "л" ? 1000 : 1;
  return quantity / divisor;
}

export function assessIngredient(ingredient: InventoryIngredient, products: InventoryProduct[], factor = 1) {
  const matchingByName = products.filter((product) => namesMatch(product.name, ingredient.name) && (!product.expiry_date || daysUntilExpiry(product.expiry_date) >= 0));
  if (ingredient.quantity === null) {
    return { enough: matchingByName.length > 0, needed: null, available: null, unit: normalizeUnit(ingredient.unit), deficit: null, deductions: [] as { ingredient_id: string; product_id: string; quantity: number }[] };
  }
  const needed = toCanonical(ingredient.quantity * factor, ingredient.unit);
  const compatible = matchingByName.filter((product) => product.quantity !== null).map((product) => ({ product, amount: toCanonical(product.quantity!, product.unit) })).filter(({ amount }) => amount.unit === needed.unit);
  const available = compatible.reduce((sum, entry) => sum + entry.amount.quantity, 0);
  let remaining = needed.quantity; const deductions: { ingredient_id: string; product_id: string; quantity: number }[] = [];
  for (const entry of compatible) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, entry.amount.quantity);
    deductions.push({ ingredient_id: ingredient.id, product_id: entry.product.id, quantity: fromCanonical(take, entry.product.unit) });
    remaining -= take;
  }
  return { enough: remaining <= 0, needed: needed.quantity, available, unit: needed.unit, deficit: Math.max(0, remaining), deductions };
}

export function formatQuantity(quantity: number | null, unit: string | null) {
  return quantity === null ? "количество не указано" : `${Number(quantity.toFixed(2))} ${unit ?? ""}`.trim();
}

export function daysUntilExpiry(date: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000);
}
