// Recipe validation, normalisation and storage for afiyeat-mcp.
//
// Everything here works through a Supabase client that carries the signed-in
// user's own access token, so the existing RLS policies on public.recipes
// decide what can be read and written. No service-role key is used anywhere.
// Queries also filter on user_id explicitly: the "Users can view public
// recipes" policy lets any signed-in user read everyone's public recipes,
// and these tools are about the caller's own recipes only.

import { type SupabaseClient, z } from "./deps.ts";

export const RECIPE_SOURCE = "chatgpt";
export const IMPORT_KEY_PREFIX = "chatgpt:v1:";

// Limits match or sit just above what the app's own forms produce.
export const LIMITS = {
  title: 200,
  description: 2000,
  ingredient: 500,
  ingredients: 200,
  instruction: 4000,
  instructions: 100,
  tag: 40,
  tags: 20,
  minutes: 10_080, // one week
  servings: 1000,
  temp: 1000,
} as const;

// ------------------------------------------------------------ validation

const text = (max: number) =>
  z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(max));

const optionalText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max))
    .nullish();

const minutes = z.number().int().min(0).max(LIMITS.minutes).nullish();

const fields = {
  title: text(LIMITS.title).describe("Recipe name, e.g. \"Weeknight Chicken Shawarma\"."),
  description: optionalText(LIMITS.description).describe("One or two sentences about the dish."),
  servings: z.number().int().min(1).max(LIMITS.servings).nullish().describe("Number of servings."),
  prep_time_minutes: minutes.describe("Hands-on prep time in minutes."),
  cook_time_minutes: minutes.describe("Cooking time in minutes."),
  cook_temp: z.number().int().min(0).max(LIMITS.temp).nullish().describe(
    "Oven or cooking temperature, if the recipe has one. Requires cook_temp_unit.",
  ),
  cook_temp_unit: z.enum(["F", "C"]).nullish().describe("Unit for cook_temp: \"F\" or \"C\"."),
  difficulty: z.enum(["easy", "medium", "hard"]).nullish().describe("Only if the recipe states or clearly implies it."),
  ingredients: z
    .array(text(LIMITS.ingredient))
    .min(1)
    .max(LIMITS.ingredients)
    .describe("One ingredient per item, with its quantity and unit, e.g. \"2 cups (250 g) plain flour, sifted\"."),
  instructions: z
    .array(text(LIMITS.instruction))
    .min(1)
    .max(LIMITS.instructions)
    .describe("One step per item, in order, without step numbers."),
  tags: z
    .array(text(LIMITS.tag))
    .max(LIMITS.tags)
    .nullish()
    .describe("Short labels such as \"dinner\", \"vegetarian\", \"quick\"."),
};

const userConfirmed = z
  .literal(true)
  .describe(
    "Must be true. Set it only when the user has explicitly asked to save this " +
      "finished recipe to Afiyeat in this conversation.",
  );

export const createRecipeInput = z
  .object({ ...fields, user_confirmed: userConfirmed })
  .strict();

export const updateRecipeInput = z
  .object({
    recipe_id: z.uuid().describe("ID of one of the user's own recipes."),
    title: fields.title.optional(),
    description: fields.description,
    servings: fields.servings,
    prep_time_minutes: fields.prep_time_minutes,
    cook_time_minutes: fields.cook_time_minutes,
    cook_temp: fields.cook_temp,
    cook_temp_unit: fields.cook_temp_unit,
    difficulty: fields.difficulty,
    ingredients: fields.ingredients.optional(),
    instructions: fields.instructions.optional(),
    tags: fields.tags,
    user_confirmed: userConfirmed,
  })
  .strict();

export const listRecipesInput = z
  .object({
    query: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().max(100))
      .optional()
      .describe("Optional text to match in the recipe title."),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(10_000).default(0),
    only_from_chatgpt: z.boolean().default(false).describe(
      "true to list only recipes saved from ChatGPT.",
    ),
  })
  .strict();

