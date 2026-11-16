import { useEffect, useRef, useState } from 'react';
import { MapPin, Plus, Search, CircleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePlaceAutocomplete, type ResolvedPlace } from '@/hooks/usePlaceAutocomplete';
import { saveCustomListItem } from '@/lib/listItemSave';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { hapticSuccess } from '@/lib/haptics';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { addPromptOf } from '@/lib/listPresets';
import { Chip } from './ListControls';
import { cn } from '@/lib/utils';

/** The always-visible bar at the bottom of a list: tap to add, plus the view switcher beside it. */
export function QuickAddBar({ list, onOpen, children }: { list: CustomList; onOpen: () => void; children?: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 z-40 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] md:bottom-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex items-center gap-2.5 px-4 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border bg-card px-4 text-left text-muted-foreground shadow-sm active-press"
        >
          <Plus className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate">{addPromptOf(list)}</span>
        </button>
        {children}
      </div>
    </div>
  );
}

type Phase = { kind: 'idle' } | { kind: 'saving'; key: string } | { kind: 'error'; message: string; retry: () => void };

interface QuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: CustomList;
  types: ManagedListType[];
  statuses: ManagedListStatus[];
  /** The status tab being looked at: a new item lands where the person is looking. */
  statusId: string | null;
  /** The category filter in use, preselected. */
  categoryId: string | null;
  onSaved: (itemId: string) => void;
  /** "Save and add details": open the full editor on the item just saved. */
  onSavedOpenDetails: (itemId: string) => void;
}

/**
 * Minimal-input add. Places: search and tap a result - that is the save (the list is already known).
 * Everything else: type a name, Save. Categories are optional chips. Feedback is explicit: the button
 * shows saving, success closes with an Undo toast, failure keeps what was typed and offers Try again.
 */
