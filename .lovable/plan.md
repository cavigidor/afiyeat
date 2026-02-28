

## Auto-Backfill Map Images on My List Load

When the My List page loads, automatically invoke the `backfill-map-images` edge function in the background -- no button needed.

### Changes

**`src/pages/MyList.tsx`**
- Add a `useEffect` that runs once after the user is authenticated and restaurants are loaded
- Call `supabase.functions.invoke('backfill-map-images')` silently in the background
- On success (if any images were generated), re-fetch the restaurant list to show the new map previews
- Use a ref to ensure it only runs once per session (avoid repeated calls on re-renders)
- No loading indicator or button -- completely invisible to the user

**`src/pages/Dashboard.tsx`**
- Remove the backfill button and `useBackfillMapImages` hook that were added previously, since they are no longer needed

### Technical Details

```text
Page Load -> Auth check -> Fetch restaurants -> 
  useEffect fires once -> invoke('backfill-map-images') ->
    if generated > 0 -> fetchData() to refresh list
```

- A `hasBackfilled` ref prevents duplicate calls
- Errors are logged to console silently (no user-facing toast)
- The function already handles auth and only processes restaurants missing images, so it's safe to call on every page load