export const getRecipeInput = z.object({ recipe_id: z.uuid() }).strict();

export type CreateRecipeInput = z.infer<typeof createRecipeInput>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeInput>;
export type ListRecipesInput = z.infer<typeof listRecipesInput>;

// ---------------------------------------------------------- normalisation

/** A step written as "1. Do x" or "Step 2: Do y" is stored as "Do x"; the app numbers steps itself. */
export function stripStepNumber(step: string): string {
  const stripped = step.replace(/^\s*(?:step\s*)?\d{1,3}\s*[.):-]\s+/i, "").trim();
  return stripped || step.trim();
}

function cleanTags(tags: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#/, "");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** The columns written for a recipe, in the same shapes AddRecipeDialog writes. */
export interface RecipeContent {
  title: string;
  description: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  cook_temp: number | null;
  cook_temp_unit: "F" | "C" | null;
  difficulty: "easy" | "medium" | "hard" | null;
  ingredients: string[];
  instructions: string[];
  tags: string[];
}

export class RecipeInputError extends Error {}

export function toRecipeContent(input: CreateRecipeInput): RecipeContent {
  const cookTemp = input.cook_temp ?? null;
  const unit = input.cook_temp_unit ?? null;
  if (cookTemp !== null && unit === null) {
    throw new RecipeInputError("cook_temp_unit (\"F\" or \"C\") is required when cook_temp is given.");
  }
  return {
    title: input.title,
    description: input.description ? input.description : null,
    servings: input.servings ?? null,
    prep_time_minutes: input.prep_time_minutes ?? null,
    cook_time_minutes: input.cook_time_minutes ?? null,
    cook_temp: cookTemp,
    cook_temp_unit: cookTemp === null ? null : unit,
    difficulty: input.difficulty ?? null,
    ingredients: input.ingredients,
    instructions: input.instructions.map(stripStepNumber),
    tags: cleanTags(input.tags),
  };
}

/** Only the columns the caller supplied; undefined means "leave unchanged". */
export function toRecipePatch(input: UpdateRecipeInput, current: RecipeContent): Partial<RecipeContent> {
  const patch: Partial<RecipeContent> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ? input.description : null;
  if (input.servings !== undefined) patch.servings = input.servings;
  if (input.prep_time_minutes !== undefined) patch.prep_time_minutes = input.prep_time_minutes;
  if (input.cook_time_minutes !== undefined) patch.cook_time_minutes = input.cook_time_minutes;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.ingredients !== undefined) patch.ingredients = input.ingredients;
  if (input.instructions !== undefined) patch.instructions = input.instructions.map(stripStepNumber);
  if (input.tags !== undefined) patch.tags = cleanTags(input.tags);

  if (input.cook_temp !== undefined || input.cook_temp_unit !== undefined) {
    const temp = input.cook_temp !== undefined ? input.cook_temp : current.cook_temp;
    const unit = input.cook_temp_unit !== undefined ? input.cook_temp_unit : current.cook_temp_unit;
    if (temp !== null && temp !== undefined && (unit === null || unit === undefined)) {
      throw new RecipeInputError("cook_temp_unit (\"F\" or \"C\") is required when cook_temp is set.");
    }
    patch.cook_temp = temp ?? null;
    patch.cook_temp_unit = temp === null || temp === undefined ? null : unit ?? null;
  }

  if (Object.keys(patch).length === 0) {
    throw new RecipeInputError("Nothing to update: pass at least one field to change.");
  }
  return patch;
}

// ------------------------------------------------------------ fingerprint

const squash = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Fingerprint of a recipe's content. The same recipe saved twice (a network
 * retry, or the assistant calling the tool again) gets the same key, and
 * the per-user unique constraint turns the second save into a no-op.
 * Whitespace and letter case in the title don't count as differences.
 */
