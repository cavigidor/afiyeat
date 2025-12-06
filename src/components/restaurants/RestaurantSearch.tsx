import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  name: string;
  address: string | null;
  status: string;
  folder_id?: string | null;
  folder?: { name: string; color: string } | null;
}

interface RestaurantSearchProps {
  restaurants: SearchResult[];
  onSelect: (restaurant: SearchResult) => void;
}

export function RestaurantSearch({ restaurants, onSelect }: RestaurantSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filteredResults, setFilteredResults] = useState<SearchResult[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      const filtered = restaurants.filter(
        (r) =>
          r.name.toLowerCase().includes(lowerQuery) ||
          r.address?.toLowerCase().includes(lowerQuery)
      );
      setFilteredResults(filtered.slice(0, 8));
      setIsOpen(true);
    } else {
      setFilteredResults([]);
      setIsOpen(false);
    }
  }, [query, restaurants]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (restaurant: SearchResult) => {
    onSelect(restaurant);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search restaurants by name or address..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-4"
          onFocus={() => query.trim() && setIsOpen(true)}
        />
      </div>

      {isOpen && filteredResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border rounded-xl shadow-lg z-50 overflow-hidden">
          {filteredResults.map((restaurant) => (
            <button
              key={restaurant.id}
              onClick={() => handleSelect(restaurant)}
              className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-start gap-3 border-b last:border-b-0"
            >
              <MapPin className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{restaurant.name}</span>
                  {restaurant.folder && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: restaurant.folder.color + '20', color: restaurant.folder.color }}
                    >
                      {restaurant.folder.name}
                    </span>
                  )}
                </div>
                {restaurant.address && (
                  <p className="text-sm text-muted-foreground truncate">{restaurant.address}</p>
                )}
                <span
                  className={cn(
                    'text-xs',
                    restaurant.status === 'went_to' ? 'text-green-600' : 'text-amber-600'
                  )}
                >
                  {restaurant.status === 'went_to' ? 'Visited' : 'To Go'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filteredResults.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border rounded-xl shadow-lg z-50 p-4 text-center text-muted-foreground">
          No restaurants found matching "{query}"
        </div>
      )}
    </div>
  );
}
