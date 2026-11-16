import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronLeft, Lock, Users, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { useMyShareIdentity } from '@/hooks/useMyShareIdentity';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { createListFromPreset } from '@/lib/listCreate';
import { MORE_PRESETS, V2_PRESETS, type ListPresetDef } from '@/lib/listPresets';
import { visibilityChip } from '@/lib/listVisibility';
import { hapticSuccess } from '@/lib/haptics';
import { ListGlyph } from './ListGlyph';
import { cn } from '@/lib/utils';

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

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return base;
}

/**
 * New list in three taps: open, pick a starting point, Create. The name is filled in and selected, so
 * typing replaces it; nothing else is required. Everything stays editable from the list afterwards.
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
  // One id per attempt at creating this list, kept across retries so a lost answer can't make two.
  const attemptId = useRef(newId());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPreset(null); setName(''); setShowMore(false); setSaving(false); setFailed(false);
    }
  }, [open]);

  const choose = (p: ListPresetDef) => {
    attemptId.current = newId();
    setPreset(p);
    setFailed(false);
    setName(uniqueName(p.suggestedName, existingNames));
    // Focus once the step has rendered; selecting all means typing replaces the suggestion.
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  };

  const audience = useMemo(() => {
    const v = preset?.visibility ?? 'profile';
    return { private: v === 'private', label: visibilityChip(v, identity.isPrivate).label };
  }, [preset, identity.isPrivate]);

  const create = async () => {
    if (!user || !preset || saving) return;
    if (!name.trim()) { inputRef.current?.focus(); return; }
    if (blockedByContentFilter(name)) return;
    setSaving(true);
    setFailed(false);
    const result = await createListFromPreset(user.id, preset, name, { id: attemptId.current });
    setSaving(false);
    if (result.status === 'error') {
      setFailed(true);
      return;
    }
    void hapticSuccess();
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user.id] });
    if (result.categoriesMissing) toast.warning("List created, but its categories didn't save. Add them from Customize.");
    else toast.success(`${name.trim()} created`);
    onOpenChange(false);
    navigate(`/my-lists/${result.id}`);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl px-4 pt-3 sm:mx-auto sm:max-w-lg"
        showCloseButton={false}
        // Don't land focus (and a focus ring) on the first preset; the name step focuses its own input.
        onOpenAutoFocus={(e) => e.preventDefault()}
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
                  <span className="block truncate text-xs text-muted-foreground">Movies, Shows, Books, Concerts, Wines, Beers</span>
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
                <SheetDescription className="truncate text-sm">{preset.summary}</SheetDescription>
              </div>
            </div>
            <label htmlFor="new-list-name" className="mt-4 block text-sm font-medium text-muted-foreground">List name</label>
            <Input
              id="new-list-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              enterKeyHint="done"
              autoComplete="off"
              className="mt-1.5 h-12 rounded-xl text-base"
            />
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              {audience.private ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <Users className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {audience.private
                  ? 'Starts as Only me. Change it any time from the list.'
                  : `${audience.label}, like your other lists. Change it any time from the list.`}
              </span>
            </p>
            {failed && (
              <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Couldn’t create the list. Check your connection and tap Create again — it won’t be made twice.
              </p>
            )}
            <Button type="submit" className="mt-4 h-12 w-full rounded-xl text-base font-semibold" disabled={saving || !name.trim()}>
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
