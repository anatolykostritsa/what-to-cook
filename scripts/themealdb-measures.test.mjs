import test from "node:test";
import assert from "node:assert/strict";
import { parseMeasure } from "./themealdb-measures.mjs";

test("parses decimal metric measure", () => {
  assert.deepEqual(parseMeasure("1.5 kg"), { quantity: 1.5, unit: "kg", raw: "1.5 kg", qualitative: false });
});

test("parses mixed fraction", () => {
  assert.deepEqual(parseMeasure("1 1/2 cups"), { quantity: 1.5, unit: "cup", raw: "1 1/2 cups", qualitative: false });
});

test("parses unicode fraction", () => {
  assert.deepEqual(parseMeasure("½ tsp"), { quantity: 0.5, unit: "tsp", raw: "½ tsp", qualitative: false });
});

test("preserves unknown measure without invented quantity", () => {
  assert.deepEqual(parseMeasure("2 small handfuls chopped"), { quantity: null, unit: "2 small handfuls chopped", raw: "2 small handfuls chopped", qualitative: false });
});

test("preserves qualitative measure", () => {
  assert.deepEqual(parseMeasure("to taste"), { quantity: null, unit: "to taste", raw: "to taste", qualitative: true });
});
