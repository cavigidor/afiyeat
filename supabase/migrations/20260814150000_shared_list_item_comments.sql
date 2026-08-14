-- Per-item comment thread for Shared Lists, so both members of a shared
-- list can discuss a specific place ("I already went, get the fries")
-- without that showing up anywhere else (not the Explore place-comments
-- RPC, not My Restaurants) - a completely separate, narrowly-scoped table.
--
-- list_id is denormalized onto the comment row (rather than requiring a
-- join through shared_list_items to find it) purely so the existing
-- is_shared_list_member(list_id, uid) helper from
-- 20260609022202_...sql can be reused directly in the RLS policies below.
CREATE TABLE public.shared_list_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.shared_list_items(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shared_list_item_comments_item_id ON public.shared_list_item_comments(item_id);
CREATE INDEX idx_shared_list_item_comments_list_id ON public.shared_list_item_comments(list_id);

GRANT SELECT, INSERT, DELETE ON public.shared_list_item_comments TO authenticated;
GRANT ALL ON public.shared_list_item_comments TO service_role;

ALTER TABLE public.shared_list_item_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view item comments"
  ON public.shared_list_item_comments FOR SELECT
  TO authenticated
  USING (public.is_shared_list_member(list_id, auth.uid()));

CREATE POLICY "Members can add item comments"
  ON public.shared_list_item_comments FOR INSERT
  TO authenticated
  WITH CHECK (public.is_shared_list_member(list_id, auth.uid()) AND user_id = auth.uid());

CREATE POLICY "Users can delete their own item comments"
  ON public.shared_list_item_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
