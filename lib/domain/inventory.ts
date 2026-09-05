export type InventoryProduct = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expiry_date?: string | null;
  ingredient_id?: string | null;
  ingredient_match_group?: string | null;
  ingredient_family_key?: string | null;
};

export type InventoryIngredient = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  optional?: boolean | null;
  ingredient_id?: string | null;
  ingredient_match_group?: string | null;
  ingredient_family_key?: string | null;
};

export type CanonicalUnit = "г" | "мл" | "шт" | string;

export function normalizeName(value: string) {
  return value.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

export function namesMatch(left: string, right: string) {
  return normalizeName(left) === normalizeName(right);
}

export function ingredientsMatch(
  ingredient: Pick<InventoryIngredient, "name" | "ingredient_id" | "ingredient_match_group">,
  product: Pick<InventoryProduct, "name" | "ingredient_id" | "ingredient_match_group">,
) {
  if (ingredient.ingredient_id && product.ingredient_id) {
    if (ingredient.ingredient_match_group && product.ingredient_match_group) {
      return ingredient.ingredient_match_group === product.ingredient_match_group;
    }
    return ingredient.ingredient_id === product.ingredient_id;
  }
  return namesMatch(ingredient.name, product.name);
}

export function ingredientsRelated(
  ingredient: Pick<InventoryIngredient, "ingredient_family_key" | "ingredient_match_group">,
  product: Pick<InventoryProduct, "ingredient_family_key" | "ingredient_match_group">,
) {
  return Boolean(
    ingredient.ingredient_family_key &&
      product.ingredient_family_key &&
      ingredient.ingredient_family_key === product.ingredient_family_key &&
      ingredient.ingredient_match_group !== product.ingredient_match_group,
  );
}

export function normalizeUnit(unit: string | null | undefined): CanonicalUnit | null {
  const value = unit?.toLowerCase().trim().replace(/\.$/, "") ?? "";
  if (!value) return null;
  if (value === "кг" || value === "kg" || value === "г" || value === "g") return "г";
  if (value === "л" || value === "l" || value === "мл" || value === "ml") return "мл";
  if (value === "шт" || value === "штука" || value === "штук" || value === "piece" || value === "pieces") return "шт";
  return value;
}

export function toCanonical(quantity: number, unit: string | null | undefined) {
  const raw = unit?.toLowerCase().trim().replace(/\.$/, "") ?? "";
  const normalizedUnit = normalizeUnit(unit);
  const multiplier = raw === "кг" || raw === "kg" || raw === "л" || raw === "l" ? 1000 : 1;
  return { quantity: quantity * multiplier, unit: normalizedUnit };
}

export function fromCanonical(quantity: number, originalUnit: string | null | undefined) {
  const raw = originalUnit?.toLowerCase().trim().replace(/\.$/, "") ?? "";
  const divisor = raw === "кг" || raw === "kg" || raw === "л" || raw === "l" ? 1000 : 1;
  return quantity / divisor;
}

export function assessIngredient(ingredient: InventoryIngredient, products: InventoryProduct[], factor = 1) {
  const validProducts = products.filter((product) => !product.expiry_date || daysUntilExpiry(product.expiry_date) >= 0);
  const matching = validProducts.filter((product) => ingredientsMatch(ingredient, product));
  const relatedProducts = validProducts.filter((product) => !ingredientsMatch(ingredient, product) && ingredientsRelated(ingredient, product));

  if (ingredient.quantity === null) {
    return {
      enough: matching.length > 0,
      needed: null,
      available: null,
      unit: normalizeUnit(ingredient.unit),
      deficit: null,
      deductions: [] as { ingredient_id: string; product_id: string; quantity: number }[],
      relatedProducts,
    };
  }

  const needed = toCanonical(ingredient.quantity * factor, ingredient.unit);
  const compatible = matching
    .filter((product) => product.quantity !== null)
    .map((product) => ({ product, amount: toCanonical(product.quantity!, product.unit) }))
    .filter(({ amount }) => amount.unit === needed.unit);

  const available = compatible.reduce((sum, entry) => sum + entry.amount.quantity, 0);
  let remaining = needed.quantity;
  const deductions: { ingredient_id: string; product_id: string; quantity: number }[] = [];

  for (const entry of compatible) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, entry.amount.quantity);
    deductions.push({
      ingredient_id: ingredient.id,
      product_id: entry.product.id,
      quantity: fromCanonical(take, entry.product.unit),
    });
    remaining -= take;
  }

  return {
    enough: remaining <= 0,
    needed: needed.quantity,
    available,
    unit: needed.unit,
    deficit: Math.max(0, remaining),
    deductions,
    relatedProducts,
  };
}

export function formatQuantity(quantity: number | null, unit: string | null) {
  return quantity === null ? "количество не указано" : `${Number(quantity.toFixed(2))} ${unit ?? ""}`.trim();
}

export function daysUntilExpiry(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000);
}
