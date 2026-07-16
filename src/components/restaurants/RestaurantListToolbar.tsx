import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ListViewToggle } from '@/components/shared/ListViewToggle';
import type { ViewMode } from '@/hooks/useViewMode';
import type { RestaurantSortBy } from '@/hooks/useRestaurantListControls';

interface RestaurantListToolbarProps {
  availableTypes: string[];
  typeFilter: string | null;
  onTypeFilterChange: (v: string | null) => void;
  sortBy: RestaurantSortBy;
  onSortByChange: (v: RestaurantSortBy) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  showTypeFilter?: boolean;
}

export function RestaurantListToolbar({
  availableTypes,
  typeFilter,
  onTypeFilterChange,
  sortBy,
  onSortByChange,
  viewMode,
  onViewModeChange,
  showTypeFilter = true,
}: RestaurantListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showTypeFilter && availableTypes.length > 0 && (
        <Select
          value={typeFilter ?? 'all'}
          onValueChange={(v) => onTypeFilterChange(v === 'all' ? null : v)}
        >
          <SelectTrigger className="w-[130px] h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {availableTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={sortBy} onValueChange={(v) => onSortByChange(v as RestaurantSortBy)}>
        <SelectTrigger className="w-[168px] h-9">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name (A-Z)</SelectItem>
          <SelectItem value="price_asc">Price: Low to High</SelectItem>
          <SelectItem value="price_desc">Price: High to Low</SelectItem>
          <SelectItem value="rating_desc">Rating: High to Low</SelectItem>
        </SelectContent>
      </Select>

      <ListViewToggle value={viewMode} onChange={onViewModeChange} />
    </div>
  );
}
