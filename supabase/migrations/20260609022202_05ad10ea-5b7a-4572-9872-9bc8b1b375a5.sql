CREATE TABLE public.shared_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_lists TO authenticated;
GRANT ALL ON public.shared_lists TO service_role;

ALTER TABLE public.shared_lists ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_shared_list_member(_list_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_lists
    WHERE id = _list_id AND (_user_id = user_a OR _user_id = user_b)
  )
$$;

CREATE POLICY "Members can view their shared lists"
  ON public.shared_lists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Users can create shared lists they belong to"
  ON public.shared_lists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_a AND user_a <> user_b);

CREATE POLICY "Members can update their shared lists"
  ON public.shared_lists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b)
  WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Members can delete their shared lists"
  ON public.shared_lists FOR DELETE
  TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE TABLE public.shared_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  added_by uuid NOT NULL,
  name text NOT NULL,
  address text,
  latitude double precision,
  longitude double precision,
  status text NOT NULL DEFAULT 'to_go',
  rating integer CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
  price_level integer CHECK (price_level IS NULL OR (price_level >= 1 AND price_level <= 4)),
  notes text,
  visited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_list_items TO authenticated;
GRANT ALL ON public.shared_list_items TO service_role;

ALTER TABLE public.shared_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shared list items"
  ON public.shared_list_items FOR SELECT
  TO authenticated
  USING (public.is_shared_list_member(list_id, auth.uid()));

CREATE POLICY "Members can add shared list items"
  ON public.shared_list_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_shared_list_member(list_id, auth.uid()) AND added_by = auth.uid());

CREATE POLICY "Members can update shared list items"
  ON public.shared_list_items FOR UPDATE
  TO authenticated
  USING (public.is_shared_list_member(list_id, auth.uid()))
  WITH CHECK (public.is_shared_list_member(list_id, auth.uid()));

CREATE POLICY "Members can delete shared list items"
  ON public.shared_list_items FOR DELETE
  TO authenticated
  USING (public.is_shared_list_member(list_id, auth.uid()));

CREATE TRIGGER update_shared_lists_updated_at
  BEFORE UPDATE ON public.shared_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shared_list_items_updated_at
  BEFORE UPDATE ON public.shared_list_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();