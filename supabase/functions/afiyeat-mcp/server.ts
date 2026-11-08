// The MCP tools afiyeat-mcp exposes. A fresh server is built per request for
// the signed-in caller, so every tool runs as that user.

import { McpServer, z } from "./deps.ts";
import {
  createRecipe,
  createRecipeInput,
  getRecipe,
  getRecipeInput,
  listRecipes,
  listRecipesInput,
  RecipeInputError,
  type RecipeStore,
  RecipeToolError,
  type StoredRecipe,
  updateRecipe,
  updateRecipeInput,
} from "./recipes.ts";

export const SERVER_NAME = "afiyeat";
export const SERVER_VERSION = "1.0.0";
export const WHERE_TO_FIND = "Afiyeat app → Foodie tab → Recipes → My Recipes";

const INSTRUCTIONS = `Afiyeat is the user's personal food app. These tools read and write recipes in the user's own Afiyeat account.

Saving rules:
- Call create_recipe only when the user explicitly asks to save a finished recipe to Afiyeat. Never save on your own initiative.
- Never save brainstorming, partial ideas, recipe options the user has not picked, or recipes from earlier in the conversation unless the user names that specific recipe and asks to save it.
- If it is unclear which recipe or which version the user wants saved, ask first.
- Saved recipes are private. Only the user can make one public, from the Afiyeat app.
- After saving, tell the user the recipe title and that it is in ${WHERE_TO_FIND}.
- To change a recipe that is already saved, use update_recipe with its recipe_id instead of saving a new copy.`;

const OAUTH = { securitySchemes: [{ type: "oauth2" }] };

const recipeOutput = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  prep_time_minutes: z.number().nullable(),
  cook_time_minutes: z.number().nullable(),
  cook_temp: z.number().nullable(),
  cook_temp_unit: z.string().nullable(),
  difficulty: z.string().nullable(),
  ingredients: z.array(z.string()),
  instructions: z.array(z.string()),
  tags: z.array(z.string()),
  is_public: z.boolean(),
  saved_from_chatgpt: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

function present(recipe: StoredRecipe): z.infer<typeof recipeOutput> {
  const { source, ...rest } = recipe;
  return { ...rest, saved_from_chatgpt: source === "chatgpt" };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** Turns expected failures into a tool error the assistant can read; anything else is logged. */
async function guarded(tool: string, store: RecipeStore, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    const result = await run();
    console.log(JSON.stringify({ event: "tool_ok", tool, user: store.userId.slice(0, 8) }));
    return result;
  } catch (error) {
    const known = error instanceof RecipeToolError || error instanceof RecipeInputError;
    console.log(JSON.stringify({ event: "tool_error", tool, user: store.userId.slice(0, 8), known }));
    if (!known) console.error(error);
    const message = known
      ? (error as Error).message
      : "Afiyeat could not complete that request. Please try again in a moment.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function buildServer(store: RecipeStore): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "Afiyeat" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "create_recipe",
    {
      title: "Save recipe to Afiyeat",
      description:
        "Save one finished recipe to the user's Afiyeat account, privately, where it appears under My Recipes. " +
        "Only call this when the user has explicitly asked to save this specific, finalized recipe. Do not use it for " +
        "brainstorming, drafts, partial ideas or recipes the user has not asked to save. Saving the same recipe again " +
        "returns the copy already saved instead of creating a duplicate.",
      inputSchema: createRecipeInput,
      outputSchema: z.object({
        recipe_id: z.string(),
        status: z.enum(["created", "already_saved"]),
        where_to_find: z.string(),
        recipe: recipeOutput,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: OAUTH,
    },
    (input) =>
      guarded("create_recipe", store, async () => {
        const { recipe, alreadySaved } = await createRecipe(store, input);
        const status = alreadySaved ? "already_saved" : "created";
        const text = alreadySaved
          ? `"${recipe.title}" was already saved to Afiyeat (recipe ID ${recipe.id}). No duplicate was created. ` +
            `It is in ${WHERE_TO_FIND}.`
          : `Saved "${recipe.title}" to Afiyeat as a private recipe (recipe ID ${recipe.id}). ` +
            `It is in ${WHERE_TO_FIND}.`;
        return ok(text, { recipe_id: recipe.id, status, where_to_find: WHERE_TO_FIND, recipe: present(recipe) });
      }),
  );

  server.registerTool(
    "list_my_recipes",
    {
      title: "List my Afiyeat recipes",
      description:
        "List recipes in the user's own Afiyeat account, newest first. Optionally filter by text in the title " +
        "or to recipes saved from ChatGPT. Returns summaries; use get_recipe for full ingredients and steps.",
      inputSchema: listRecipesInput,
      outputSchema: z.object({
        recipes: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            servings: z.number().nullable(),
            prep_time_minutes: z.number().nullable(),
            cook_time_minutes: z.number().nullable(),
            tags: z.array(z.string()),
            is_public: z.boolean(),
            saved_from_chatgpt: z.boolean(),
            created_at: z.string(),
          }),
        ),
        total: z.number(),
        has_more: z.boolean(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: OAUTH,
    },
    (input) =>
      guarded("list_my_recipes", store, async () => {
        const result = await listRecipes(store, input);
        const lines = result.recipes.map((r) => `- ${r.title} (ID ${r.id})${r.is_public ? " [public]" : ""}`);
        const text = result.recipes.length === 0
          ? "No recipes found in this Afiyeat account."
          : `${result.total} recipe(s) in Afiyeat${result.has_more ? `; showing ${result.recipes.length}` : ""}:\n` +
            lines.join("\n");
        return ok(text, result);
      }),
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get an Afiyeat recipe",
      description: "Get the full details of one of the user's own Afiyeat recipes by its recipe_id.",
      inputSchema: getRecipeInput,
      outputSchema: z.object({ recipe: recipeOutput }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: OAUTH,
    },
    ({ recipe_id }) =>
      guarded("get_recipe", store, async () => {
        const recipe = await getRecipe(store, recipe_id);
        const text = [
          `${recipe.title} (ID ${recipe.id}, ${recipe.is_public ? "public" : "private"})`,
          recipe.description ?? "",
          `Ingredients:\n${recipe.ingredients.map((i) => `- ${i}`).join("\n")}`,
          `Steps:\n${recipe.instructions.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
        ].filter(Boolean).join("\n\n");
        return ok(text, { recipe: present(recipe) });
      }),
  );

  server.registerTool(
    "update_recipe",
    {
      title: "Update an Afiyeat recipe",
      description:
        "Change fields of one of the user's own Afiyeat recipes. Only call this when the user explicitly asks to " +
        "change a recipe that is already saved. Fields you leave out stay as they are; ingredients, instructions " +
        "and tags replace the whole list. Visibility cannot be changed here; the user does that in the app.",
      inputSchema: updateRecipeInput,
      outputSchema: z.object({ recipe_id: z.string(), recipe: recipeOutput }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      _meta: OAUTH,
    },
    (input) =>
      guarded("update_recipe", store, async () => {
        const recipe = await updateRecipe(store, input);
        return ok(`Updated "${recipe.title}" in Afiyeat (recipe ID ${recipe.id}).`, {
          recipe_id: recipe.id,
          recipe: present(recipe),
        });
      }),
  );

  return server;
}
