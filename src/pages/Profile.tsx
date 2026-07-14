import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Camera, Save, LogOut, Lock, Check, X, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { validateImageFile } from '@/lib/imageValidation';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import { AvatarCropper } from '@/components/profile/AvatarCropper';

const profileSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(20),
  display_name: z.string().max(50).optional(),
  bio: z.string().max(160).optional(),
  is_private: z.boolean(),
});

type ProfileValues = z.infer<typeof profileSchema>;

interface ProfileData {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
}

interface FollowUser {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface PendingRequest {
  id: string;
  follower_id: string;
  profile: FollowUser;
}

async function fetchProfileFor(userId: string): Promise<ProfileData> {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
  if (error) throw error;
  return data;
}

async function fetchStatsFor(userId: string) {
  const [restaurantsRes, followingRes, followersRes, pendingRes] = await Promise.all([
    supabase.from('restaurants').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', userId).eq('status', 'accepted'),
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId).eq('status', 'accepted'),
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId).eq('status', 'pending'),
  ]);

  return {
    restaurants: restaurantsRes.count || 0,
    following: followingRes.count || 0,
    followers: followersRes.count || 0,
    pending: pendingRes.count || 0,
  };
}

async function fetchPendingRequestsFor(userId: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('id, follower_id')
    .eq('following_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const followerIds = data.map((f) => f.follower_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_url')
    .in('user_id', followerIds);

  return data
    .map((follow) => ({
      id: follow.id,
      follower_id: follow.follower_id,
      profile: profiles?.find((p) => p.user_id === follow.follower_id) as FollowUser,
    }))
    .filter((r) => r.profile);
}

