import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Layers, ListChecks, Lock, SlidersHorizontal, LayoutGrid, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import type { CustomList, PriceMode, RatingMode } from '@/components/lists/CreateListDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { ListTypesManager } from '@/components/lists/ListTypesManager';
import { ListStatusesManager } from '@/components/lists/ListStatusesManager';
import { ListVisibilityControl } from '@/components/lists/ListVisibilityControl';
import { useMyShareIdentity } from '@/hooks/useMyShareIdentity';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { DEFAULT_LIST_VISIBILITY, visibilityChip, type ListVisibility } from '@/lib/listVisibility';
import { layoutOf, type ListView, type ViewOption } from '@/lib/listPresets';
import { VIEW_ICONS } from './viewIcons';
import { ListGlyph } from './ListGlyph';
import { cn } from '@/lib/utils';

type Page = 'main' | 'fields' | 'categories' | 'statuses' | 'visibility' | 'views';

interface CustomizeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: CustomList;
  types: ManagedListType[];
  statuses: ManagedListStatus[];
  view: ListView;
  viewOptions: ViewOption[];
  onViewChange: (v: ListView) => void;
  onListChanged: () => void;
  onTypesChanged: () => void;
  onStatusesChanged: () => void;
  onOpenAllSettings: () => void;
}

type FieldKey = 'show_location' | 'show_price' | 'show_rating' | 'show_notes' | 'show_photos';
const FIELDS: { key: FieldKey; label: string; hint: string }[] = [
  { key: 'show_location', label: 'Location', hint: 'Address, map and directions' },
  { key: 'show_price', label: 'Price', hint: '$–$$$$ or an amount' },
  { key: 'show_rating', label: 'Rating', hint: '1–10, 5 stars or custom' },
  { key: 'show_notes', label: 'Notes', hint: 'Free text' },
  { key: 'show_photos', label: 'Photos', hint: 'Up to a few per item' },
];

/**
 * Everything about a list in one place. Each switch saves at once and only hides or shows a field:
 * values already saved are never removed (see customListItemPayload). Categories and statuses use the
 * existing managers (add, rename, reorder, delete). The view is remembered on this device.
 */