export async function importKeyFor(content: RecipeContent): Promise<string> {
  const canonical = JSON.stringify([
    squash(content.title).toLowerCase(),
    content.description ? squash(content.description) : null,
    content.servings,
    content.prep_time_minutes,
    content.cook_time_minutes,
    content.cook_temp,
    content.cook_temp_unit,
    content.difficulty,
    content.ingredients.map(squash),
    content.instructions.map(squash),
    content.tags.map((t) => squash(t).toLowerCase()),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return IMPORT_KEY_PREFIX + hex;
}

// ---------------------------------------------------------------- storage

const RECIPE_COLUMNS =
  "id, user_id, title, description, servings, prep_time_minutes, cook_time_minutes, " +
  "cook_temp, cook_temp_unit, difficulty, ingredients, instructions, tags, is_public, " +
  "source, created_at, updated_at";

export interface StoredRecipe extends RecipeContent {
  id: string;
  is_public: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface RecipeRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  cook_temp: number | null;
  cook_temp_unit: string | null;
  difficulty: string | null;
  ingredients: unknown;
  instructions: unknown;
  tags: string[] | null;
  is_public: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function toStored(row: RecipeRow): StoredRecipe {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prep_time_minutes: row.prep_time_minutes,
    cook_time_minutes: row.cook_time_minutes,
    cook_temp: row.cook_temp,
    cook_temp_unit: row.cook_temp_unit === "F" || row.cook_temp_unit === "C" ? row.cook_temp_unit : null,
    difficulty: row.difficulty === "easy" || row.difficulty === "medium" || row.difficulty === "hard"
      ? row.difficulty
      : null,
    ingredients: stringList(row.ingredients),
    instructions: stringList(row.instructions),
    tags: row.tags ?? [],
    is_public: row.is_public,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** A failure the assistant can act on (shown to it); anything else is logged and reported generically. */
export class RecipeToolError extends Error {}

/** Database errors are logged here and replaced with a generic message, so internals never reach the client. */
function storageFailure(op: string, error: { code?: string; message?: string }): RecipeToolError {
  console.error(JSON.stringify({ event: "recipe_storage_error", op, code: error.code, message: error.message }));
  return new RecipeToolError("Afiyeat could not complete that request. Please try again in a moment.");
}

export interface RecipeStore {
  client: SupabaseClient;
  userId: string;
}

async function readOwn(store: RecipeStore, id: string): Promise<StoredRecipe | null> {
  const { data, error } = await store.client
    .from("recipes")
    .select(RECIPE_COLUMNS)
    .eq("id", id)
    .eq("user_id", store.userId)
    .maybeSingle();
  if (error) throw storageFailure("read", error);
  return data ? toStored(data as unknown as RecipeRow) : null;
}

async function readByImportKey(store: RecipeStore, key: string): Promise<StoredRecipe | null> {
  const { data, error } = await store.client
    .from("recipes")
    .select(RECIPE_COLUMNS)
    .eq("user_id", store.userId)
    .eq("import_key", key)
    .maybeSingle();
  if (error) throw storageFailure("read_import_key", error);
  return data ? toStored(data as unknown as RecipeRow) : null;
}

const CONTENT_KEYS: (keyof RecipeContent)[] = [
  "title",
  "description",
  "servings",
  "prep_time_minutes",
  "cook_time_minutes",
  "cook_temp",
  "cook_temp_unit",
  "difficulty",
  "ingredients",
  "instructions",
  "tags",
];

/** Fields whose stored value differs from what was written. */
export function contentMismatches(expected: Partial<RecipeContent>, stored: RecipeContent): string[] {
  return CONTENT_KEYS.filter(
    (k) => k in expected && JSON.stringify(expected[k]) !== JSON.stringify(stored[k]),
  );
}

/** Re-reads the row in a fresh query and checks every written field came back exactly. */
async function verifyReadback(
  store: RecipeStore,
  id: string,
  expected: Partial<RecipeContent>,
  op: string,
): Promise<StoredRecipe> {
  const stored = await readOwn(store, id);
  if (!stored) {
    throw storageFailure(`${op}_readback_missing`, { message: `recipe ${id} not readable after ${op}` });
  }
  const mismatched = contentMismatches(expected, stored);
  if (mismatched.length > 0) {
    throw storageFailure(`${op}_readback_mismatch`, { message: `fields differ: ${mismatched.join(", ")}` });
  }
  return stored;
}

export interface CreateResult {
  recipe: StoredRecipe;
  alreadySaved: boolean;
}

export async function createRecipe(store: RecipeStore, input: CreateRecipeInput): Promise<CreateResult> {
  const content = toRecipeContent(input);
  const importKey = await importKeyFor(content);

  // Saved before (a retry, or the same recipe sent twice): return that row.
  const existing = await readByImportKey(store, importKey);
  if (existing) return { recipe: existing, alreadySaved: true };

  const { data, error } = await store.client
    .from("recipes")
    .insert({
      ...content,
      // The caller's own id, taken from the verified token, never from input.
      user_id: store.userId,
      // Saved privately. Only the owner can make it public, in the app,
      // where the content filter runs on publish.
      is_public: false,
      image_url: null,
      source: RECIPE_SOURCE,
      import_key: importKey,
    })
    .select("id")
    .single();

  if (error) {
    // Two identical saves raced; the other one won. Return its row.
    if (error.code === "23505") {
      const winner = await readByImportKey(store, importKey);
      if (winner) return { recipe: winner, alreadySaved: true };
    }
    throw storageFailure("insert", error);
  }

  const recipe = await verifyReadback(store, (data as { id: string }).id, content, "insert");
  if (recipe.is_public) {
    throw storageFailure("insert_visibility", { message: `recipe ${recipe.id} stored as public` });
  }
  return { recipe, alreadySaved: false };
}

export async function getRecipe(store: RecipeStore, id: string): Promise<StoredRecipe> {
  const recipe = await readOwn(store, id);
  if (!recipe) throw new RecipeToolError("No recipe with that ID in this Afiyeat account.");
  return recipe;
}

export async function updateRecipe(store: RecipeStore, input: UpdateRecipeInput): Promise<StoredRecipe> {
  const current = await getRecipe(store, input.recipe_id);
  const patch = toRecipePatch(input, current);

  const { data, error } = await store.client
    .from("recipes")
    .update(patch)
    .eq("id", input.recipe_id)
    .eq("user_id", store.userId)
    .select("id")
    .maybeSingle();
  if (error) throw storageFailure("update", error);
  if (!data) throw new RecipeToolError("No recipe with that ID in this Afiyeat account.");

  return verifyReadback(store, input.recipe_id, patch, "update");
}

export interface RecipeSummary {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  tags: string[];
  is_public: boolean;
  saved_from_chatgpt: boolean;
  created_at: string;
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listRecipes(
  store: RecipeStore,
  input: ListRecipesInput,
): Promise<{ recipes: RecipeSummary[]; total: number; has_more: boolean }> {
  let query = store.client
    .from("recipes")
    .select(RECIPE_COLUMNS, { count: "exact" })
    .eq("user_id", store.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);
  if (input.query) query = query.ilike("title", likePattern(input.query));
  if (input.only_from_chatgpt) query = query.eq("source", RECIPE_SOURCE);

  const { data, error, count } = await query;
  if (error) throw storageFailure("list", error);

  const recipes = ((data ?? []) as unknown as RecipeRow[]).map(toStored).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description && r.description.length > 200 ? `${r.description.slice(0, 197)}...` : r.description,
    servings: r.servings,
    prep_time_minutes: r.prep_time_minutes,
    cook_time_minutes: r.cook_time_minutes,
    tags: r.tags,
    is_public: r.is_public,
    saved_from_chatgpt: r.source === RECIPE_SOURCE,
    created_at: r.created_at,
  }));
  const total = count ?? recipes.length;
  return { recipes, total, has_more: input.offset + recipes.length < total };
}