async function fetchFollowersFor(userId: string): Promise<FollowUser[]> {
  const { data: followsData, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('following_id', userId)
    .eq('status', 'accepted');

  if (error) throw error;
  if (!followsData || followsData.length === 0) return [];

  const followerIds = followsData.map((f) => f.follower_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_url')
    .in('user_id', followerIds);

  return profiles || [];
}

async function fetchFollowingListFor(userId: string): Promise<FollowUser[]> {
  const { data: followsData, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  if (error) throw error;
  if (!followsData || followsData.length === 0) return [];

  const followingIds = followsData.map((f) => f.following_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_url')
    .in('user_id', followingIds);

  return profiles || [];
}

export default function Profile() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [followersDialogOpen, setFollowersDialogOpen] = useState(false);
  const [followingDialogOpen, setFollowingDialogOpen] = useState(false);
  const [requestsDialogOpen, setRequestsDialogOpen] = useState(false);
  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfileFor(user!.id),
    enabled: !!user,
  });

  // Use signed URL for avatar
  const { signedUrl: avatarSignedUrl } = useSignedImageUrl(profile?.avatar_url);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: '',
      display_name: '',
      bio: '',
      is_private: false,
    },
  });

  // Sync the form once the profile loads (or changes underneath us).
  useEffect(() => {
    if (profile) {
      form.reset({
        username: profile.username || '',
        display_name: profile.display_name || '',
        bio: profile.bio || '',
        is_private: profile.is_private || false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const { data: stats = { restaurants: 0, following: 0, followers: 0, pending: 0 } } = useQuery({
    queryKey: ['profile-stats', user?.id],
    queryFn: () => fetchStatsFor(user!.id),
    enabled: !!user,
  });

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['pending-requests', user?.id],
    queryFn: () => fetchPendingRequestsFor(user!.id),
    enabled: !!user && stats.pending > 0,
  });

  const { data: followers = [], isLoading: followersLoading } = useQuery({
    queryKey: ['followers', user?.id],
    queryFn: () => fetchFollowersFor(user!.id),
    enabled: !!user && followersDialogOpen,
  });

  const { data: following = [], isLoading: followingLoading } = useQuery({
    queryKey: ['following', user?.id],
    queryFn: () => fetchFollowingListFor(user!.id),
    enabled: !!user && followingDialogOpen,
  });

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key, user?.id] });

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setCropperFile(file);
    setCropperOpen(true);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleCroppedUpload = async (blob: Blob) => {
    if (!user || !profile) return;

    setUploadingAvatar(true);
    try {
      const fileName = `${user.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('restaurant-images')
        .upload(fileName, blob, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const storagePath = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/restaurant-images/${fileName}`;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: storagePath })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      queryClient.setQueryData<ProfileData>(['profile', user?.id], (prev) =>
        prev ? { ...prev, avatar_url: storagePath } : prev,
      );
      setCropperOpen(false);
      toast.success('Avatar updated!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onSubmit = async (values: ProfileValues) => {
    if (!profile) return;

    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        username: values.username,
        display_name: values.display_name || null,
        bio: values.bio || null,
        is_private: values.is_private,
      })
      .eq('id', profile.id);

    if (error) {
      if (error.code === '23505') {
        toast.error('This username is already taken');
      } else {
        toast.error(error.message || 'Failed to update profile');
      }
    } else {
      queryClient.setQueryData<ProfileData>(['profile', user?.id], (prev) =>
        prev
          ? {
              ...prev,
              username: values.username,
              display_name: values.display_name || null,
              bio: values.bio || null,
              is_private: values.is_private,
            }
          : prev,
      );
      toast.success('Profile updated!');
    }
    setSaving(false);
  };

  const handleAcceptRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('follows')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    if (error) {
      toast.error('Failed to accept request');
    } else {
      toast.success('Request accepted!');
      invalidate('pending-requests');
      invalidate('profile-stats');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('id', requestId);

    if (error) {
      toast.error('Failed to reject request');
    } else {
      toast.success('Request rejected');
      invalidate('pending-requests');
    }
  };

  const handleRemoveFollower = async (followerUserId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerUserId)
      .eq('following_id', user.id);

    if (error) {
      toast.error('Failed to remove follower');
    } else {
      toast.success('Follower removed');
      invalidate('followers');
      invalidate('profile-stats');
    }
  };

  const handleUnfollow = async (followingUserId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', followingUserId);

    if (error) {
      toast.error('Failed to unfollow');
    } else {
      toast.success('Unfollowed');
      invalidate('following');
      invalidate('profile-stats');
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-2xl">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Profile</h1>

        {/* Pending Requests Banner */}
        {pendingRequests.length > 0 && (
          <Card className="mb-6 border-primary">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {pendingRequests.length} pending follow request{pendingRequests.length > 1 ? 's' : ''}
                  </span>
                </div>
                <Button size="sm" onClick={() => setRequestsDialogOpen(true)}>
                  Review
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 mb-6">
              <div className="relative shrink-0">
                <Avatar className="h-20 w-20 sm:h-24 sm:w-24">
                  <AvatarImage src={avatarSignedUrl || ''} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl sm:text-2xl">
                    {(profile?.username || profile?.display_name || user?.email || 'U')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <label className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-2 cursor-pointer hover:bg-primary/90 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                    className="hidden"
                    disabled={uploadingAvatar}
                  />
                  {uploadingAvatar ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </label>
              </div>
              <div className="flex gap-6 sm:gap-8">
                <div className="text-center">
                  <div className="text-xl sm:text-2xl font-bold">{stats.restaurants}</div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Restaurants</div>
                </div>
                <button
                  className="text-center hover:opacity-80 transition-opacity"
                  onClick={() => setFollowingDialogOpen(true)}
                >
                  <div className="text-xl sm:text-2xl font-bold">{stats.following}</div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Following</div>
                </button>
                <button
                  className="text-center hover:opacity-80 transition-opacity"
                  onClick={() => setFollowersDialogOpen(true)}
                >
                  <div className="text-xl sm:text-2xl font-bold">{stats.followers}</div>
                  <div className="text-xs sm:text-sm text-muted-foreground">Followers</div>
                </button>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="foodlover123" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="display_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your Name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Tell us about your food adventures..."
                          className="resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="is_private"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Lock className="h-4 w-4" />
                          Private Profile
                        </FormLabel>
                        <FormDescription>
                          When enabled, people must request to follow you
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex gap-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={async () => {
                      await signOut();
                      navigate('/');
                    }}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Log Out
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>

      {/* Followers Dialog */}
      <Dialog open={followersDialogOpen} onOpenChange={setFollowersDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Followers</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {followersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : followers.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No followers yet</p>
            ) : (
              <div className="space-y-3">
                {followers.map((follower) => (
                  <div key={follower.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={follower.avatar_url || ''} />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {(follower.username || follower.display_name || 'U')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{follower.display_name || follower.username}</p>
                        {follower.username && <p className="text-sm text-muted-foreground">@{follower.username}</p>}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveFollower(follower.user_id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Following Dialog */}
      <Dialog open={followingDialogOpen} onOpenChange={setFollowingDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Following</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {followingLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : following.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Not following anyone yet</p>
            ) : (
              <div className="space-y-3">
                {following.map((followedUser) => (
                  <div key={followedUser.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={followedUser.avatar_url || ''} />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {(followedUser.username || followedUser.display_name || 'U')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{followedUser.display_name || followedUser.username}</p>
                        {followedUser.username && <p className="text-sm text-muted-foreground">@{followedUser.username}</p>}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnfollow(followedUser.user_id)}
                    >
                      Unfollow
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending Requests Dialog */}
      <Dialog open={requestsDialogOpen} onOpenChange={setRequestsDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Follow Requests</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {pendingRequests.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No pending requests</p>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((request) => (
                  <div key={request.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={request.profile.avatar_url || ''} />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {(request.profile.username || request.profile.display_name || 'U')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{request.profile.display_name || request.profile.username}</p>
                        {request.profile.username && <p className="text-sm text-muted-foreground">@{request.profile.username}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        onClick={() => handleAcceptRequest(request.id)}
                      >
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        onClick={() => handleRejectRequest(request.id)}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AvatarCropper
        file={cropperFile}
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        onCropComplete={handleCroppedUpload}
        saving={uploadingAvatar}
      />
    </div>
  );
}
