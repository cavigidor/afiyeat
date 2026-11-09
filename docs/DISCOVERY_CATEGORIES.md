# Discovery categories (CP4)

How Home and Explore decide what is Food & Restaurants, Coffee & Cafés or Bars & Drinks.

## One rule everywhere

`placesForSelection()` in `src/lib/discovery.ts` is the only category filter. Home's tiles link to `/explore?c=<id>`, and Explore's chips, list, map and "Most visited" rail all read the same array. Events is unchanged (Ticketmaster, not places).

## Classifier (`src/lib/placeClassification.ts`)

Deterministic, no AI, no network. Each allowed piece of text is matched against one dictionary (`TERMS`). Every match is evidence:

| Level | Source | Weight |
|---|---|---|
| 1 | Venue category (Apple POI category, or older stored category) | 100 |
| 2 | Type someone chose (My Restaurants types like Cafe / Bar / Brunch) | 80 |
| 3 | Venue name ("Intelligentsia Coffee", "Hopewell Taproom") | 60 |
| 4 | Discoverable list title | 25 |
| 5 | Authorised notes | 10 |

- A category's score is the sum of the **best** match from each source, so a source can't stack with itself. A category qualifies at **50**. List titles and notes together (35) can never qualify a place on their own.
- Ambiguous words ("bar", "lounge", "kitchen", "wine", cuisines like "Italian") count fully as a venue category or chosen type, but only half in names, titles and notes.
- Phrases match longest-first and consume their words: "Sushi Bar" is Food only; "Espresso Bar" is Coffee; "Coffee Table", "Candy Bar", "Juice Bar" match nothing.
- Normalisation: accents stripped (Café, caffè, Lokantası), CamelCase split (FoodMarket), `&` = and, plurals singularised, whole words only ("bar" never matches barbecue).
- A place can be in several categories (a café tagged Brunch is Coffee and Food; a restaurant tagged Bar is Food and Drinks). Categories are ordered by the source of their best evidence, then score.
- **Unknown is not Food.** A venue category recognised as something else (Museum, Store, Hotel...) blocks names/titles/notes; only a chosen type can still place it. An unrecognised category puts the place in no category (still visible under All).
- The single fallback: a My Restaurants place with **no category at all** and nothing else qualifying counts as Food (the person saved it to their restaurant list). Never for custom lists, never for an unrecognised category, never alongside another category.
- Overlap rules: Apple Cafe = Coffee only unless food evidence; Bakery and FoodMarket = Food (scored below a restaurant); Brewery / Winery / Distillery / Nightlife = Drinks; gastropub, brewpub, izakaya, meyhane, "bar and grill" = Food and Drinks.

Every result carries `categories`, `strongest` evidence, a `tier` per category (1-6, used for ranking) and a one-line `reason`.

## Ranking within a category

1. Places people have been to before want-to-go-only places (a save is not a recommendation).
2. Match tier (venue category > type > name > ...).
3. People who have been, 4. average rating, 5. people who want to go, 6. name, 7. id.

Explore's list shows **Been there** and **Saved to visit** separately. Want-to-go places show "Not visited yet · N want to go", never a visit count, and never appear in Home's Popular row or Explore's "Most visited".

## Data sources

New function `get_discovery_places` (migration `20261109120000_discovery_places.sql`, **not applied**). `get_explore_places` is unchanged so app builds already on phones behave exactly as before; the new app falls back to it until the migration is applied (classification still improves, without types or want-to-go places).

| Source | In discovery? |
|---|---|
| My Restaurants, been to | Yes, as today (everyone / friends, blocks and moderation applied) |
| My Restaurants, want to go | Yes, only from people the viewer may already see (self, public profiles, accepted follows). A private account's wish list never appears, not even as a count |
| My Restaurants types (folders) | Names only, from the same visible people, and only the row owner's own folders |
| Venue category | Apple's fresh `place_cache` entry first, else the category already stored on the row. Nothing new stored or cached |
| Notes | Not sent in bulk (still per place via `get_place_comments`). The classifier supports them as weak evidence |
| Custom-list places | **Blocked on CP2** (PR #8): needs per-list visibility so private/anonymous lists can't leak |
| Two-person shared lists | Not included: private to their two members, no publication mechanism |

## After CP2 merges (follow-up)

Add custom-list items to `get_discovery_places` (or a sibling function) behind `can_view_custom_list` / `visibility = 'profile'`, requiring a location (`apple_place_id`, address or coordinates) so books and other non-places never enter. Pass them to `classifyPlace` with `collection: 'custom_list'` (no Food fallback), the list's type names as `placeTypes` and the list title as `listTitles`, and merge with My Restaurants rows by Apple place ID only.

## Adding words

Add to `TERMS`, then add a fixture to `tests/fixtures/discoveryPlaces.ts`. The fixture evaluation test fails on any new false positive or negative.
