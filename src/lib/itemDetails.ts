// Lists V2: reading and saving an item's preset fields (owner-only; see src/lib/presetFields.ts and
// db/proposals/lists_v2_owner_fields.sql).
//
// The two tables don't exist in production yet. Every read here treats "table not found" as "details aren't
// available": the app then behaves exactly as before, and nothing tries to write them. Values are never put
// into Notes or any other existing column.
import { supabase } from '@/integrations/supabase/client';
import type { FieldDef } from '@/lib/presetFields';
import { uiOf } from '@/lib/presetFields';

export type FieldValue = string | number | string[];
export type ItemValues = Record<string, FieldValue>;

// The generated Supabase types don't know these tables until they exist, so they're reached untyped.
type Result<T> = { data: T | null; error: { code?: string; message?: string } | null; status?: number };
type Untyped = {
  from: (table: string) => {
    select: (cols: string) => { eq: (c: string, v: string) => PromiseLike<Result<unknown[]>> & { maybeSingle: () => PromiseLike<Result<unknown>> } };
    upsert: (row: unknown, opts?: { onConflict?: string }) => PromiseLike<Result<unknown>>;
    delete: () => { eq: (c: string, v: string) => PromiseLike<Result<unknown>> };
  };
};
const db = () => supabase as unknown as Untyped;

const SETTINGS = 'custom_list_owner_settings';
const VALUES = 'custom_list_item_owner_values';

/** PostgREST's "no such table" (PGRST205), Postgres's (42P01), or a 404 for the table: the feature isn't there. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined, status?: number): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || status === 404 || /could not find the table|does not exist/i.test(error.message ?? '');
}

export interface ListFieldsState {
  /** False when the tables aren't there (today's production): show no details UI at all. */
  available: boolean;
  /** Null when the list has no field definitions yet. */
  fields: FieldDef[] | null;
}

export async function fetchListFields(listId: string): Promise<ListFieldsState> {
  const res = await db().from(SETTINGS).select('fields').eq('list_id', listId).maybeSingle();
  if (res.error) {
    if (isMissingTable(res.error, res.status)) return { available: false, fields: null };
    throw res.error;
  }
  const row = res.data as { fields?: FieldDef[] } | null;
  return { available: true, fields: row?.fields ?? null };
}

/** Whether item details exist on this backend at all (they don't in production until approved). */
export async function detailsAvailable(): Promise<boolean> {
  try {
    return (await fetchListFields('00000000-0000-0000-0000-000000000000')).available;
  } catch {
    return false;
  }
}

/** item id -> values, for one list. Empty when unavailable. */
export async function fetchListValues(listId: string): Promise<Record<string, ItemValues>> {
  const res = await db().from(VALUES).select('item_id, values').eq('list_id', listId);
  if (res.error) {
    if (isMissingTable(res.error, res.status)) return {};
    throw res.error;
  }
  return Object.fromEntries(((res.data ?? []) as { item_id: string; values: ItemValues }[]).map((r) => [r.item_id, r.values ?? {}]));
}

/** Save the list's field definitions (whole array; the database refuses edits that would strand values). */
export async function saveListFields(userId: string, listId: string, fields: FieldDef[]) {
  const res = await db().from(SETTINGS).upsert({ list_id: listId, user_id: userId, fields }, { onConflict: 'list_id' });
  return { ok: !res.error, missing: isMissingTable(res.error, res.status), error: res.error };
}

/**
 * Save one item's values. Empty fields are dropped, so clearing a field removes it. An item that never had
 * details and still has none gets no row at all.
 */
export async function saveItemValues(userId: string, listId: string, itemId: string, values: ItemValues, hadRow: boolean) {
  const clean = compactValues(values);
  if (!hadRow && Object.keys(clean).length === 0) return { ok: true as const };
  const res = await db().from(VALUES).upsert({ item_id: itemId, list_id: listId, user_id: userId, values: clean }, { onConflict: 'item_id' });
  return res.error ? { ok: false as const, error: res.error } : { ok: true as const };
}

/** Drop empty strings, empty lists and unset numbers. */
export function compactValues(values: ItemValues): ItemValues {
  const out: ItemValues = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/**
 * The same checks the database makes (lv2_value_fits), plus each field's sensible range, so a mistake is
 * shown next to the field instead of failing the save. Returns field key -> message.
 */
export function validateValues(fields: FieldDef[], values: ItemValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, v] of Object.entries(compactValues(values))) {
    const f = byKey.get(key);
    if (!f) continue;
    const ui = uiOf(f);
    switch (f.type) {
      case 'text':
        if (typeof v !== 'string' || v.length > 2000) errors[key] = 'Too long';
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors[key] = 'Enter a number';
        else if (ui.integer && !Number.isInteger(v)) errors[key] = 'Enter a whole number';
        else if ((ui.min != null && v < ui.min) || (ui.max != null && v > ui.max)) errors[key] = `Between ${ui.min} and ${ui.max}`;
        break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))
          || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) errors[key] = 'Pick a date';
        break;
      case 'tags':
        if (!Array.isArray(v) || v.length > 30 || v.some((t) => typeof t !== 'string' || t.trim().length < 1 || t.length > 60)) errors[key] = 'Up to 30 tags of 60 characters';
        break;
      case 'choice':
        if (typeof v !== 'string' || !f.options?.includes(v)) errors[key] = 'Pick one of the options';
        break;
      case 'multi':
        if (!Array.isArray(v) || v.some((x) => !f.options?.includes(x as string)) || new Set(v).size !== v.length) errors[key] = 'Pick from the options';
        break;
    }
  }
  return errors;
}

/** How a saved value reads on the item page and in the list row. */
export function formatValue(def: FieldDef, value: FieldValue | undefined): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  if (def.type === 'date' && typeof value === 'string') {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const unit = uiOf(def).unit;
  const text = String(value).trim();
  if (!text) return null;
  return unit ? `${text}${unit === '%' ? '%' : ` ${unit}`}` : text;
}

/** A short line for the list row: the first two filled main fields, e.g. "Tide Roasters · Light". */
export function detailSummary(fields: FieldDef[] | null | undefined, values: ItemValues | undefined): string {
  if (!fields || !values) return '';
  return fields
    .filter((f) => !f.hidden && uiOf(f).tier === 'main')
    .map((f) => formatValue(f, values[f.key]))
    .filter((s): s is string => !!s)
    .slice(0, 2)
    .join(' · ');
}

// --- Unsaved details kept on this device -------------------------------------------------------------
// If an item saves but its details don't, what was typed is kept here until it saves, so closing the
// editor (or the app) never loses it. Only on this device, only for the signed-in owner's own items.
const draftKey = (itemId: string) => `afiyeat-details-draft:${itemId}`;

export function saveDetailsDraft(itemId: string, values: ItemValues) {
  try { localStorage.setItem(draftKey(itemId), JSON.stringify(values)); } catch { /* storage unavailable */ }
}

export function readDetailsDraft(itemId: string): ItemValues | null {
  try {
    const raw = localStorage.getItem(draftKey(itemId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ItemValues) : null;
  } catch {
    return null;
  }
}

export function clearDetailsDraft(itemId: string) {
  try { localStorage.removeItem(draftKey(itemId)); } catch { /* storage unavailable */ }
}

