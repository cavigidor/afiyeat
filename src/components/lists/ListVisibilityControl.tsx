import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Check, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  ANONYMOUS_HIDDEN,
  ANONYMOUS_SHOWN,
  visibilityOptions,
  type ListVisibility,
} from '@/lib/listVisibility';
import { fetchListDiscoveryPreview, type DiscoverableList } from '@/lib/communityLists';
import { DiscoverableListView } from './DiscoverableListView';
import { Spinner } from '@/components/ui/spinner';

interface ListVisibilityControlProps {
  value: ListVisibility;
  onChange: (value: ListVisibility) => void;
  isPrivateAccount: boolean;
  /** The list being edited (for the real preview); absent while creating. */
  listId?: string | null;
  /** The name as currently typed, so the preview matches what will be saved. */
  listName: string;
  /** Whether turning on anonymous discovery still needs the person's OK. */
  needsConsent: boolean;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
}

/**
 * "Who can see this list" - three plain choices, worded for the account
 * the person actually has. Choosing "Discoverable anonymously" spells out
 * what is shown and what never is, asks for an explicit OK, and offers a
 * preview of exactly what other people will see.
 */
export function ListVisibilityControl({
  value,
  onChange,
  isPrivateAccount,
  listId,
  listName,
  needsConsent,
  consent,
  onConsentChange,
}: ListVisibilityControlProps) {
  const options = visibilityOptions(isPrivateAccount, value);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['list-discovery-preview', listId],
    queryFn: () => fetchListDiscoveryPreview(listId!),
    enabled: !!listId && value === 'anonymous' && previewOpen,
    staleTime: 0,
  });

  // While creating there's nothing saved to preview yet: show the name, and
  // say that items appear by name as they're added.
  const shown: DiscoverableList | null = listId
    ? preview
      ? { ...preview, title: listName.trim() || preview.title }
      : null
    : {
        token: '',
        title: listName.trim() || 'Your list',
        icon: null,
        rating_mode: null,
        statuses: [],
        types: [],
        items: [],
        is_owner: true,
      };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium" id="list-visibility-label">
          Who can see this list
        </p>
        <p className="text-xs text-muted-foreground">You can change this any time.</p>
      </div>

      <div role="radiogroup" aria-labelledby="list-visibility-label" className="space-y-2">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                'active-press flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-[background-color,border-color] duration-150',
                selected ? 'border-primary bg-primary/5' : 'bg-background active:bg-muted/60',
              )}
            >
              <span aria-hidden className="text-lg leading-none mt-0.5">
                {o.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{o.description}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                )}
              >
                {selected && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      {value === 'anonymous' && (
        <div className="space-y-3 rounded-lg bg-muted/50 p-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="font-medium">Others will see</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {ANONYMOUS_SHOWN.map((s) => (
                  <li key={s} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Never shown</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {ANONYMOUS_HIDDEN.map((s) => (
                  <li key={s} className="flex items-start gap-1.5">
                    <X className="mt-0.5 h-3 w-3 shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs">
            <span className="font-medium">Your list name and item names are shown exactly as you write them.</span>{' '}
            If they mention you, your family, your address or anything personal, people may still be able to tell
            it's yours - rename them first.
          </p>

          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            aria-expanded={previewOpen}
            className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-xs font-medium"
          >
            Preview what others will see
            <ChevronDown className={cn('h-4 w-4 transition-transform', previewOpen && 'rotate-180')} />
          </button>
          {previewOpen && (
            <div className="rounded-md border bg-background p-3">
              {previewLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : shown ? (
                <>
                  <DiscoverableListView list={shown} compact />
                  {!listId && (
                    <p className="mt-3 text-xs text-muted-foreground">Items appear here by name as you add them.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Couldn't load the preview.</p>
              )}
            </div>
          )}

          {needsConsent && (
            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="anonymous-consent"
                checked={consent}
                onCheckedChange={(v) => onConsentChange(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="anonymous-consent" className="text-xs font-normal leading-snug">
                I understand anyone on Afiyeat can find this list and see its name and items, without my name.
              </Label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
