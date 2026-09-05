import test from "node:test";
import assert from "node:assert/strict";
import { parseRussianIngredientLine, inferCategory, normalizeRussianText } from "./rurecipes-utils.mjs";

test("parses metric ingredient", () => {
  assert.deepEqual(parseRussianIngredientLine("мука - 300 г"), {
    name: "мука", display_name: "мука", quantity: 300, unit: "г", optional: false, raw_measure: "300 г",
  });
});

test("parses tablespoon and comma decimal", () => {
  const parsed = parseRussianIngredientLine("масло растительное — 1,5 ст. ложки");
  assert.equal(parsed.quantity, 1.5);
  assert.equal(parsed.unit, "ст. л.");
});

test("keeps qualitative measure", () => {
  const parsed = parseRussianIngredientLine("соль - по вкусу");
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.unit, "по вкусу");
});

test("keeps ranges without fake precision", () => {
  const parsed = parseRussianIngredientLine("яйца - 2-3 шт.");
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.unit, "2-3 шт.");
});

test("normalizes russian text and detects category", () => {
  assert.equal(normalizeRussianText("  Куриное ФИЛЕ, ёлки! "), "куриное филе елки");
  assert.equal(inferCategory("Куриный суп с лапшой"), "Супы");
});