export function CustomizeSheet(props: CustomizeSheetProps) {
  const { open, onOpenChange, list, types, statuses, view, viewOptions, onViewChange, onListChanged, onTypesChanged, onStatusesChanged, onOpenAllSettings } = props;
  const [page, setPage] = useState<Page>('main');
  const [name, setName] = useState(list.name);
  const [pending, setPending] = useState<string | null>(null);
  const identity = useMyShareIdentity();
  const queryClient = useQueryClient();

  useEffect(() => { if (open) { setPage('main'); setName(list.name); } }, [open, list.name]);

  const update = async (key: string, patch: Record<string, unknown>, done?: string) => {
    setPending(key);
    const { error } = await supabase.from('custom_lists').update(patch as TablesUpdate<'custom_lists'>).eq('id', list.id);
    setPending(null);
    if (error) { toast.error('Couldn’t save that change. Check your connection and try again.'); return false; }
    if (done) toast.success(done);
    onListChanged();
    return true;
  };

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === list.name) { setName(list.name); return; }
    if (blockedByContentFilter(next)) { setName(list.name); return; }
    if (!(await update('name', { name: next }))) setName(list.name);
  };

  const shown = FIELDS.filter((f) => list[f.key]).length;
  const audience = visibilityChip(list.visibility, identity.isPrivate).label;
  const title: Record<Page, string> = { main: 'Customize list', fields: 'Fields', categories: layoutOf(list) === 'travel' ? 'Destinations' : 'Categories', statuses: 'Statuses', visibility: 'Who can see it', views: 'Views' };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="h-[92dvh] rounded-t-3xl px-0 pt-3 sm:mx-auto sm:max-w-lg">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <div className="flex items-center justify-between px-3">
          <div className="w-16">
            {page !== 'main' && (
              <button type="button" onClick={() => setPage('main')} aria-label="Back" className="rounded-full p-2 active-press"><ChevronLeft className="h-5 w-5" /></button>
            )}
          </div>
          <SheetTitle className="text-base font-semibold">{title[page]}</SheetTitle>
          <button type="button" onClick={() => onOpenChange(false)} className="w-16 py-2 text-right font-semibold text-primary active-press">Done</button>
        </div>
        <SheetDescription className="sr-only">Change how {list.name} looks and what it records.</SheetDescription>

        <div key={page} className="mt-2 px-4 animate-in fade-in-0 duration-150">
          {page === 'main' && (
            <>
              <div className="flex items-center gap-3">
                <ListGlyph icon={list.icon} color={list.color} size="lg" />
                <label className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-muted-foreground">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    maxLength={60} className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-base outline-none focus:border-primary" />
                </label>
              </div>
              <div className="mt-4 divide-y overflow-hidden rounded-2xl border bg-card">
                <Row icon={SlidersHorizontal} label="Fields" detail={`${shown} shown · ${FIELDS.length - shown} hidden`} onClick={() => setPage('fields')} />
                <Row icon={Layers} label={title.categories} detail={types.length ? types.map((t) => t.name).join(', ') : 'None yet'} onClick={() => setPage('categories')} />
                <Row icon={ListChecks} label="Statuses" detail={statuses.map((s) => s.name).join(', ') || 'None yet'} onClick={() => setPage('statuses')} />
                <Row icon={Lock} label="Who can see it" detail={audience} onClick={() => setPage('visibility')} />
                <Row icon={LayoutGrid} label="Views" detail={viewOptions.find((o) => o.view === view)?.label ?? 'List'} onClick={() => setPage('views')} />
                <Row icon={Settings2} label="All settings" detail="Every setting on one screen" onClick={onOpenAllSettings} />
              </div>
              <p className="mt-3 px-1 text-sm text-muted-foreground">Nothing here deletes saved items. Hidden fields keep their values and come back when shown again.</p>
            </>
          )}

          {page === 'fields' && (
            <>
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn('block font-medium', !list[f.key] && 'text-muted-foreground')}>{f.label}</span>
                        <span className="block text-xs text-muted-foreground">{f.hint}</span>
                      </span>
                      {pending === f.key && <Spinner className="h-4 w-4 animate-spin" />}
                      <Switch checked={list[f.key]} disabled={pending === f.key} onCheckedChange={(v) => void update(f.key, { [f.key]: v })} aria-label={`Show ${f.label}`} />
                    </label>
                    {f.key === 'show_price' && list.show_price && (
                      <Choice value={list.price_mode} pending={pending === 'price_mode'} onChange={(v) => void update('price_mode', { price_mode: v as PriceMode })}
                        options={[{ value: 'dollar', label: '$ – $$$$' }, { value: 'manual', label: 'Amount' }]} />
                    )}
                    {f.key === 'show_rating' && list.show_rating && (
                      <Choice value={list.rating_mode} pending={pending === 'rating_mode'} onChange={(v) => void update('rating_mode', { rating_mode: v as RatingMode })}
                        options={[{ value: 'scale_10', label: '1–10' }, { value: 'stars_5', label: '5 stars' }, { value: 'manual', label: 'Custom' }]} />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 px-1 text-sm text-muted-foreground">Turning a field off hides it. Values already saved are kept, and switching between styles keeps both.</p>
              <p className="mt-2 px-1 text-xs text-muted-foreground">Fields of your own (text, numbers, dates, tags) need a database change that is waiting for approval.</p>
            </>
          )}

          {page === 'categories' && (
            <ListTypesManager listId={list.id} types={types} onTypesChange={onTypesChanged} modifyMode selectedTypeId={null} onSelectType={() => {}} />
          )}

          {page === 'statuses' && (
            <ListStatusesManager listId={list.id} statuses={statuses} onStatusesChange={onStatusesChanged} />
          )}

          {page === 'visibility' && (
            <VisibilityPage list={list} isPrivateAccount={identity.isPrivate} onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['community-lists'] });
              void queryClient.invalidateQueries({ queryKey: ['explore-lists'] });
              void queryClient.invalidateQueries({ queryKey: ['list-discovery-preview'] });
              onListChanged();
              setPage('main');
            }} />
          )}

          {page === 'views' && (
            <>
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {viewOptions.map((o) => {
                  const Icon = VIEW_ICONS[o.view];
                  return (
                    <button key={o.view} type="button" disabled={!o.available} onClick={() => onViewChange(o.view)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-60 active-press">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{o.label}</span>
                        {!o.available && o.reason && <span className="block text-xs text-muted-foreground">{o.reason}</span>}
                      </span>
                      {o.view === view && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 px-1 text-sm text-muted-foreground">Your choice is remembered on this device.</p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon: Icon, label, detail, onClick }: { icon: typeof Lock; label: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 active-press">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block truncate text-sm text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Choice({ value, options, onChange, pending }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; pending: boolean }) {
  return (
    <div role="radiogroup" className="mx-4 mb-3 grid gap-1 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={pending} onClick={() => o.value !== value && onChange(o.value)}
          className={cn('rounded-lg px-2 py-1.5 text-sm font-medium transition-all active-press', o.value === value ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VisibilityPage({ list, isPrivateAccount, onSaved }: { list: CustomList; isPrivateAccount: boolean; onSaved: () => void }) {
  const current = list.visibility ?? DEFAULT_LIST_VISIBILITY;
  const [value, setValue] = useState<ListVisibility>(current);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const needsConsent = value === 'anonymous' && current !== 'anonymous';
  const save = async () => {
    if (needsConsent && !consent) { toast.error('Tick the box to confirm anonymous sharing, or pick another option.'); return; }
    setSaving(true);
    const { error } = await supabase.from('custom_lists').update({ visibility: value } as TablesUpdate<'custom_lists'>).eq('id', list.id);
    setSaving(false);
    if (error) { toast.error('Couldn’t change who can see it. Nothing was changed.'); return; }
    toast.success('Updated who can see this list');
    onSaved();
  };
  return (
    <div className="space-y-4">
      <ListVisibilityControl value={value} onChange={setValue} isPrivateAccount={isPrivateAccount} listId={list.id} listName={list.name}
        needsConsent={needsConsent} consent={consent} onConsentChange={setConsent} />
      <Button className="h-12 w-full rounded-xl" disabled={saving || value === current} onClick={() => void save()}>
        {saving ? <><Spinner className="mr-2 h-4 w-4 animate-spin" />Saving…</> : value === current ? 'No change' : 'Save'}
      </Button>
    </div>
  );
}
