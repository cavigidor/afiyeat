// Lists V2: create a list from a preset in one go, with the columns and tables that already exist.
//
// Three writes (list, statuses, categories) from the client, as list creation has always been. To
// keep them safe:
//   - the list id is generated here, so a retried tap or a lost response can never create a second
//     list: a repeat insert of the same id is recognised and treated as already created;
//   - statuses are required (a list without them can't hold items): one retry, then the half-made
//     list is removed again and the error reported;
//   - categories are optional: one retry, then the list is kept and the caller is told which part
//     is missing, so it can say so instead of claiming everything worked;
//   - the preset's item fields (owner-only) are optional too: one retry, then the list is kept and the
//     caller is told, so it can offer to try again. Where the tables don't exist yet (production today)
//     they are skipped silently and the list is made exactly as before.
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import { DEFAULT_LIST_VISIBILITY, type ListVisibility } from '@/lib/listVisibility';
import type { ListPresetDef } from '@/lib/listPresets';
import { mergePresetFields } from '@/lib/presetFields';
import { saveListFields } from '@/lib/itemDetails';

/** saved; none (preset has no fields); unavailable (tables not there: silent); failed (tell the person). */
export type FieldsOutcome = 'saved' | 'none' | 'unavailable' | 'failed';

/**
 * What the person kept selected on the New list sheet. Every part is optional; anything left out uses the
 * preset's default, so creating without touching anything is exactly the old behaviour.
 */
export interface PresetSelection {
  /** Statuses to create, in the preset's order. At least one. */
  statuses?: string[];
  /** Preset categories to create (by name). */
  categories?: string[];
  /**
   * Categories to create instead, only if the item fields couldn't be saved (failed or unavailable).
   * Coffee Beans: its roast categories, and only while the Roast field is selected.
   */
  categoriesIfNoFields?: string[];
  /** Preset item fields to save (keys). Deselected ones are never saved, here or on a retry. */
  fieldKeys?: string[];
  /** Which built-in fields the list tracks. */
  tracks?: Partial<Pick<ListPresetDef['config'], 'show_location' | 'show_price' | 'show_rating' | 'show_notes' | 'show_photos'>>;
}

export type CreateListResult =
  | { status: 'created'; id: string; categoriesMissing: boolean; fields: FieldsOutcome; categoryNames: string[] }
  | { status: 'error'; error: unknown };

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

async function insertOnce<T>(write: () => PromiseLike<{ error: T | null }>): Promise<T | null> {
  let { error } = await write();
  if (error) ({ error } = await write());
  return error;
}

export async function createListFromPreset(
  userId: string,
  preset: ListPresetDef,
  name: string,
  options: { visibility?: ListVisibility; id?: string; extraCategories?: string[]; selection?: PresetSelection } = {},
): Promise<CreateListResult> {
  const id = options.id ?? newId();
  const sel = options.selection ?? {};
  const statuses = sel.statuses ? preset.statuses.filter((s) => sel.statuses!.includes(s)) : preset.statuses;
  if (statuses.length === 0) return { status: 'error', error: new Error('A list needs at least one status') };
  const visibility = options.visibility ?? preset.visibility ?? DEFAULT_LIST_VISIBILITY;
  const row = {
    id, user_id: userId, name: name.trim(), icon: preset.icon, color: preset.color, visibility,
    ...preset.config,
    ...(sel.tracks ?? {}),
  };

  // 1. The list. A duplicate-key answer for our own id means an earlier attempt already made it.
  const { error: listError } = await supabase.from('custom_lists').insert(row as TablesInsert<'custom_lists'>);
  if (listError) {
    const code = (listError as { code?: string }).code;
    if (code !== '23505') return { status: 'error', error: listError };
    const { data: existing } = await supabase.from('custom_lists').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!existing) return { status: 'error', error: listError };
  }

  // 2. Statuses (required). Skipped if this list already has them (a retried call).
  const { data: haveStatuses } = await supabase.from('custom_list_statuses').select('id').eq('list_id', id).limit(1);
  if (!haveStatuses?.length) {
    const statusRows = statuses.map((s, i) => ({ list_id: id, user_id: userId, name: s, sort_order: i }));
    const statusError = await insertOnce(() => supabase.from('custom_list_statuses').insert(statusRows));
    if (statusError) {
      await supabase.from('custom_lists').delete().eq('id', id).eq('user_id', userId);
      return { status: 'error', error: statusError };
    }
  }

  // 3. Item fields (optional; owner-only). Saving the same definitions again on a retry is harmless.
  const fields = await savePresetFields(userId, id, preset, [], sel.fieldKeys);
  const fieldsSaved = fields === 'saved';

  // 4. Categories (optional). Not the ones an item field now stands for.
  const picked = (names: string[]) => preset.categories.filter((c) => names.includes(c.name));
  const presetCategories = options.selection
    ? picked(fieldsSaved || fields === 'none' || !sel.categoriesIfNoFields ? sel.categories ?? preset.categories.map((c) => c.name) : sel.categoriesIfNoFields)
    : preset.fieldsReplaceCategories && fieldsSaved ? [] : preset.categories;
  const categories = [
    ...presetCategories,
    ...(options.extraCategories ?? []).map((c) => c.trim()).filter(Boolean).map((c) => ({ name: c, color: preset.color, icon: undefined })),
  ];
  let categoriesMissing = false;
  if (categories.length) {
    const { data: haveTypes } = await supabase.from('custom_list_types').select('id').eq('list_id', id).limit(1);
    if (!haveTypes?.length) {
      const typeRows = categories.map((c, i) => ({ list_id: id, user_id: userId, name: c.name, color: c.color, icon: c.icon ?? null, sort_order: i }));
      categoriesMissing = !!(await insertOnce(() => supabase.from('custom_list_types').insert(typeRows)));
    }
  }
  return { status: 'created', id, categoriesMissing, fields, categoryNames: categoriesMissing ? [] : categories.map((c) => c.name) };
}

/**
 * Save a preset's field definitions for a list: one retry; a missing table is "unavailable", not a failure.
 * `categoryNames`: the list's categories, so a later retry on a Coffee Beans list that fell back to roast
 * categories adds the Roast field hidden (one roast control, not two).
 * `fieldKeys`: only these of the preset's fields (what was kept selected); all of them when omitted.
 */
export async function savePresetFields(
  userId: string, listId: string, preset: Pick<ListPresetDef, 'key'>, categoryNames: string[] = [], fieldKeys?: string[],
): Promise<FieldsOutcome> {
  const defs = mergePresetFields([], preset.key, categoryNames).filter((f) => !fieldKeys || fieldKeys.includes(f.key));
  if (defs.length === 0) return 'none';
  let res = await saveListFields(userId, listId, defs);
  if (!res.ok && !res.missing) res = await saveListFields(userId, listId, defs);
  if (res.ok) return 'saved';
  return res.missing ? 'unavailable' : 'failed';
}
