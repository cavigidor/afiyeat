import { EggFried, UtensilsCrossed, Cake, Coffee, Martini, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getFolderIcon(folderName?: string | null): LucideIcon {
  if (!folderName) return Utensils;
  const name = folderName.toLowerCase();
  if (name.includes('brunch') || name.includes('breakfast')) return EggFried;
  if (name.includes('dessert') || name.includes('sweet') || name.includes('bakery')) return Cake;
  if (name.includes('cafe') || name.includes('café') || name.includes('coffee')) return Coffee;
  if (name.includes('bar') || name.includes('cocktail') || name.includes('pub')) return Martini;
  if (name.includes('lunch') || name.includes('dinner') || name.includes('restaurant')) return UtensilsCrossed;
  return Utensils;
}