export function QuickAddSheet({ open, onOpenChange, list, types, statuses, statusId, categoryId, onSaved, onSavedOpenDetails }: QuickAddSheetProps) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const isPlaces = list.show_location;
  const status = statuses.find((s) => s.id === statusId) ?? statuses[0];

  const places = usePlaceAutocomplete({
    enabled: open && isPlaces,
    kind: 'any',
    onSelect: (place) => void savePlace(place),
  });

  useEffect(() => {
    if (open) {
      setName(''); setPhase({ kind: 'idle' }); places.resetSearch();
      setTypeIds(categoryId && types.some((t) => t.id === categoryId) ? [categoryId] : []);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = phase.kind === 'saving';

  async function save(item: { name: string; address: string; latitude: number | null; longitude: number | null; picked: { applePlaceId: string | null; appleAddress: string } | null }, key: string, then: 'close' | 'details') {
    if (!user || busy) return;
    if (!item.name.trim()) { inputRef.current?.focus(); return; }
    if (blockedByContentFilter(item.name)) return;
    if (!status) { setPhase({ kind: 'error', message: 'This list has no statuses yet. Add one in Customize first.', retry: () => setPhase({ kind: 'idle' }) }); return; }
    setPhase({ kind: 'saving', key });
    const result = await saveCustomListItem(user.id, list, item, {
      statusId: status.id, typeIds, priceLevel: null, priceManual: '', rating: null, ratingManual: '', notes: '', photos: [],
    });
    if (result.status === 'duplicate') {
      setPhase({ kind: 'error', message: `${item.name.trim()} is already on ${list.name}.`, retry: () => setPhase({ kind: 'idle' }) });
      return;
    }
    if (result.status === 'error') {
      setPhase({ kind: 'error', message: 'Couldn’t save. Check your connection and try again.', retry: () => void save(item, key, then) });
      return;
    }
    void hapticSuccess();
    setPhase({ kind: 'idle' });
    onOpenChange(false);
    onSaved(result.id);
    if (then === 'details') { onSavedOpenDetails(result.id); return; }
    toast.success(`Added to ${status.name}`, {
      description: item.name.trim(),
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error } = await supabase.from('custom_list_items').delete().eq('id', result.id);
          if (error) toast.error('Couldn’t undo. The item is still on the list.');
          else onSaved(result.id);
        },
      },
    });
  }

  const savePlace = (place: ResolvedPlace) =>
    save({ name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude, picked: { applePlaceId: place.applePlaceId, appleAddress: place.address } }, place.applePlaceId ?? place.name, 'close');
  const saveTyped = (then: 'close' | 'details') =>
    save({ name: isPlaces ? places.searchQuery : name, address: '', latitude: null, longitude: null, picked: null }, 'typed', then);

  const query = isPlaces ? places.searchQuery : name;
  const toggleType = (id: string) => setTypeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="bottom" showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[85dvh] rounded-t-3xl px-4 pt-3 sm:mx-auto sm:max-w-lg">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <SheetTitle className="sr-only">Add to {list.name}</SheetTitle>
        <SheetDescription className="mb-2 text-sm">
          Adding to <span className="font-medium text-foreground">{list.name}</span>{status ? <> · {status.name}</> : null}
        </SheetDescription>
        <form onSubmit={(e) => { e.preventDefault(); if (!isPlaces) void saveTyped('close'); }}>
          <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-primary/70 bg-card px-3 focus-within:border-primary">
            {isPlaces ? <Search className="h-5 w-5 shrink-0 text-muted-foreground" /> : <Plus className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { if (isPlaces) { places.setSearchQuery(e.target.value); places.setShowResults(true); } else setName(e.target.value); if (phase.kind === 'error') setPhase({ kind: 'idle' }); }}
              placeholder={addPromptOf(list)}
              aria-label={addPromptOf(list)}
              maxLength={120}
              enterKeyHint={isPlaces ? 'search' : 'done'}
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {isPlaces && places.searching && <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {types.length > 0 && (
            <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar" aria-label="Categories">
              {types.map((t) => (
                <Chip key={t.id} active={typeIds.includes(t.id)} onClick={() => toggleType(t.id)}>
                  {t.icon && <span className="mr-1.5" aria-hidden>{t.icon}</span>}{t.name}
                </Chip>
              ))}
            </div>
          )}

          {phase.kind === 'error' && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{phase.message}</span>
            </div>
          )}

          {isPlaces ? (
            <div className="mt-3 divide-y overflow-hidden rounded-2xl border bg-card">
              {places.searchResults.map((r) => {
                const saving = phase.kind === 'saving' && phase.key === (r.id ?? r.name);
                return (
                  <button
                    key={r.id} type="button" disabled={busy}
                    onClick={() => places.selectPlace(r)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60 active-press"
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.address}</span>
                    </span>
                    {saving ? <Spinner className="h-4 w-4 animate-spin" /> : <span className="text-sm font-semibold text-primary">Save</span>}
                  </button>
                );
              })}
              {places.noResults && query.trim() && <p className="px-3.5 py-3 text-sm text-muted-foreground">No places found for “{query.trim()}”.</p>}
              {query.trim() && (
                <button type="button" disabled={busy} onClick={() => void saveTyped('close')} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/50 disabled:opacity-60 active-press">
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">Add “{query.trim()}” without a place</span>
                  {phase.kind === 'saving' && phase.key === 'typed' && <Spinner className="h-4 w-4 animate-spin" />}
                </button>
              )}
              {!query.trim() && <p className="px-3.5 py-3 text-sm text-muted-foreground">Search Apple Maps, then tap a place to save it.</p>}
              {phase.kind === 'error' && (
                <button type="button" onClick={phase.retry} className="w-full px-3.5 py-3 text-left text-sm font-semibold text-primary active-press">Try again</button>
              )}
            </div>
          ) : (
            <>
              <Button type="submit" className={cn('mt-4 h-12 w-full rounded-xl text-base font-semibold')} disabled={busy || !name.trim()}>
                {busy ? <><Spinner className="mr-2 h-4 w-4 animate-spin" />Saving…</> : phase.kind === 'error' ? 'Try again' : 'Save'}
              </Button>
              <button type="button" disabled={busy || !name.trim()} onClick={() => void saveTyped('details')} className="mt-2 w-full py-2.5 text-sm font-semibold text-primary disabled:opacity-50 active-press">
                Save and add details
              </button>
            </>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
