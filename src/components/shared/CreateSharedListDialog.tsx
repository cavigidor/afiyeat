import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface CreateSharedListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  following: Profile[];
  onSuccess: () => void;
}

export function CreateSharedListDialog({
  open,
  onOpenChange,
  following,
  onSuccess,
}: CreateSharedListDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [friendId, setFriendId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('');
    setFriendId(null);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Give your list a name');
      return;
    }
    if (!friendId) {
      toast.error('Pick a friend to share with');
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('shared_lists').insert({
      name: name.trim(),
      user_a: user.id,
      user_b: friendId,
    });
    setLoading(false);

    if (error) {
      toast.error('Failed to create shared list');
      console.error(error);
    } else {
      toast.success('Shared list created!');
      reset();
      onOpenChange(false);
      onSuccess();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[450px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Shared List</DialogTitle>
          <DialogDescription>
            Both of you will be able to add, remove, rate, and comment on places.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>List name</Label>
            <Input
              placeholder="e.g. Date night spots"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Share with</Label>
            {following.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Follow someone first to share a list with them.
              </p>
            ) : (
              <div className="max-h-[260px] overflow-y-auto space-y-1 rounded-md border p-1">
                {following.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setFriendId(profile.user_id)}
                    className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors text-left ${
                      friendId === profile.user_id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile.avatar_url || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">
                      {profile.display_name || profile.username}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create List
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
