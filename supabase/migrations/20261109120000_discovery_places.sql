-- CP4: places for Home and Explore's Food / Coffee / Drinks categories.
--
-- get_explore_places only returns places someone has been to ('went_to')
-- and only the stored category string, so the app had too little to tell
-- a café from a bar and never saw saved-to-visit places at all. This adds
-- a NEW function, get_discovery_places, with the evidence the app's
-- classifier (src/lib/placeClassification.ts) needs. get_explore_places is
-- left exactly as it is, so app builds already on phones keep working
-- unchanged, and the new app falls back to it until this is applied.
--
-- What it returns, per place (grouped exactly like get_explore_places: by
-- Apple ID, then the legacy place_id, then the name+address hash - never
-- by name alone):
--
--   * Places people have been to ('went_to'), with the same audience rules
--     as get_explore_places: everyone (or you and the people you follow
--     in 'friends' mode), minus blocked pairs and moderated content.
--     contributor_count, avg_rating and rating_count only ever count these
--     visits - a want-to-go save is never presented as a recommendation.
--   * Places people only want to go to ('to_go'), but ONLY from people the
--     caller may already see under the restaurants read policies: the
--     caller themself, public profiles, and profiles they follow
--     (accepted). A private account's wish list never surfaces, not even
--     as a count. saved_count counts these people (excluding anyone who
--     has also been).
--   * type_names: the My Restaurants types ("Cafe", "Bar", "Brunch") on
--     the place, from the same visible people only - the folders read
--     policies' rule - and only the row owner's own folders. A private
--     account's type names never reach the caller and so can't affect
--     which category a place lands in or how many places a category has.
--   * category: Apple's category from the short-lived place_cache while
--     it is fresh, else the category already stored on the newest row.
--     Nothing new is stored or cached.
--
-- Not included (see docs/DISCOVERY_CATEGORIES.md): notes (per-place, via
-- get_place_comments, as today), custom-list items (needs CP2's per-list
-- visibility first) and two-person shared lists (private to their two
-- members; there is no way to publish them).
--
-- Read-only. Creates one function; changes no table, policy or row.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_discovery_places(p_mode text DEFAULT 'all')
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
  saved_count integer,
  type_names text[],
  apple_place_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH audience AS (
    SELECT
      r.id,
      r.user_id,
      r.name,
      r.address,
      r.latitude,
      r.longitude,
      r.category,
      r.price_level,
      r.rating,
      r.status,
      r.folder_ids,
      r.created_at,
      r.apple_place_id,
      COALESCE(
        NULLIF(btrim(r.apple_place_id), ''),
        NULLIF(btrim(r.place_id), ''),
        'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
      ) AS key,
      -- The restaurants (and folders) read rule: may the caller see this
      -- person's saves directly?
      (
        r.user_id = auth.uid()
        OR NOT COALESCE(p.is_private, false)
        OR EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      ) AS can_see
    FROM public.restaurants r
    JOIN public.profiles p ON p.user_id = r.user_id
    WHERE auth.uid() IS NOT NULL
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
  ),
  eligible AS (
    SELECT
      a.*,
      bool_or(a.status = 'went_to') OVER (PARTITION BY a.key, a.user_id) AS person_went
    FROM audience a
    WHERE a.status = 'went_to'
       OR (a.status = 'to_go' AND a.can_see)
  )
  SELECT
    e.key AS place_id,
    COALESCE(
      (array_agg(pc.name) FILTER (WHERE pc.name IS NOT NULL))[1],
      (array_agg(e.name ORDER BY e.created_at DESC))[1]
    ),
    COALESCE(
      (array_agg(pc.address) FILTER (WHERE pc.address IS NOT NULL))[1],
      (array_agg(e.address ORDER BY e.created_at DESC) FILTER (WHERE e.address IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.latitude) FILTER (WHERE pc.latitude IS NOT NULL))[1],
      (array_agg(e.latitude ORDER BY e.created_at DESC) FILTER (WHERE e.latitude IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.longitude) FILTER (WHERE pc.longitude IS NOT NULL))[1],
      (array_agg(e.longitude ORDER BY e.created_at DESC) FILTER (WHERE e.longitude IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.category) FILTER (WHERE pc.category IS NOT NULL))[1],
      (array_agg(e.category ORDER BY e.created_at DESC) FILTER (WHERE e.category IS NOT NULL))[1]
    ),
    (array_agg(e.price_level ORDER BY e.created_at DESC) FILTER (WHERE e.price_level IS NOT NULL))[1],
    (AVG(e.rating) FILTER (WHERE e.status = 'went_to' AND e.rating IS NOT NULL))::double precision,
    (COUNT(e.rating) FILTER (WHERE e.status = 'went_to' AND e.rating IS NOT NULL))::integer,
    (COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'went_to'))::integer,
    (COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'to_go' AND NOT e.person_went))::integer,
    ARRAY(
      SELECT DISTINCT btrim(fo.name)
      FROM eligible t
      JOIN public.folders fo
        ON fo.id = ANY (t.folder_ids)
       AND fo.user_id = t.user_id
      WHERE t.key = e.key
        AND t.can_see
        AND btrim(fo.name) <> ''
      ORDER BY 1
    ),
    (array_agg(e.apple_place_id) FILTER (WHERE e.apple_place_id IS NOT NULL))[1]
  FROM eligible e
  LEFT JOIN public.place_cache pc
    ON pc.apple_place_id = e.apple_place_id
   AND pc.expires_at > now()
  GROUP BY e.key;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_places(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_discovery_places(text) TO authenticated;
