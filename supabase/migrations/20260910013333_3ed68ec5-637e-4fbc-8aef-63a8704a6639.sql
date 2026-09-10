CREATE TABLE public.custom_list_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_list_statuses_list_id ON public.custom_list_statuses(list_id);
CREATE INDEX idx_custom_list_statuses_user_id ON public.custom_list_statuses(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_statuses TO authenticated;
GRANT ALL ON public.custom_list_statuses TO service_role;

ALTER TABLE public.custom_list_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own list statuses"
  ON public.custom_list_statuses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view list statuses of public profiles"
  ON public.custom_list_statuses FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_list_statuses.user_id AND p.is_private = false));

CREATE POLICY "Users can view list statuses of people they follow"
  ON public.custom_list_statuses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_list_statuses.user_id AND f.status = 'accepted'
  ));

CREATE POLICY "Users can insert their own list statuses"
  ON public.custom_list_statuses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own list statuses"
  ON public.custom_list_statuses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own list statuses"
  ON public.custom_list_statuses FOR DELETE
  USING (auth.uid() = user_id);

ALTER TABLE public.custom_list_items ADD COLUMN status_id UUID REFERENCES public.custom_list_statuses(id) ON DELETE SET NULL;
CREATE INDEX idx_custom_list_items_status_id ON public.custom_list_items(status_id);

DO $$
DECLARE
  list_row RECORD;
  todo_id UUID;
  done_id UUID;
BEGIN
  FOR list_row IN SELECT id, user_id, status_todo_label, status_done_label FROM public.custom_lists LOOP
    INSERT INTO public.custom_list_statuses (list_id, user_id, name, sort_order)
    VALUES (list_row.id, list_row.user_id, list_row.status_todo_label, 0)
    RETURNING id INTO todo_id;

    INSERT INTO public.custom_list_statuses (list_id, user_id, name, sort_order)
    VALUES (list_row.id, list_row.user_id, list_row.status_done_label, 1)
    RETURNING id INTO done_id;

    UPDATE public.custom_list_items
    SET status_id = CASE WHEN status = 'done' THEN done_id ELSE todo_id END
    WHERE list_id = list_row.id;
  END LOOP;
END $$;