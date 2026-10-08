-- Moderation that actually takes effect.
--
-- Until now reports were only collected. This migration lets a moderator
-- act on them, and makes those decisions apply everywhere content is read:
--
--   1. Report fields the reporter must not control (status, moderator
--      notes, review time) are forced server-side on insert, and the
--      reported user is taken from the content itself when it's known, so a
--      report can't be pinned on someone who didn't write the content.
--   2. moderation_hidden records hidden content, and restricted accounts
--      (content_type 'user'). Restrictive RLS policies hide those rows from
--      everyone except their owner and moderators, and the SECURITY DEFINER
--      Explore and share-preview functions apply the same check.
--   3. When three different people have open reports on the same piece of
--      content, it is hidden automatically until a moderator reviews it.
--   4. Moderators act through moderation_* functions, which check the role
--      and write an audit trail (moderation_actions).
--   5. content_reports.alerted_at lets the report-alert edge function email
--      each new report to support exactly once.
--
-- Additive and backwards-compatible: existing clients keep working; RPC
-- signatures are unchanged.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_moderator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('moderator', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_moderator() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_moderator() TO authenticated;

-- Who wrote a given piece of content, or NULL if it can't be determined.
CREATE OR REPLACE FUNCTION public.moderation_content_owner(p_type TEXT, p_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_type
    WHEN 'user' THEN p_id
    WHEN 'restaurant' THEN (SELECT x.user_id FROM public.restaurants x WHERE x.id = p_id)
    WHEN 'custom_list' THEN (SELECT x.user_id FROM public.custom_lists x WHERE x.id = p_id)
    WHEN 'custom_list_item' THEN (SELECT x.user_id FROM public.custom_list_items x WHERE x.id = p_id)
    WHEN 'recipe' THEN (SELECT x.user_id FROM public.recipes x WHERE x.id = p_id)
    WHEN 'shared_list_item' THEN (SELECT x.added_by FROM public.shared_list_items x WHERE x.id = p_id)
    WHEN 'comment' THEN (SELECT x.user_id FROM public.shared_list_item_comments x WHERE x.id = p_id)
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.moderation_content_owner(TEXT, UUID) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Server-owned report fields
-- ---------------------------------------------------------------------

ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.content_reports_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    NEW.status := 'pending';
    NEW.moderator_notes := NULL;
    NEW.reviewed_at := NULL;
    NEW.alerted_at := NULL;
    NEW.created_at := now();
  END IF;

  IF NEW.content_id IS NOT NULL AND NEW.content_type IS NOT NULL THEN
    v_owner := public.moderation_content_owner(NEW.content_type, NEW.content_id);
    IF v_owner IS NOT NULL THEN
      NEW.reported_user_id := v_owner;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_reports_before_insert ON public.content_reports;
CREATE TRIGGER content_reports_before_insert
  BEFORE INSERT ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.content_reports_before_insert();

-- ---------------------------------------------------------------------
-- 2. Hidden content and restricted accounts
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.moderation_hidden (
  content_type TEXT NOT NULL CHECK (content_type IN (
    'user', 'restaurant', 'custom_list', 'custom_list_item',
    'recipe', 'shared_list_item', 'comment'
  )),
  content_id UUID NOT NULL,
  owner_id UUID,
  -- 'auto_reports': hidden automatically after repeated reports.
  -- 'moderator': hidden (or account restricted) by a moderator.
  reason TEXT NOT NULL CHECK (reason IN ('auto_reports', 'moderator')),
  hidden_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_hidden_owner ON public.moderation_hidden (owner_id);

ALTER TABLE public.moderation_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Moderators can view hidden content list" ON public.moderation_hidden;
CREATE POLICY "Moderators can view hidden content list"
  ON public.moderation_hidden FOR SELECT
  USING (public.is_moderator());

REVOKE INSERT, UPDATE, DELETE ON public.moderation_hidden FROM anon, authenticated;

-- True if this item, or every item by its owner (a restricted account),
-- has been hidden.
CREATE OR REPLACE FUNCTION public.is_moderation_hidden(p_type TEXT, p_id UUID, p_owner UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.moderation_hidden h
    WHERE (h.content_type = p_type AND h.content_id = p_id)
       OR (h.content_type = 'user' AND h.content_id = p_owner)
  );
$$;

REVOKE ALL ON FUNCTION public.is_moderation_hidden(TEXT, UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.is_moderation_hidden(TEXT, UUID, UUID) TO anon, authenticated;

-- Restrictive policies AND with each table's existing ones: whatever was
-- visible before stays visible, unless it's hidden. Owners still see
-- their own content (so nothing silently disappears for them), and
-- moderators see everything so they can review it.
DROP POLICY IF EXISTS "Hidden restaurants are not shown" ON public.restaurants;
CREATE POLICY "Hidden restaurants are not shown"
  ON public.restaurants AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = user_id
    OR NOT public.is_moderation_hidden('restaurant', id, user_id)
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS "Hidden lists are not shown" ON public.custom_lists;
CREATE POLICY "Hidden lists are not shown"
  ON public.custom_lists AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = user_id
    OR NOT public.is_moderation_hidden('custom_list', id, user_id)
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS "Hidden list items are not shown" ON public.custom_list_items;
CREATE POLICY "Hidden list items are not shown"
  ON public.custom_list_items AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = user_id
    OR NOT (
      public.is_moderation_hidden('custom_list_item', id, user_id)
      OR public.is_moderation_hidden('custom_list', list_id, user_id)
    )
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS "Hidden recipes are not shown" ON public.recipes;
CREATE POLICY "Hidden recipes are not shown"
  ON public.recipes AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = user_id
    OR NOT public.is_moderation_hidden('recipe', id, user_id)
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS "Hidden shared items are not shown" ON public.shared_list_items;
CREATE POLICY "Hidden shared items are not shown"
  ON public.shared_list_items AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = added_by
    OR NOT public.is_moderation_hidden('shared_list_item', id, added_by)
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS "Hidden comments are not shown" ON public.shared_list_item_comments;
CREATE POLICY "Hidden comments are not shown"
  ON public.shared_list_item_comments AS RESTRICTIVE FOR SELECT
  USING (
    auth.uid() = user_id
    OR NOT public.is_moderation_hidden('comment', id, user_id)
    OR public.is_moderator()
  );

-- ---------------------------------------------------------------------
-- 3. Automatic hiding after repeated reports
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.content_reports_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reporters INTEGER;
BEGIN
  -- Only individual pieces of content are hidden automatically. Accounts
  -- are only ever restricted by a person, because a group could otherwise
  -- silence someone by reporting them together.
  IF NEW.content_id IS NULL OR NEW.content_type NOT IN (
    'restaurant', 'custom_list', 'custom_list_item', 'recipe', 'shared_list_item', 'comment'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(DISTINCT r.reporter_id) INTO v_reporters
  FROM public.content_reports r
  WHERE r.content_type = NEW.content_type
    AND r.content_id = NEW.content_id
    AND r.status IN ('pending', 'reviewing');

  IF v_reporters >= 3 THEN
    INSERT INTO public.moderation_hidden (content_type, content_id, owner_id, reason)
    VALUES (NEW.content_type, NEW.content_id, NEW.reported_user_id, 'auto_reports')
    ON CONFLICT (content_type, content_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_reports_after_insert ON public.content_reports;
CREATE TRIGGER content_reports_after_insert
  AFTER INSERT ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.content_reports_after_insert();

-- ---------------------------------------------------------------------
-- 4. Moderator actions and audit trail
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.content_reports(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('dismiss', 'hide', 'unhide', 'restrict', 'unrestrict')),
  content_type TEXT,
  content_id UUID,
  target_user_id UUID,
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Moderators can view the audit trail" ON public.moderation_actions;
CREATE POLICY "Moderators can view the audit trail"
  ON public.moderation_actions FOR SELECT
  USING (public.is_moderator());

REVOKE INSERT, UPDATE, DELETE ON public.moderation_actions FROM anon, authenticated;

-- The queue, with what a moderator needs to decide: who reported whom,
-- a preview of the content, whether it's hidden, and the account's
-- report history.
CREATE OR REPLACE FUNCTION public.moderation_list_reports(p_status TEXT DEFAULT 'open', p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(q)::jsonb ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      r.id,
      r.created_at,
      r.status,
      r.reason,
      r.description,
      r.content_type,
      r.content_id,
      r.moderator_notes,
      r.reviewed_at,
      r.reporter_id,
      rp.username AS reporter_username,
      r.reported_user_id,
      tp.username AS reported_username,
      tp.display_name AS reported_display_name,
      (SELECT count(*) FROM public.content_reports r2 WHERE r2.reported_user_id = r.reported_user_id)
        AS total_reports_against_user,
      EXISTS (
        SELECT 1 FROM public.moderation_hidden h
        WHERE h.content_type = r.content_type AND h.content_id = r.content_id
      ) AS content_hidden,
      (SELECT h.reason FROM public.moderation_hidden h
        WHERE h.content_type = r.content_type AND h.content_id = r.content_id) AS hidden_reason,
      EXISTS (
        SELECT 1 FROM public.moderation_hidden h
        WHERE h.content_type = 'user' AND h.content_id = r.reported_user_id
      ) AS user_restricted,
      CASE r.content_type
        WHEN 'restaurant' THEN (SELECT jsonb_build_object('title', x.name, 'text', x.notes) FROM public.restaurants x WHERE x.id = r.content_id)
        WHEN 'custom_list' THEN (SELECT jsonb_build_object('title', x.name, 'text', NULL) FROM public.custom_lists x WHERE x.id = r.content_id)
        WHEN 'custom_list_item' THEN (SELECT jsonb_build_object('title', x.name, 'text', x.notes) FROM public.custom_list_items x WHERE x.id = r.content_id)
        WHEN 'recipe' THEN (SELECT jsonb_build_object('title', x.title, 'text', x.description) FROM public.recipes x WHERE x.id = r.content_id)
        WHEN 'shared_list_item' THEN (SELECT jsonb_build_object('title', x.name, 'text', x.notes) FROM public.shared_list_items x WHERE x.id = r.content_id)
        WHEN 'comment' THEN (SELECT jsonb_build_object('title', 'Comment', 'text', x.comment) FROM public.shared_list_item_comments x WHERE x.id = r.content_id)
        ELSE (SELECT jsonb_build_object('title', COALESCE(p.display_name, p.username), 'text', p.bio) FROM public.profiles p WHERE p.user_id = r.reported_user_id)
      END AS content_preview
    FROM public.content_reports r
    LEFT JOIN public.profiles rp ON rp.user_id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.user_id = r.reported_user_id
    WHERE (p_status = 'open' AND r.status IN ('pending', 'reviewing'))
       OR (p_status = 'closed' AND r.status IN ('actioned', 'dismissed'))
       OR (p_status = 'all')
    ORDER BY r.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  ) q;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.moderation_list_reports(TEXT, INTEGER) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.moderation_list_reports(TEXT, INTEGER) TO authenticated;

-- One decision on one report.
--   dismiss    - nothing wrong; the report closes, and content that was
--                hidden only automatically is shown again.
--   hide       - hide the reported content; closes every open report on it.
--   unhide     - show hidden content again.
--   restrict   - hide everything the reported account has posted; closes
--                every open report against that account.
--   unrestrict - lift an account restriction.
CREATE OR REPLACE FUNCTION public.moderation_decide(p_report_id UUID, p_action TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.content_reports%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('dismiss', 'hide', 'unhide', 'restrict', 'unrestrict') THEN
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.content_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'dismiss' THEN
    UPDATE public.content_reports
       SET status = 'dismissed', reviewed_at = now(), moderator_notes = COALESCE(v_note, moderator_notes)
     WHERE id = p_report_id;
    -- If nothing else is still open against this content, undo an
    -- automatic hide: a moderator has looked and found it acceptable.
    IF v_report.content_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.content_reports r
      WHERE r.content_type = v_report.content_type AND r.content_id = v_report.content_id
        AND r.status IN ('pending', 'reviewing') AND r.id <> p_report_id
    ) THEN
      DELETE FROM public.moderation_hidden
       WHERE content_type = v_report.content_type AND content_id = v_report.content_id
         AND reason = 'auto_reports';
    END IF;

  ELSIF p_action = 'hide' THEN
    IF v_report.content_id IS NULL OR v_report.content_type NOT IN (
      'restaurant', 'custom_list', 'custom_list_item', 'recipe', 'shared_list_item', 'comment'
    ) THEN
      RAISE EXCEPTION 'this report has no content that can be hidden' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.moderation_hidden (content_type, content_id, owner_id, reason, hidden_by)
    VALUES (v_report.content_type, v_report.content_id, v_report.reported_user_id, 'moderator', auth.uid())
    ON CONFLICT (content_type, content_id) DO UPDATE
      SET reason = 'moderator', hidden_by = auth.uid(), created_at = now();
    UPDATE public.content_reports
       SET status = 'actioned', reviewed_at = now(),
           moderator_notes = CASE WHEN id = p_report_id THEN COALESCE(v_note, moderator_notes) ELSE moderator_notes END
     WHERE content_type = v_report.content_type AND content_id = v_report.content_id
       AND (status IN ('pending', 'reviewing') OR id = p_report_id);

  ELSIF p_action = 'unhide' THEN
    DELETE FROM public.moderation_hidden
     WHERE content_type = v_report.content_type AND content_id = v_report.content_id;

  ELSIF p_action = 'restrict' THEN
    INSERT INTO public.moderation_hidden (content_type, content_id, owner_id, reason, hidden_by)
    VALUES ('user', v_report.reported_user_id, v_report.reported_user_id, 'moderator', auth.uid())
    ON CONFLICT (content_type, content_id) DO UPDATE
      SET reason = 'moderator', hidden_by = auth.uid(), created_at = now();
    UPDATE public.content_reports
       SET status = 'actioned', reviewed_at = now(),
           moderator_notes = CASE WHEN id = p_report_id THEN COALESCE(v_note, moderator_notes) ELSE moderator_notes END
     WHERE reported_user_id = v_report.reported_user_id
       AND (status IN ('pending', 'reviewing') OR id = p_report_id);

  ELSIF p_action = 'unrestrict' THEN
    DELETE FROM public.moderation_hidden
     WHERE content_type = 'user' AND content_id = v_report.reported_user_id;
  END IF;

  INSERT INTO public.moderation_actions (moderator_id, report_id, action, content_type, content_id, target_user_id, note)
  VALUES (auth.uid(), p_report_id, p_action, v_report.content_type, v_report.content_id, v_report.reported_user_id, v_note);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.moderation_decide(UUID, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.moderation_decide(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Explore and share previews respect moderation
-- ---------------------------------------------------------------------
-- Same definitions as 20261008140000 (places, comments, previews) and
-- 20261004120000 (lists), with one added condition each.

CREATE OR REPLACE FUNCTION public.get_explore_places(p_mode text DEFAULT 'all')
RETURNS TABLE (
  place_id text,
  name text,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  price_level integer,
  avg_rating double precision,
  rating_count integer,
  contributor_count integer,
  apple_place_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      NULLIF(btrim(r.apple_place_id), ''),
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) AS place_id,
    COALESCE(
      (array_agg(pc.name) FILTER (WHERE pc.name IS NOT NULL))[1],
      (array_agg(r.name ORDER BY r.created_at DESC))[1]
    ),
    COALESCE(
      (array_agg(pc.address) FILTER (WHERE pc.address IS NOT NULL))[1],
      (array_agg(r.address ORDER BY r.created_at DESC) FILTER (WHERE r.address IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.latitude) FILTER (WHERE pc.latitude IS NOT NULL))[1],
      (array_agg(r.latitude ORDER BY r.created_at DESC) FILTER (WHERE r.latitude IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.longitude) FILTER (WHERE pc.longitude IS NOT NULL))[1],
      (array_agg(r.longitude ORDER BY r.created_at DESC) FILTER (WHERE r.longitude IS NOT NULL))[1]
    ),
    (array_agg(r.category ORDER BY r.created_at DESC) FILTER (WHERE r.category IS NOT NULL))[1],
    (array_agg(r.price_level ORDER BY r.created_at DESC) FILTER (WHERE r.price_level IS NOT NULL))[1],
    (AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL))::double precision,
    (COUNT(r.rating) FILTER (WHERE r.rating IS NOT NULL))::integer,
    (COUNT(DISTINCT r.user_id))::integer,
    (array_agg(r.apple_place_id) FILTER (WHERE r.apple_place_id IS NOT NULL))[1]
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  LEFT JOIN public.place_cache pc
    ON pc.apple_place_id = r.apple_place_id
   AND pc.expires_at > now()
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND (
      r.apple_place_id IS NOT NULL
      OR (r.address IS NOT NULL AND btrim(r.address) <> '')
    )
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
    AND NOT public.is_moderation_hidden('restaurant', r.id, r.user_id)
    AND (
      r.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_explore_places(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_places(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_place_comments(p_place_id text, p_mode text DEFAULT 'all')
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  rating integer,
  notes text,
  created_at timestamptz,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN v.can_see THEN r.user_id END,
    CASE WHEN v.can_see THEN p.username END,
    CASE WHEN v.can_see THEN p.display_name END,
    CASE WHEN v.can_see THEN p.avatar_emoji END,
    CASE WHEN v.can_see THEN p.avatar_color END,
    r.rating,
    CASE WHEN v.can_see THEN r.notes END,
    r.created_at,
    NOT v.can_see AS is_anonymous
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  CROSS JOIN LATERAL (
    SELECT (
      r.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = r.user_id
          AND f.status = 'accepted'
      )
    ) AS can_see
  ) v
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND (
      r.apple_place_id IS NOT NULL
      OR (r.address IS NOT NULL AND btrim(r.address) <> '')
    )
    AND COALESCE(
      NULLIF(btrim(r.apple_place_id), ''),
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) = p_place_id
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
    AND NOT public.is_moderation_hidden('restaurant', r.id, r.user_id)
    AND (
      r.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_place_comments(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_place_comments(text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_explore_lists(p_mode text DEFAULT 'all')
RETURNS TABLE (
  list_id uuid,
  list_name text,
  list_icon text,
  item_count integer,
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.icon,
    COUNT(i.id)::integer,
    l.user_id,
    p.username,
    p.display_name,
    p.avatar_emoji,
    p.avatar_color,
    false
  FROM public.custom_lists l
  JOIN public.profiles p ON p.user_id = l.user_id
  JOIN public.custom_list_items i ON i.list_id = l.id
  WHERE auth.uid() IS NOT NULL
    AND NOT public.is_blocked_pair(auth.uid(), l.user_id)
    AND NOT public.is_moderation_hidden('custom_list', l.id, l.user_id)
    AND (
      l.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = l.user_id
          AND f.status = 'accepted'
      )
    )
    AND (
      l.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = l.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY l.id, l.name, l.icon, l.user_id, p.username, p.display_name, p.avatar_emoji, p.avatar_color
  ORDER BY MAX(i.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_explore_lists(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_lists(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_shared_preview(p_type TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_owner UUID;
BEGIN
  IF p_type = 'restaurant' THEN
    SELECT
      jsonb_build_object(
        'type', 'restaurant',
        'id', r.id,
        'name', r.name,
        'address', r.address,
        'category', r.category,
        'rating', r.rating,
        'price_level', r.price_level,
        'status', r.status,
        'latitude', r.latitude,
        'longitude', r.longitude,
        'place_id', r.place_id,
        'apple_place_id', r.apple_place_id
      ),
      r.user_id
    INTO v_result, v_owner
    FROM public.restaurants r
    JOIN public.profiles p ON p.user_id = r.user_id
    WHERE r.id = p_id AND p.is_private = false
      AND NOT public.is_moderation_hidden('restaurant', r.id, r.user_id);

  ELSIF p_type = 'recipe' THEN
    SELECT
      jsonb_build_object(
        'type', 'recipe',
        'id', x.id,
        'title', x.title,
        'description', x.description,
        'prep_time_minutes', x.prep_time_minutes,
        'cook_time_minutes', x.cook_time_minutes,
        'servings', x.servings,
        'difficulty', x.difficulty,
        'cook_temp', x.cook_temp,
        'cook_temp_unit', x.cook_temp_unit,
        'ingredients', x.ingredients,
        'instructions', x.instructions,
        'tags', x.tags,
        'image_url', x.image_url
      ),
      x.user_id
    INTO v_result, v_owner
    FROM public.recipes x
    WHERE x.id = p_id AND x.is_public = true
      AND NOT public.is_moderation_hidden('recipe', x.id, x.user_id);

  ELSIF p_type = 'custom_list' THEN
    SELECT
      jsonb_build_object(
        'type', 'custom_list',
        'id', l.id,
        'name', l.name,
        'icon', l.icon,
        'color', l.color,
        'item_count', (SELECT count(*) FROM public.custom_list_items i WHERE i.list_id = l.id),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', i.name,
            'address', i.address,
            'apple_place_id', i.apple_place_id
          ))
          FROM (
            SELECT ci.name, ci.address, ci.apple_place_id FROM public.custom_list_items ci
            WHERE ci.list_id = l.id
              AND NOT public.is_moderation_hidden('custom_list_item', ci.id, ci.user_id)
            ORDER BY ci.created_at DESC
            LIMIT 12
          ) i
        ), '[]'::jsonb)
      ),
      l.user_id
    INTO v_result, v_owner
    FROM public.custom_lists l
    JOIN public.profiles p ON p.user_id = l.user_id
    WHERE l.id = p_id AND p.is_private = false
      AND NOT public.is_moderation_hidden('custom_list', l.id, l.user_id);

  ELSE
    RETURN NULL;
  END IF;

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  -- A signed-in viewer who has blocked the owner, or been blocked by
  -- them, gets nothing - the same outcome the block policies give them
  -- everywhere else.
  IF auth.uid() IS NOT NULL AND public.is_blocked_pair(auth.uid(), v_owner) THEN
    RETURN NULL;
  END IF;

  RETURN v_result || jsonb_build_object(
    'owner', (
      SELECT jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'username', p.username,
        'avatar_emoji', p.avatar_emoji,
        'avatar_color', p.avatar_color
      )
      FROM public.profiles p
      WHERE p.user_id = v_owner
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_preview(TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_preview(TEXT, UUID) TO anon, authenticated;