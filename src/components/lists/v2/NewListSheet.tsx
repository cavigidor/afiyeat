import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronLeft, Lock, Users, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { useMyShareIdentity } from '@/hooks/useMyShareIdentity';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { createListFromPreset, savePresetFields, type PresetSelection } from '@/lib/listCreate';
import { MORE_PRESETS, V2_PRESETS, type ListPresetDef } from '@/lib/listPresets';
import { visibilityChip } from '@/lib/listVisibility';
import { hapticSuccess } from '@/lib/haptics';
import { ListGlyph } from './ListGlyph';
import { cn } from '@/lib/utils';
import { detailsAvailable } from '@/lib/itemDetails';
import { FIELD_CATALOGUE, fieldsForPreset } from '@/lib/presetFields';

interface NewListSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names already used, so the suggested name doesn't repeat one. */
  existingNames: string[];
  /** "Blank list": the full settings dialog, for anyone who wants to set every field up front. */
  onBlankList: () => void;
  /** Shared lists are created elsewhere; this keeps them one tap away. */
  onSharedList: () => void;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-0000-4000-8000-000000000000`;

type Track = 'show_location' | 'show_price' | 'show_rating' | 'show_photos' | 'show_notes';
const TRACKS: Track[] = ['show_location', 'show_price', 'show_rating', 'show_photos', 'show_notes'];
/** The field an item detail replaces categories with (Coffee Beans: Roast instead of roast categories). */
const REPLACING_FIELD = 'c_roast';

/** What's selected on the create step. Starts as the preset's defaults. */
interface Picks { statuses: string[]; categories: string[]; fields: string[]; tracks: Record<Track, boolean> }
const defaultsOf = (p: ListPresetDef): Picks => ({
  statuses: [...p.statuses],
  categories: p.categories.map((c) => c.name),
  fields: fieldsForPreset(p.key).map((f) => f.key),
  tracks: Object.fromEntries(TRACKS.map((t) => [t, p.config[t]])) as Record<Track, boolean>,
});

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return base;
}

/**
 * New list in three taps: open, pick a starting point, Create. The name is filled in, so nothing else is
 * required. The keyboard opens only when the person taps the name field; nothing focuses it for them.
 * Everything stays editable from the list afterwards.
 */
export function NewListSheet({ open, onOpenChange, existingNames, onBlankList, onSharedList }: NewListSheetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const identity = useMyShareIdentity();
  const [preset, setPreset] = useState<ListPresetDef | null>(null);
  const [name, setName] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState<Picks | null>(null);
  // One id per attempt at creating this list, kept across retries so a lost answer can't make two.
  const attemptId = useRef(newId());
  // Keeps the sheet (and its Create button) above the keyboard when the name field is tapped.
  const keyboardInset = useKeyboardInset(open);
  const { data: withDetails = false } = useQuery({ queryKey: ['details-available'], queryFn: detailsAvailable, enabled: open, staleTime: 10 * 60_000 });

  useEffect(() => {
    if (!open) {
      setPreset(null); setName(''); setShowMore(false); setSaving(false); setFailed(false);
    }
  }, [open]);

  const choose = (p: ListPresetDef) => {
    attemptId.current = newId();
    setPreset(p);
    setPicks(defaultsOf(p));
    setFailed(false);
    setName(uniqueName(p.suggestedName, existingNames));
  };

  const audience = useMemo(() => {
    const v = preset?.visibility ?? 'profile';
    return { private: v === 'private', label: visibilityChip(v, identity.isPrivate).label };
  }, [preset, identity.isPrivate]);

  // Coffee Beans with item details: its roast categories are replaced by the Roast field and not offered.
  const categoriesReplaced = !!preset?.fieldsReplaceCategories && withDetails;
  const selection = (p: ListPresetDef, k: Picks): PresetSelection => {
    const fieldKeys = withDetails ? k.fields : [];
    return {
      statuses: k.statuses,
      categories: categoriesReplaced ? [] : k.categories,
      // Only if the fields can't be saved, and only while Roast is selected, fall back to roast categories.
      categoriesIfNoFields: categoriesReplaced ? (fieldKeys.includes(REPLACING_FIELD) ? p.categories.map((c) => c.name) : []) : undefined,
      fieldKeys,
      tracks: k.tracks,
    };
  };
  const toggle = (part: 'statuses' | 'categories' | 'fields', value: string) => setPicks((k) => {
    if (!k) return k;
    const list = k[part];
    return { ...k, [part]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
  });
  const toggleTrack = (t: Track) => setPicks((k) => (k ? { ...k, tracks: { ...k.tracks, [t]: !k.tracks[t] } } : k));
  const noStatus = !!picks && picks.statuses.length === 0;

  const create = async () => {
    if (!user || !preset || !picks || saving) return;
    if (!name.trim() || noStatus) return;
    if (blockedByContentFilter(name)) return;
    setSaving(true);
    setFailed(false);
    const sel = selection(preset, picks);
    const result = await createListFromPreset(user.id, preset, name, { id: attemptId.current, selection: sel });
    setSaving(false);
    if (result.status === 'error') {
      setFailed(true);
      return;
    }
    void hapticSuccess();
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user.id] });
    const listName = name.trim();
    if (result.fields === 'failed') {
      // The list is fine; only its item details (Roaster, Vintage...) aren't set up. Say so and offer a retry.
      const listId = result.id;
      const retry = async () => {
        // The list fell back to its plain categories (e.g. Coffee Beans roasts); keep them the only roast control.
        // Only the fields that were kept selected. If the list fell back to its roast categories, Roast is added
        // hidden so they stay the only roast control.
        const again = await savePresetFields(user.id, listId, preset, result.categoryNames, sel.fieldKeys);
        if (again === 'saved') {
          toast.success(`${preset.label} details added to ${listName}`);
          void queryClient.invalidateQueries({ queryKey: ['custom_list_fields', listId] });
        } else {
          toast.error(`Still couldn’t add them. Try later from Customize › Fields › Add ${preset.label} details.`);
        }
      };
      const firstField = fieldsForPreset(preset.key).find((f) => sel.fieldKeys?.includes(f.key))?.label ?? 'extra fields';
      toast.warning(`${listName} created, but its item details (like ${firstField}) didn’t save.`, {
        description: `Try again now, or later from Customize › Fields.${result.categoriesMissing ? ' Its categories didn’t save either; add them from Customize.' : ''}`,
        action: { label: 'Try again', onClick: () => void retry() },
        duration: 20000,
      });
    } else if (result.categoriesMissing) toast.warning("List created, but its categories didn't save. Add them from Customize.");
    else toast.success(`${listName} created`);
    onOpenChange(false);
    navigate(`/my-lists/${result.id}`);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl px-4 pt-3 sm:mx-auto sm:max-w-lg"
        showCloseButton={false}
        // Don't land focus (and a focus ring, or the keyboard) on anything when the sheet opens.
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={keyboardInset ? { bottom: keyboardInset, maxHeight: `calc(100dvh - ${keyboardInset}px)` } : undefined}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        {!preset ? (
          <div className="animate-in fade-in-0 duration-200">
            <SheetTitle className="text-2xl font-bold">New list</SheetTitle>
            <SheetDescription className="mt-1">Pick a starting point. Everything can be changed later.</SheetDescription>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {V2_PRESETS.map((p) => <PresetTile key={p.key} preset={p} onClick={() => choose(p)} />)}
            </div>
            <div className="mt-3 divide-y rounded-2xl border bg-card">
              <button type="button" aria-label="More presets" className="flex w-full items-center gap-3 px-4 py-3 text-left active-press" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">More presets</span>
                  <span className="block truncate text-xs text-muted-foreground">{MORE_PRESETS.map((p) => p.label).join(', ')}</span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', showMore && 'rotate-180')} />
              </button>
              {showMore && (
                <div className="grid grid-cols-2 gap-2.5 p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                  {MORE_PRESETS.map((p) => <PresetTile key={p.key} preset={p} compact onClick={() => choose(p)} />)}
                </div>
              )}
              <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left active-press" onClick={() => { onOpenChange(false); onSharedList(); }}>
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 font-medium">Shared list with a friend</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left active-press" onClick={() => { onOpenChange(false); onBlankList(); }}>
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 font-medium">Blank list</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        ) : (
          <form
            className="animate-in fade-in-0 slide-in-from-right-4 duration-200"
            onSubmit={(e) => { e.preventDefault(); void create(); }}
          >
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Back to presets" className="-ml-1 rounded-full p-1.5 active-press" onClick={() => setPreset(null)} disabled={saving}>
                <ChevronLeft className="h-5 w-5" />
              </button>
              <ListGlyph icon={preset.icon} color={preset.color} size="lg" />
              <div className="min-w-0">
                <SheetTitle className="truncate text-xl font-bold">{preset.label}</SheetTitle>
                <SheetDescription className="line-clamp-2 text-sm">{preset.hint}</SheetDescription>
              </div>
            </div>
            {picks && (
              <PresetDetails preset={preset} audience={audience} withDetails={withDetails} categoriesReplaced={categoriesReplaced}
                picks={picks} onToggle={toggle} onToggleTrack={toggleTrack} disabled={saving} />
            )}
            <label htmlFor="new-list-name" className="mt-4 block text-sm font-medium text-muted-foreground">List name</label>
            <Input
              id="new-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              enterKeyHint="done"
              autoComplete="off"
              className="mt-1.5 h-12 rounded-xl text-base"
            />
            {failed && (
              <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Couldn’t create the list. Check your connection and tap Create again — it won’t be made twice.
              </p>
            )}
            <Button type="submit" className="mt-4 h-12 w-full rounded-xl text-base font-semibold" disabled={saving || !name.trim() || noStatus}>
              {saving ? <><Spinner className="mr-2 h-4 w-4 animate-spin" />Creating…</> : failed ? 'Try again' : 'Create list'}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PresetTile({ preset, onClick, compact }: { preset: ListPresetDef; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={preset.label}
      className={cn(
        'flex min-w-0 rounded-2xl border bg-card text-left transition-colors hover:bg-accent/40 active-press',
        'flex-col items-start', compact ? 'gap-1.5 p-2.5' : 'gap-2 p-3',
      )}
    >
      <ListGlyph icon={preset.icon} color={preset.color} size={compact ? 'sm' : 'md'} />
      <span className="min-w-0 w-full">
        <span className="block truncate font-semibold leading-tight">{preset.label}</span>
        <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">{preset.hint}</span>
      </span>
    </button>
  );
}

/**
 * What the chosen preset sets up, shown right under its name so it stays in view above the keyboard. Every
 * chip is a toggle, starting from the preset's defaults; only what stays selected is created.
 */
function PresetDetails({ preset, audience, withDetails, categoriesReplaced, picks, onToggle, onToggleTrack, disabled }: {
  preset: ListPresetDef; audience: { private: boolean; label: string }; withDetails: boolean; categoriesReplaced: boolean;
  picks: Picks; onToggle: (part: 'statuses' | 'categories' | 'fields', value: string) => void; onToggleTrack: (t: Track) => void; disabled: boolean;
}) {
  const fields = withDetails ? fieldsForPreset(preset.key) : [];
  const showCategories = preset.categories.length > 0 && !categoriesReplaced;
  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-muted/50 p-3 text-sm" data-testid="preset-details">
      <ChipRow label="Statuses" disabled={disabled}
        items={preset.statuses.map((s) => ({ key: s, name: s, on: picks.statuses.includes(s) }))} onToggle={(k) => onToggle('statuses', k)} />
      {picks.statuses.length === 0 && (
        <p role="alert" className="pl-[5.5rem] text-xs font-medium text-destructive">Keep at least one status: every item needs one.</p>
      )}
      {showCategories && (
        <ChipRow label="Categories" disabled={disabled}
          items={preset.categories.map((c) => ({ key: c.name, name: c.name, icon: c.icon, on: picks.categories.includes(c.name) }))}
          onToggle={(k) => onToggle('categories', k)} />
      )}
      {fields.length > 0 && (
        <ChipRow label="Details" disabled={disabled}
          items={fields.map((f) => ({ key: f.key, name: FIELD_CATALOGUE[f.key]?.chipLabel ?? f.label, on: picks.fields.includes(f.key) }))}
          onToggle={(k) => onToggle('fields', k)} />
      )}
      <ChipRow label="Tracks" disabled={disabled}
        items={TRACKS.map((t) => ({ key: t, name: trackLabel(preset, t), on: picks.tracks[t] }))} onToggle={(k) => onToggleTrack(k as Track)} />
      <p className="flex items-start gap-2 text-muted-foreground">
        {audience.private ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <Users className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {audience.private
            ? 'Starts as Only me. Change it any time from the list.'
            : `${audience.label}, like your other lists. Change it any time from the list.`}
        </span>
      </p>
    </div>
  );
}

function trackLabel({ config: c }: ListPresetDef, t: Track): string {
  if (t === 'show_rating') return ({ stars_5: 'Stars', scale_10: 'Rating 1–10', manual: 'Rating' } as const)[c.rating_mode];
  return ({ show_location: 'Location', show_price: 'Price', show_photos: 'Photos', show_notes: 'Notes' } as const)[t];
}

/** A row of toggle chips: selected ones in the primary colour (like Create list), the rest white. */
function ChipRow({ label, items, onToggle, disabled }: {
  label: string; items: { key: string; name: string; icon?: string; on: boolean }[]; onToggle: (key: string) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-1.5 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label={label}>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            aria-pressed={i.on}
            disabled={disabled}
            onClick={() => onToggle(i.key)}
            className={cn(
              'min-h-[30px] rounded-full border px-2.5 py-1 text-xs transition-colors active-press disabled:opacity-60',
              i.on ? 'border-primary bg-primary font-medium text-primary-foreground' : 'border-border bg-background text-foreground',
            )}
          >
            {i.icon ? `${i.icon} ` : ''}{i.name}
          </button>
        ))}
      </div>
    </div>
  );
}
