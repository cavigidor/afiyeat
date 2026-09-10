import { useState, useMemo } from 'react';
import { compareTypeNames } from '@/lib/typeOrder';

export type RestaurantSortBy = 'name' | 'price_asc' | 'price_desc' | 'rating_desc';

interface RestaurantLike {
  name: string;
  price_level?: number | null;
  rating?: number | null;
  folders?: { name: string; color: string }[];
}

/**
 * Shared type-filter + sort logic for any page rendering a list of
 * restaurants that include resolved `folders` (type/price_level/rating).
 * A restaurant can now carry more than one type tag, so the filter matches
 * any restaurant that has the selected type among its tags. Filtering/sort
 * only - view mode (grid/list) is handled separately by useViewMode so
 * pages can opt out of it (e.g. it's irrelevant while a detail dialog is
 * open).
 */
export function useRestaurantListControls<T extends RestaurantLike>(restaurants: T[]) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<RestaurantSortBy>('name');

  const availableTypes = useMemo(() => {
    const names = new Set<string>();
    restaurants.forEach((r) => {
      r.folders?.forEach((f) => names.add(f.name));
    });
    return Array.from(names).sort(compareTypeNames);
  }, [restaurants]);

  const filteredSorted = useMemo(() => {
    const base = typeFilter
      ? restaurants.filter((r) => r.folders?.some((f) => f.name === typeFilter))
      : restaurants;
    const sorted = [...base];
    switch (sortBy) {
      case 'price_asc':
        sorted.sort((a, b) => (a.price_level ?? 99) - (b.price_level ?? 99));
        break;
      case 'price_desc':
        sorted.sort((a, b) => (b.price_level ?? -1) - (a.price_level ?? -1));
        break;
      case 'rating_desc':
        sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [restaurants, typeFilter, sortBy]);

  return { typeFilter, setTypeFilter, sortBy, setSortBy, availableTypes, filteredSorted };
}
