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
//   - the preset's item fields (owner-only) are optional too, and skipped silently where the tables
//     don't exist yet. A failure leaves a normal list; fields can be added later from Customize.
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import { DEFAULT_LIST_VISIBILITY, type ListVisibility } from '@/lib/listVisibility';
import type { ListPresetDef } from '@/lib/listPresets';
import { fieldsForPreset } from '@/lib/presetFields';
import { saveListFields } from '@/lib/itemDetails';

export type CreateListResult =
  | { status: 'created'; id: string; categoriesMissing: boolean; fieldsSaved: boolean }
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
  options: { visibility?: ListVisibility; id?: string; extraCategories?: string[] } = {},
): Promise<CreateListResult> {
  const id = options.id ?? newId();
  const visibility = options.visibility ?? preset.visibility ?? DEFAULT_LIST_VISIBILITY;
  const row = {
    id, user_id: userId, name: name.trim(), icon: preset.icon, color: preset.color, visibility,
    ...preset.config,
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
    const statusRows = preset.statuses.map((s, i) => ({ list_id: id, user_id: userId, name: s, sort_order: i }));
    const statusError = await insertOnce(() => supabase.from('custom_list_statuses').insert(statusRows));
    if (statusError) {
      await supabase.from('custom_lists').delete().eq('id', id).eq('user_id', userId);
      return { status: 'error', error: statusError };
    }
  }

  // 3. Item fields (optional; owner-only). Saving the same definitions again on a retry is harmless.
  const defs = fieldsForPreset(preset.key);
  const fieldsSaved = defs.length > 0 && (await saveListFields(userId, id, defs)).ok;

  // 4. Categories (optional). Not the ones an item field now stands for.
  const categories = [
    ...(preset.fieldsReplaceCategories && fieldsSaved ? [] : preset.categories),
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
  return { status: 'created', id, categoriesMissing, fieldsSaved };
}
