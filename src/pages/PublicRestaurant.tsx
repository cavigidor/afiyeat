import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Star, DollarSign, Check, Clock, Plus, Loader2, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';
import { UserSafetyMenu } from '@/components/moderation/UserSafetyMenu';
import { ShareButton } from '@/components/sharing/ShareButton';
import { JoinAfiyeatCta, OwnerByline, SharedNotAvailable } from '@/components/sharing/SharedContentBits';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import { isDuplicateRestaurant } from '@/lib/duplicateRestaurant';
import { hapticSuccess } from '@/lib/haptics';
import { SITE_URL } from '@/lib/site';
import { fetchRestaurantPreview, isUuid, ownerName, type RestaurantPreview } from '@/lib/sharedPreview';

interface RestaurantView extends RestaurantPreview {
  /** Only available to signed-in viewers - photos live in a private bucket. */
  firstImageUrl: string | null;
}

/**
 * Signed-in viewers read through the normal tables, so row-level security
 * decides what they see - which covers a friend's private-profile places
 * too. Anyone else, or anything RLS hides, falls back to the narrow public
 * preview.
 */
async function fetchRestaurant(id: string, signedIn: boolean): Promise<RestaurantView | null> {
  if (!isUuid(id)) return null;

  if (signedIn) {
    const { data } = await supabase
      .from('restaurants')
      .select(
        'id, name, address, category, rating, price_level, status, latitude, longitude, place_id, user_id, images:restaurant_images(image_url)',
      )
      .eq('id', id)
      .maybeSingle();

    if (data) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('user_id, display_name, username, avatar_emoji, avatar_color')
        .eq('user_id', data.user_id)
        .maybeSingle();
      return {
        type: 'restaurant',
        id: data.id,
        name: data.name,
        address: data.address,
        category: data.category,
        rating: data.rating,
        price_level: data.price_level,
        status: data.status,
        latitude: data.latitude,
        longitude: data.longitude,
        place_id: data.place_id,
        owner: owner ?? {
          user_id: data.user_id,
          display_name: null,
          username: null,
          avatar_emoji: null,
          avatar_color: null,
        },
        firstImageUrl: (data.images as { image_url: string }[] | null)?.[0]?.image_url ?? null,
      };
    }
  }

  const preview = await fetchRestaurantPreview(id);
  return preview ? { ...preview, firstImageUrl: null } : null;
}

/**
 * /r/:id - one restaurant, as seen through a shared link.
 *
 * The page a friend lands on when someone sends them a place. It has to
 * work without an account, because that's exactly who most of these links
 * are for: they see the place first, and the offer to join is about
 * keeping it on their own map.
 */
export default function PublicRestaurant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [saving, setSaving] = useState(false);

  const { data: restaurant, isLoading } = useQuery({
    queryKey: ['shared-restaurant', id, !!user],
    queryFn: () => fetchRestaurant(id!, !!user),
    enabled: !!id && !authLoading,
    staleTime: 60 * 1000,
  });

  const { signedUrl: photo } = useSignedImageUrl(restaurant?.firstImageUrl);
  const isOwner = !!user && restaurant?.owner.user_id === user.id;

  // Copies the place into the viewer's own list. This is the moment a
  // shared link turns into a user doing something - and it counts toward
  // the activation that qualifies a referral, server-side.
  const handleSave = async () => {
    if (!user || !restaurant) return;
    setSaving(true);
    try {
      const duplicate = await isDuplicateRestaurant(user.id, {
        name: restaurant.name,
        latitude: restaurant.latitude ?? undefined,
        longitude: restaurant.longitude ?? undefined,
        placeId: restaurant.place_id,
      });
      if (duplicate) {
        toast.info('This place is already in your restaurants.');
        return;
      }
      const { error } = await supabase.from('restaurants').insert({
        user_id: user.id,
        name: restaurant.name,
        address: restaurant.address,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        place_id: restaurant.place_id,
        category: restaurant.category,
        status: 'to_go',
      });
      if (error) throw error;
      void hapticSuccess();
      void queryClient.invalidateQueries({ queryKey: ['restaurants', user.id] });
      void queryClient.invalidateQueries({ queryKey: ['restaurant_count', user.id] });
      toast.success('Saved to your To Go list', {
        action: { label: 'View', onClick: () => navigate('/my-list') },
      });
    } catch (err) {
      console.error('Save shared restaurant failed:', err);
      toast.error('Couldn\'t save this place. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-2xl space-y-4">
        {isLoading || authLoading ? (
          <div className="space-y-4">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !restaurant ? (
          <SharedNotAvailable what="place" />
        ) : (
          <>
            <Card className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                {photo ? (
                  <img
                    src={photo}
                    alt={restaurant.name}
                    className="w-full h-full object-cover"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 via-secondary/20 to-accent/10">
                    <UtensilsCrossed className="h-20 w-20 text-primary/60" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold leading-tight">{restaurant.name}</h1>
                    {restaurant.category && (
                      <p className="text-sm text-muted-foreground mt-0.5">{restaurant.category}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {user && (
                      <ShareButton
                        url={`${SITE_URL}/r/${restaurant.id}`}
                        source="restaurant"
                        title={restaurant.name}
                        text={
                          isOwner
                            ? `I saved ${restaurant.name} on Afiyeat. Want to try it with me?`
                            : `${restaurant.name} — found on Afiyeat`
                        }
                        ownContent={isOwner}
                      />
                    )}
                    {user && !isOwner && (
                      <UserSafetyMenu
                        userId={restaurant.owner.user_id}
                        displayName={ownerName(restaurant.owner)}
                        contentType="restaurant"
                        contentId={restaurant.id}
                        onBlocked={() => navigate('/explore', { replace: true })}
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant={restaurant.status === 'went_to' ? 'default' : 'secondary'} className="gap-1">
                    {restaurant.status === 'went_to' ? (
                      <>
                        <Check className="h-3 w-3" /> Been there
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3" /> Wants to go
                      </>
                    )}
                  </Badge>
                  {restaurant.rating != null && restaurant.rating > 0 && (
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      {restaurant.rating}/10
                    </span>
                  )}
                  {restaurant.price_level != null && restaurant.price_level > 0 && (
                    <span className="flex items-center" aria-label={`Price level ${restaurant.price_level} of 4`}>
                      {Array.from({ length: 4 }).map((_, i) => (
                        <DollarSign
                          key={i}
                          className={`h-4 w-4 -ml-1 first:ml-0 ${
                            i < restaurant.price_level! ? 'text-primary' : 'text-muted'
                          }`}
                        />
                      ))}
                    </span>
                  )}
                </div>

                {restaurant.address && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 min-w-0">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span className="truncate">{restaurant.address}</span>
                    </p>
                    <GetDirectionsButton
                      latitude={restaurant.latitude}
                      longitude={restaurant.longitude}
                      address={restaurant.address}
                      name={restaurant.name}
                      size="sm"
                    />
                  </div>
                )}

                <div className="pt-3 border-t">
                  <OwnerByline owner={restaurant.owner} linkToProfile={!!user} />
                </div>

                {user && !isOwner && (
                  <Button className="w-full" onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Save to my places
                  </Button>
                )}
                {isOwner && (
                  <Button variant="outline" className="w-full" onClick={() => navigate('/my-list')}>
                    Open in My Restaurants
                  </Button>
                )}
              </CardContent>
            </Card>

            {!user && <JoinAfiyeatCta owner={restaurant.owner} what="this place" />}
          </>
        )}
      </main>
    </div>
  );
}
