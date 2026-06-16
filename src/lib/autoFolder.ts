import { supabase } from '@/integrations/supabase/client';

export interface AutoFolderResult {
  folderName: string;
  color: string;
}

const DEFAULT_FOLDER_COLORS: Record<string, string> = {
  Brunch: '#FF9800',
  Breakfast: '#FF9800',
  Coffee: '#795548',
  Cafe: '#795548',
  Bar: '#9C27B0',
  Pub: '#9C27B0',
  Dessert: '#E91E63',
  Bakery: '#E91E63',
  Sushi: '#F44336',
  Pizza: '#FF5722',
  Burger: '#8D6E63',
  Mexican: '#FF9800',
  Steakhouse: '#5D4037',
  Seafood: '#009688',
  Restaurant: '#2196F3',
};

/**
 * Detect the folder/type category from a restaurant name.
 * Returns the folder name or null if no match.
 */
export function detectFolderFromName(name: string): string | null {
  const lower = name.toLowerCase();

  // Brunch / Breakfast
  if (lower.includes('brunch') || lower.includes('breakfast')) return 'Brunch';

  // Coffee / Cafe
  if (
    lower.includes('coffee') ||
    lower.includes('cafe') ||
    lower.includes('café') ||
    lower.includes('espresso') ||
    lower.includes('roaster') ||
    lower.includes('latte') ||
    lower.includes('cappuccino')
  )
    return 'Coffee';

  // Bar / Pub / Brewery / Winery
  if (
    lower.includes('bar') ||
    lower.includes('cocktail') ||
    lower.includes('pub') ||
    lower.includes('tavern') ||
    lower.includes('lounge') ||
    lower.includes('brewery') ||
    lower.includes('winery') ||
    lower.includes('wine bar') ||
    lower.includes('speakeasy')
  )
    return 'Bar';

  // Dessert / Bakery / Pastry
  if (
    lower.includes('dessert') ||
    lower.includes('bakery') ||
    lower.includes('cake') ||
    lower.includes('pastry') ||
    lower.includes('ice cream') ||
    lower.includes('sweet') ||
    lower.includes('donut') ||
    lower.includes('patisserie') ||
    lower.includes('gelato')
  )
    return 'Dessert';

  // Sushi / Japanese
  if (lower.includes('sushi') || lower.includes('japanese') || lower.includes('ramen')) return 'Sushi';

  // Pizza / Italian
  if (lower.includes('pizza') || lower.includes('trattoria') || lower.includes('osteria')) return 'Pizza';

  // Burger
  if (lower.includes('burger')) return 'Burger';

  // Mexican
  if (
    lower.includes('taco') ||
    lower.includes('mexican') ||
    lower.includes('burrito') ||
    lower.includes('tequila') ||
    lower.includes('cantina')
  )
    return 'Mexican';

  // Steakhouse
  if (lower.includes('steak') || lower.includes('chophouse')) return 'Steakhouse';

  // Seafood
  if (
    lower.includes('seafood') ||
    lower.includes('oyster') ||
    lower.includes('fish') ||
    lower.includes('crab') ||
    lower.includes('lobster')
  )
    return 'Seafood';

  // General Restaurant (lower priority, check last)
  if (
    lower.includes('restaurant') ||
    lower.includes('bistro') ||
    lower.includes('eatery') ||
    lower.includes('grill') ||
    lower.includes('kitchen') ||
    lower.includes('dining') ||
    lower.includes('house') ||
    lower.includes('lunch') ||
    lower.includes('dinner')
  )
    return 'Restaurant';

  return null;
}

/**
 * Find an existing folder matching the detected type (case-insensitive).
 */
export function findExistingFolder(
  folderName: string,
  folders: { id: string; name: string; color: string }[]
): { id: string; name: string; color: string } | undefined {
  return folders.find((f) => f.name.toLowerCase() === folderName.toLowerCase());
}

/**
 * Get the color for a default folder type.
 */
export function getFolderColor(folderName: string): string {
  return DEFAULT_FOLDER_COLORS[folderName] || '#2196F3';
}

/**
 * Find or create a folder for the given restaurant name.
 * Returns the folder id.
 */
export async function findOrCreateAutoFolder(
  userId: string,
  name: string,
  existingFolders: { id: string; name: string; color: string }[]
): Promise<string | null> {
  const detected = detectFolderFromName(name);
  if (!detected) return null;

  const existing = findExistingFolder(detected, existingFolders);
  if (existing) return existing.id;

  // Create the folder
  const { data, error } = await supabase
    .from('folders')
    .insert({
      user_id: userId,
      name: detected,
      color: getFolderColor(detected),
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Failed to auto-create folder:', error);
    return null;
  }

  return data.id;
}
