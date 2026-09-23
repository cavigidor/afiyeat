import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * What a share button needs to know about the person sharing: their
 * referral code (to attribute any signup the link produces) and whether
 * their profile is private (their content only opens for followers, so
 * the share should say so).
 *
 * Cached for the session - neither changes from one share to the next.
 */
export function useMyShareIdentity() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['my-share-identity', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('referral_code, is_private')
        .eq('user_id', user!.id)
        .maybeSingle();
      return {
        referralCode: data?.referral_code ?? null,
        isPrivate: !!data?.is_private,
      };
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });

  return data ?? { referralCode: null, isPrivate: false };
}
