// Unit tests for afiyeat-mcp's pure recipe logic. No database needed:
//   deno test --no-lock --node-modules-dir=none --no-config recipes_test.ts

import { assert, assertEquals, assertNotEquals, assertThrows } from "./asserts.ts";
import {
  contentMismatches,
  createRecipeInput,
  importKeyFor,
  likePattern,
  RecipeInputError,
  stripStepNumber,
  toRecipeContent,
  toRecipePatch,
  updateRecipeInput,
} from "../../functions/afiyeat-mcp/recipes.ts";

const base = {
  title: "Shakshuka",
  ingredients: ["6 eggs", "1 can (400 g) tomatoes"],
  instructions: ["Simmer the sauce.", "Crack in the eggs."],
  user_confirmed: true as const,
};

Deno.test("stripStepNumber removes leading step numbers only", () => {
  assertEquals(stripStepNumber("1. Preheat the oven."), "Preheat the oven.");
  assertEquals(stripStepNumber("Step 3: Rest the dough."), "Rest the dough.");
  assertEquals(stripStepNumber("12) Serve."), "Serve.");
  assertEquals(stripStepNumber("2 eggs go in now."), "2 eggs go in now.");
  assertEquals(stripStepNumber("350F oven for 1 hour."), "350F oven for 1 hour.");
  assertEquals(stripStepNumber("1."), "1.");
});

Deno.test("input schema trims text and rejects bad values", () => {
  const parsed = createRecipeInput.parse({ ...base, title: "  Shakshuka  ", ingredients: [" 6 eggs "] , instructions: ["Go"] });
  assertEquals(parsed.title, "Shakshuka");
  assertEquals(parsed.ingredients, ["6 eggs"]);
  for (const bad of [
    { ...base, user_confirmed: false },
    { ...base, title: "" },
    { ...base, ingredients: [] },
    { ...base, ingredients: ["   "] },
    { ...base, instructions: [] },
    { ...base, servings: 0 },
    { ...base, prep_time_minutes: 1.5 },
    { ...base, cook_temp_unit: "K" },
    { ...base, difficulty: "impossible" },
    { ...base, is_public: true },
    { ...base, user_id: "00000000-0000-0000-0000-000000000000" },
    { ...base, title: "x".repeat(201) },
  ]) {
    assert(!createRecipeInput.safeParse(bad).success, JSON.stringify(bad).slice(0, 80));
  }
});

Deno.test("toRecipeContent fills unknowns with null and cleans tags", () => {
  const content = toRecipeContent(createRecipeInput.parse({ ...base, tags: ["Brunch", "#brunch", " eggs "] }));
  assertEquals(content, {
    title: "Shakshuka",
    description: null,
    servings: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    cook_temp: null,
    cook_temp_unit: null,
    difficulty: null,
    ingredients: ["6 eggs", "1 can (400 g) tomatoes"],
    instructions: ["Simmer the sauce.", "Crack in the eggs."],
    tags: ["Brunch", "eggs"],
  });
});

Deno.test("a temperature needs a unit; a unit alone is dropped", () => {
  assertThrows(() => toRecipeContent(createRecipeInput.parse({ ...base, cook_temp: 200 })));
  const unitOnly = toRecipeContent(createRecipeInput.parse({ ...base, cook_temp_unit: "C" }));
  assertEquals(unitOnly.cook_temp_unit, null);
});

Deno.test("importKeyFor ignores cosmetic differences but not real ones", async () => {
  const a = await importKeyFor(toRecipeContent(createRecipeInput.parse(base)));
  const b = await importKeyFor(toRecipeContent(createRecipeInput.parse({ ...base, title: "  shakshuka " })));
  const c = await importKeyFor(toRecipeContent(createRecipeInput.parse({ ...base, servings: 2 })));
  const d = await importKeyFor(toRecipeContent(createRecipeInput.parse({
    ...base,
    instructions: ["1. Simmer the sauce.", "2. Crack in the eggs."],
  })));
  assert(a.startsWith("chatgpt:v1:") && a.length === "chatgpt:v1:".length + 64);
  assertEquals(a, b);
  assertEquals(a, d, "step numbers are stripped before fingerprinting");
  assertNotEquals(a, c);
});

Deno.test("toRecipePatch keeps only given fields and checks temperature units", () => {
  const current = toRecipeContent(createRecipeInput.parse({ ...base, cook_temp: 180, cook_temp_unit: "C" }));
  const id = "4f8a7c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
  assertEquals(
    toRecipePatch(updateRecipeInput.parse({ recipe_id: id, servings: 3, user_confirmed: true }), current),
    { servings: 3 },
  );
  assertEquals(
    toRecipePatch(updateRecipeInput.parse({ recipe_id: id, cook_temp: 200, user_confirmed: true }), current),
    { cook_temp: 200, cook_temp_unit: "C" },
  );
  assertEquals(
    toRecipePatch(updateRecipeInput.parse({ recipe_id: id, cook_temp: null, user_confirmed: true }), current),
    { cook_temp: null, cook_temp_unit: null },
  );
  try {
    toRecipePatch(updateRecipeInput.parse({ recipe_id: id, user_confirmed: true }), current);
    throw new Error("expected an error");
  } catch (e) {
    assert(e instanceof RecipeInputError);
  }
  assert(!updateRecipeInput.safeParse({ recipe_id: id, is_public: true, user_confirmed: true }).success);
  assert(!updateRecipeInput.safeParse({ recipe_id: "not-a-uuid", user_confirmed: true }).success);
});

Deno.test("contentMismatches compares only written fields", () => {
  const stored = toRecipeContent(createRecipeInput.parse(base));
  assertEquals(contentMismatches({ title: "Shakshuka" }, stored), []);
  assertEquals(contentMismatches({ title: "Other", servings: null }, stored), ["title"]);
  assertEquals(contentMismatches({ ingredients: ["6 eggs"] }, stored), ["ingredients"]);
});

Deno.test("likePattern escapes wildcards", () => {
  assertEquals(likePattern("soup"), "%soup%");
  assertEquals(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});
