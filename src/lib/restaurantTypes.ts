import type { Database } from '@/integrations/supabase/types';
import type { AppleFilled } from '@/lib/appleMaps';

/** A restaurants row as the app reads it: the saved columns plus the joins
 *  and display additions pages attach (photos, resolved types, Apple details). */
export type SavedRestaurant = Database['public']['Tables']['restaurants']['Row'] & {
  images?: { image_url: string; id?: string }[];
  folders?: { id: string; name: string; color: string; icon?: string | null }[];
  appleFilled?: AppleFilled;
};
