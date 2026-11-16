import { LayoutGrid, List as ListIcon, Map as MapIcon, Rows3, type LucideIcon } from 'lucide-react';
import type { ListView } from '@/lib/listPresets';

export const VIEW_ICONS: Record<ListView, LucideIcon> = { list: ListIcon, cards: LayoutGrid, grouped: Rows3, map: MapIcon };
