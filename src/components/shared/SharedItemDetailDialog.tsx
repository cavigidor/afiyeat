import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import {
  MapPin,
  Star,
  DollarSign,
  Check,
  Clock,
  Edit,
  Trash2,
  Loader2,
  Send,
  MessageCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';
import { AddedByBadge, type AddedByInfo } from '@/components/shared/AddedByBadge';
import type { SharedItem } from './EditSharedItemDialog';

interface MiniProfile {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

interface Comment {
  id: string;
  user_id: string;
  comment: string;
  created_at: string;
}

interface SharedItemDetailDialogProps {
  item: SharedItem | null;
  listId: string;
  currentUserId: string;
  profilesById: Record<string, MiniProfile>;
  addedBy?: AddedByInfo;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkVisited?: () => void;
}

// Shared Lists' own item detail view - deliberately NOT built on top of
// RestaurantDetailDialog (which My Restaurants also uses), specifically so
// the comment thread below only ever renders here and can never leak into
// the personal My Restaurants view.
export function SharedItemDetailDialog({
  item,
  listId,
  currentUserId,
  profilesById,
  addedBy,
  onOpenChange,
  onEdit,
  onDelete,
  onMarkVisited,
}: SharedItemDetailDialogProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!item) return;
    setLoadingComments(true);
    const { data, error } = await supabase
      .from('shared_list_item_comments')
      .select('id, user_id, comment, created_at')
      .eq('item_id', item.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching comments:', error);
    } else {
      setComments(data || []);
    }
    setLoadingComments(false);
  }, [item]);

  useEffect(() => {
    setNewComment('');
    if (item) fetchComments();
    else setComments([]);
  }, [item, fetchComments]);

  if (!item) return null;

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    setPosting(true);
    const { error } = await supabase.from('shared_list_item_comments').insert({
      item_id: item.id,
      list_id: listId,
      user_id: currentUserId,
      comment: newComment.trim(),
    });
    setPosting(false);
    if (error) {
      toast.error('Failed to post comment');
      console.error(error);
    } else {
      setNewComment('');
      fetchComments();
    }
  };

  const commenterLabel = (userId: string) => {
    if (userId === currentUserId) return 'You';
    const p = profilesById[userId];
    return p?.display_name || p?.username || 'Partner';
  };
  const commenterAvatar = (userId: string) => profilesById[userId];

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            {item.name}
            <Badge variant={item.status === 'went_to' ? 'default' : 'secondary'} className="gap-1">
              {item.status === 'went_to' ? (
                <>
                  <Check className="h-3 w-3" /> Been There
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3" /> To Go
                </>
              )}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {item.address && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 min-w-0">
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{item.address}</span>
              </p>
              <GetDirectionsButton
                latitude={item.latitude}
                longitude={item.longitude}
                address={item.address}
                name={item.name}
                size="sm"
              />
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {item.rating != null && item.rating > 0 && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-medium">{item.rating}/10</span>
              </div>
            )}
            {item.price_level && (
              <div className="flex items-center">
                {Array.from({ length: 4 }).map((_, i) => (
                  <DollarSign
                    key={i}
                    className={`h-4 w-4 -ml-1 first:ml-0 ${i < item.price_level! ? 'text-primary' : 'text-muted'}`}
                  />
                ))}
              </div>
            )}
            {addedBy && <AddedByBadge addedBy={addedBy} />}
          </div>

          {item.notes && <p className="text-sm whitespace-pre-wrap">{item.notes}</p>}

          {(onEdit || onDelete || onMarkVisited) && (
            <div className="flex flex-wrap gap-2 pt-3 border-t">
              {item.status === 'to_go' && onMarkVisited && (
                <Button variant="outline" size="sm" onClick={onMarkVisited}>
                  <Check className="h-4 w-4 mr-1.5" />
                  Mark Visited
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete
                </Button>
              )}
            </div>
          )}

          <div className="pt-3 border-t space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4" />
              Comments {comments.length > 0 && `(${comments.length})`}
            </h4>

            {loadingComments ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet - say something!</p>
            ) : (
              <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <AnimalAvatar
                      emoji={commenterAvatar(c.user_id)?.avatar_emoji}
                      color={commenterAvatar(c.user_id)?.avatar_color}
                      className="h-7 w-7 shrink-0"
                      emojiClassName="text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{commenterLabel(c.user_id)}</span>
                        <span className="text-xs text-muted-foreground">{formatTimestamp(c.created_at)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{c.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Textarea
                placeholder="Add a comment..."
                className="resize-none min-h-[40px]"
                rows={1}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handlePostComment();
                  }
                }}
              />
              <Button
                size="icon"
                className="shrink-0"
                aria-label="Post comment"
                disabled={posting || !newComment.trim()}
                onClick={handlePostComment}
              >
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
