import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { RestaurantListRow } from '@/components/restaurants/RestaurantListRow';
import { RestaurantDetailDialog, type DetailRestaurant } from '@/components/restaurants/RestaurantDetailDialog';
import { RestaurantListToolbar } from '@/components/restaurants/RestaurantListToolbar';
import { useRestaurantListControls } from '@/hooks/useRestaurantListControls';
import { useViewMode } from '@/hooks/useViewMode';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, UserPlus, UserMinus, Lock, ArrowLeft, Check, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

interface PublicProfileData {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
  bio?: string | null;
}

async function fetchPublicProfile(userId: string): Promise<PublicProfileData | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_url, is_private, bio')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchFollowStatus(viewerId: string, targetId: string): Promise<'accepted' | 'pending' | null> {
  const { data, error } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', viewerId)
    .eq('following_id', targetId)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as 'accepted' | 'pending') ?? null;
}

async function fetchPublicRestaurants(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select(`
      *,
      folder:folders(name, color),
      images:restaurant_images(image_url)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export default function PublicProfile() {
  const { userId } = useParams<{ userId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'went_to' | 'to_go'>('went_to');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => fetchPublicProfile(userId!),
    enabled: !!userId,
  });

  const { data: followStatus } = useQuery({
    queryKey: ['follow-status', user?.id, userId],
    queryFn: () => fetchFollowStatus(user!.id, userId!),
    enabled: !!user && !!userId && user.id !== userId,
  });

  const isOwnProfile = user?.id === userId;
  const canViewRestaurants = isOwnProfile || !profile?.is_private || followStatus === 'accepted';

  const { data: restaurants = [], isLoading: restaurantsLoading } = useQuery({
    queryKey: ['public-restaurants', userId],
    queryFn: () => fetchPublicRestaurants(userId!),
    enabled: !!userId && canViewRestaurants,
  });

  const invalidateFollow = () => {
    queryClient.invalidateQueries({ queryKey: ['follow-status', user?.id, userId] });
    queryClient.invalidateQueries({ queryKey: ['following', user?.id] });
  };

  const handleFollow = async () => {
    if (!user || !userId) return;
    const { error } = await supabase.from('follows').insert({
      follower_id: user.id,
      following_id: userId,
    });
    if (error) {
      toast.error('Failed to follow user');
    } else {
      toast.success(profile?.is_private ? 'Follow request sent' : 'Now following!');
      invalidateFollow();
    }
  };

  const handleUnfollow = async () => {
    if (!user || !userId) return;
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', userId);
    if (error) {
      toast.error('Failed to unfollow user');
    } else {
      toast.success('Unfollowed');
      invalidateFollow();
    }
  };

  const statusFilteredRestaurants = restaurants.filter((r) => r.status === statusFilter);
  const { typeFilter, setTypeFilter, sortBy, setSortBy, availableTypes, filteredSorted: filteredRestaurants } =
    useRestaurantListControls(statusFilteredRestaurants);
  const [viewMode, setViewMode] = useViewMode('public-profile');
  const [detailRestaurant, setDetailRestaurant] = useState<DetailRestaurant | null>(null);

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container py-8 px-4 text-center">
          <h1 className="text-xl font-semibold mb-2">User not found</h1>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Go back
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-3xl">
        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Explore
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile.avatar_url || ''} />
              <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">
                {profile.display_name || profile.username}
              </h1>
              {profile.username && (
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
              )}
              {profile.bio && <p className="text-sm mt-1 max-w-md">{profile.bio}</p>}
            </div>
          </div>

          {!isOwnProfile && (
            followStatus === 'accepted' ? (
              <Button variant="outline" onClick={handleUnfollow}>
                <UserMinus className="h-4 w-4 mr-2" /> Unfollow
              </Button>
            ) : followStatus === 'pending' ? (
              <Button variant="outline" disabled>
                <Clock className="h-4 w-4 mr-2" /> Requested
              </Button>
            ) : (
              <Button onClick={handleFollow}>
                <UserPlus className="h-4 w-4 mr-2" /> Follow
              </Button>
            )
          )}
        </div>

        {!canViewRestaurants ? (
          <div className="text-center py-16 bg-card rounded-xl">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-lg font-medium mb-1">This account is private</h3>
            <p className="text-muted-foreground text-sm">
              Follow {profile.display_name || profile.username} to see their lists.
            </p>
          </div>
        ) : restaurantsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-xl">
            <p className="text-muted-foreground">No restaurants added yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'went_to' | 'to_go')}>
                <TabsList>
                  <TabsTrigger value="went_to" className="gap-1.5">
                    <Check className="h-3.5 w-3.5" /> Been There
                  </TabsTrigger>
                  <TabsTrigger value="to_go" className="gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> To Go
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <RestaurantListToolbar
                availableTypes={availableTypes}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                sortBy={sortBy}
                onSortByChange={setSortBy}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
            </div>

            {filteredRestaurants.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-xl">
                <p className="text-muted-foreground">
                  {statusFilteredRestaurants.length === 0
                    ? statusFilter === 'went_to'
                      ? 'No places marked as Been There yet'
                      : 'No places on their To Go list'
                    : 'No restaurants match your filters'}
                </p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="space-y-2">
                {filteredRestaurants.map((restaurant) => (
                  <RestaurantListRow
                    key={restaurant.id}
                    restaurant={restaurant}
                    onOpenDetail={() => setDetailRestaurant(restaurant)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredRestaurants.map((restaurant) => (
                  <RestaurantCard key={restaurant.id} restaurant={restaurant} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <RestaurantDetailDialog
        restaurant={detailRestaurant}
        onOpenChange={(open) => !open && setDetailRestaurant(null)}
      />
    </div>
  );
}
