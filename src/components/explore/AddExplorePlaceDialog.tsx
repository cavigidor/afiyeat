import { AddItemDialog } from '@/components/lists/AddItemDialog';
import type { ExplorePlace } from './ExplorePlaceCard';

interface AddExplorePlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: ExplorePlace | null;
}

/**
 * "Add to a list" for a place found on Home, Explore or Search.
 *
 * This used to be its own one-tap saver: pick a list, and the place was
 * inserted straight away as To Go (or the list's first status) with no
 * chance to set the list's statuses, types, rating, price, notes or
 * photos. It is now the universal Add Item form (AddItemDialog) with the
 * place filled in, so the chosen list decides the fields - exactly as when
 * adding from inside that list - and saving goes through the same helpers
 * (lib/listItemSave.ts), duplicate checks included.
 */
export function AddExplorePlaceDialog({ open, onOpenChange, place }: AddExplorePlaceDialogProps) {
  return <AddItemDialog open={open && !!place} onOpenChange={onOpenChange} initialPlace={place} />;
}
