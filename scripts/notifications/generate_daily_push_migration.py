"""Generates the daily-notification migration from the message lists below,
so the copy can be edited in one place and the numbering can't drift.

  python3 scripts/notifications/generate_daily_push_migration.py \
    scripts/notifications/daily_push_migration.template.sql \
    supabase/migrations/20261118120000_good_morning_fun_facts_and_city_explore.sql \
    supabase/tests/daily-notifications/messages.json
"""
import sys

animals = [
    "Octopuses have three hearts and blue blood.",
    "A group of flamingos is called a flamboyance.",
    "Wombats poop in little cubes, which helps the droppings stay put on rocks and logs.",
    "Koala fingerprints are so similar to ours that they can be hard to tell apart, even under a microscope.",
    "Butterflies taste with their feet.",
    "Crows can recognize individual human faces and remember them for years.",
    "Dolphins use signature whistles that work a lot like names.",
    "A shrimp's heart is in its head.",
    "Owls can't move their eyes, so they turn their heads up to 270 degrees instead.",
    "Male seahorses are the ones who carry the babies and give birth.",
    "Giraffes have seven neck bones - the same number as you.",
    "Sharks have been around longer than trees.",
    "Polar bears have black skin, and their fur isn't really white - each hair is see-through.",
    "Sea otters sometimes hold paws while they sleep so they don't drift apart.",
    "Axolotls can regrow lost legs, and even parts of their heart and brain.",
]

world = [
    "Australia is wider than the Moon.",
    "Canada has more lakes than the rest of the world combined.",
    "There's a village in Norway called Hell, and it freezes over most winters.",
    "Istanbul sits on two continents at once: Europe and Asia.",
    "The world's shortest scheduled flight, between two Scottish islands, takes about 90 seconds.",
    "Oxford University is older than the Aztec Empire.",
    "France spans 12 time zones, more than any other country, thanks to its overseas territories.",
    "Lake Baikal in Siberia holds roughly a fifth of all the unfrozen fresh surface water on Earth.",
    "The Eiffel Tower grows up to about 15 cm (6 inches) taller in summer as its iron expands.",
    "Around 6,000 years ago the Sahara was green, with lakes, grasslands and hippos.",
    "Alaska is the most northern, western and eastern US state all at once.",
    "Russia stretches across 11 time zones.",
    "Vatican City is the smallest country in the world - smaller than many city parks.",
    "The Dead Sea is so salty that you float without even trying.",
    "More than a third of everyone on Earth lives in just two countries: India and China.",
]

nature = [
    "Bananas are berries, but strawberries aren't.",
    "A bolt of lightning can be about five times hotter than the surface of the Sun.",
    "Some kinds of bamboo can grow nearly 90 cm (3 feet) in a single day.",
    "There are more trees on Earth (about 3 trillion) than stars in the Milky Way.",
    "Rainbows are actually full circles. From the ground, the horizon hides the bottom half.",
    "Sealed honey can last for thousands of years - pots of it have turned up in ancient Egyptian tombs.",
    "A pineapple plant takes about two years to grow a single pineapple.",
    "Snowflakes almost always have six sides or six arms.",
    "Young sunflowers follow the Sun across the sky all day, then turn back east overnight.",
    "Most of the ocean floor still hasn't been mapped in high detail.",
    "Forgetful squirrels help plant forests: some of the nuts they bury and never dig up sprout into trees.",
    "Peanuts aren't nuts - they're legumes, like beans and peas.",
    "One of the oldest known living trees, a bristlecone pine in California, is over 4,800 years old.",
    "Coral reefs cover less than 1% of the ocean floor but are home to about a quarter of all ocean species.",
    "Venus flytraps can count: they only snap shut after their trigger hairs are touched twice.",
]

space = [
    "A day on Venus is longer than its whole year.",
    "A teaspoon of neutron star would weigh about a billion tons on Earth.",
    "The footprints on the Moon could last for millions of years - there's no wind to blow them away.",
    "Sunlight takes about 8 minutes to reach Earth, so you always see the Sun as it was 8 minutes ago.",
    "Saturn is less dense than water. In a big enough bathtub, it would float.",
    "Astronauts say space smells like seared steak, hot metal and welding fumes.",
    "Jupiter's Great Red Spot is a storm that's bigger than Earth.",
    "About 1.3 million Earths could fit inside the Sun.",
    "The Space Station circles Earth every 90 minutes or so, so astronauts see about 16 sunrises a day.",
    "Olympus Mons, a volcano on Mars, is about two and a half times taller than Mount Everest.",
    "Uranus spins on its side, tipped over at about 98 degrees.",
    "Sunsets on Mars glow blue.",
    "Halley's Comet swings past Earth about every 76 years. Its next visit is in 2061.",
    "Astronomers estimate there are more stars in the universe than grains of sand on all of Earth's beaches.",
    "Earth isn't a perfect ball - it bulges at the equator because it spins.",
]

cats = [
    ("🐾", animals),
    ("🌍", world),
    ("🌿", nature),
    ("🚀", space),
]
assert all(len(c[1]) == 15 for c in cats)
# Interleaved animal, world, nature, space, animal, ... so the topic changes
# every day and each fact appears once per 60-day cycle.
facts = []
for i in range(15):
    for emoji, lst in cats:
        facts.append(("Good morning!", f"{emoji} {lst[i]}"))

# 5pm: evening city exploring. Restaurants and cafés can appear as places
# to explore, but nothing here is a food-only nudge. Kept separate from the
# 8am set so the same idea never lands twice in one day.
evening_explore = [
    ("Be a tourist at home", "Pick one spot in your city you've never been to and go this week."),
    ("Golden hour is coming", "Find a park, rooftop or riverside spot with a view and catch the sunset."),
    ("Take the long way", "Walk a street you've never walked. The best finds hide one block over."),
    ("Museum mood", "Lots of museums have free or late nights. See what's on near you this week."),
    ("Night market hunt", "Night markets, food halls, late bazaars - find one and wander through."),
    ("New neighborhood unlocked", "Pick a neighborhood you only know by name and spend an evening there."),
    ("Bookstore wander", "Get lost in an indie bookstore. Leave with something you didn't plan on."),
    ("Hidden green", "Your city has a park you've never set foot in. Go find it."),
    ("What's on tonight?", "Live music, comedy, a gallery opening - see what's happening near you."),
    ("Look up", "On your next walk, look above street level. Old signs, murals and rooftops are everywhere."),
    ("Ride somewhere new", "Take a bus or train line you never use and hop off somewhere new."),
    ("Street art safari", "Hunt down a mural or two in your city, then add a spot nearby to your list."),
    ("Waterfront walk", "River, lake or harbor - head to the water and take a slow lap."),
    ("Neon & signs", "Find the best old neon sign in your city. Evenings are when they shine."),
    ("Ferry, tram or cable car", "If your city has one, ride it at dusk just for the view."),
    ("Say yes to the detour", "That spot you pass on your commute? Today's the day you stop in."),
    ("After-dark stroll", "Some streets look completely different lit up. Take an evening walk somewhere new."),
    ("Window shopping, upgraded", "Wander a street of small shops you've never browsed."),
    ("Evening picnic", "Grab something from a local deli or bakery and eat it in a park."),
    ("New café, new corner", "Try a café in a part of town you never visit. Grab a window seat and people-watch."),
    ("Dinner in a new neighborhood", "Pick a restaurant somewhere you've never explored and make an evening of it."),
    ("Live music check", "Find a small venue with live music this week. Jazz, open mic, anything goes."),
    ("Rooftop hunt", "Rooftops, terraces, top-floor cafés - find a high spot for tonight's sky."),
    ("Stargazing spot", "Find a park away from the brightest city lights and look up after dark."),
    ("Main street, new town", "Walk the main street of a neighborhood you only know from the car window."),
    ("Late sweet stop", "Track down a dessert shop open late in a part of town you rarely visit."),
    ("Bridge at dusk", "Walk across a bridge in your city around sunset. The view is usually worth it."),
    ("Cinema night", "Find an independent cinema or an outdoor screening near you."),
    ("Small stages", "Small theaters and comedy clubs are local treasures. See what's on this week."),
    ("Tea house hideaway", "Find a quiet tea house or café you've never been to and take the evening slow."),
    ("City lights", "Head somewhere known for its lights - a skyline view, a lit-up square, a busy avenue."),
    ("Weekend explore plan", "Pick one neighborhood for the weekend and save three spots there on Afiyeat."),
    ("Food hall wander", "A food hall is a whole neighborhood under one roof. Go explore one."),
    ("Plaza people-watching", "Find a busy square, grab a bench and watch the city go by."),
    ("Off the main road", "Every city has a spot down an alley or up a staircase. Go find one."),
    ("Festival check", "Fairs and street festivals pop up all year. See if one's on near you."),
    ("Evening market", "Some markets come alive after work. Find one and browse with no plan."),
    ("Historic quarter at night", "Old town, historic district, cobbled lane - they glow after dark. Go see."),
    ("Ask the locals", "Ask someone who lives nearby for their favorite hidden spot, then go this week."),
    ("Save your find", "Explored somewhere new today? Save it on Afiyeat so you can find it again."),
]
assert len(evening_explore) == 40

# 8am: city exploring only, "today" flavoured. Kept separate from the 5pm
# explore set so the same idea never lands twice in one day.
morning_explore = [
    ("Today's mini adventure", "Pick one street, park or shop you've never been to and check it out today."),
    ("New route, new finds", "Take a different way to wherever you're going today. See what you spot."),
    ("Coffee with a view", "Grab a coffee somewhere new and drink it outside."),
    ("Explore like a local", "Ask a barista or shop owner for their favorite spot nearby, then go."),
    ("Free is fun", "Free museums, parks, public gardens - your city has more free stuff than you think."),
    ("Garden check", "Look up a botanical or community garden near you. Perfect for a slow morning."),
    ("Library field trip", "Big city libraries are often stunning buildings. Go take a look inside."),
    ("Climb for the view", "Find the highest point in your city - a hill, a tower, a top-floor café - and look out."),
    ("Neighborhood bingo", "Walk through a neighborhood you've never visited. Bonus points for a new café."),
    ("Sunset plans", "Pick a spot you've never watched the sunset from and go this week."),
    ("Pop-up hunt", "Pop-up markets and shops come and go. See what's popping up near you."),
    ("Wander a little", "Take a 20-minute walk in a direction you never go."),
    ("Local landmark day", "There's a landmark in your city you've never actually visited. Today's the day."),
    ("Thrift treasure hunt", "Pop into a vintage or thrift shop you've never been in. Treasure hunting counts."),
    ("Green space reset", "Start the day in a park you don't usually go to. Fresh air, new view."),
    ("Architecture walk", "Find the most interesting building near you and go see it up close."),
    ("Two wheels", "Rent a bike or scooter and explore a part of town you'd never walk to."),
    ("Gallery hop", "Small galleries are usually free to walk into. Find one near you this week."),
    ("Tourist for a day", "What would a visitor do in your city? Do one of those things this week."),
    ("Find your third place", "Not home, not work: a café, a bench, a bookstore. Go find your spot."),
    ("Water day", "Find a fountain, pond, beach or riverwalk near you and spend some time there."),
    ("Check the calendar", "Festivals, fairs, free concerts - see what's on in your city this week."),
    ("Explore your own block", "There's a spot within 10 minutes of home you've never noticed. Go look."),
    ("Sculpture spotting", "Public art hides in plain sight. Find a statue or sculpture you've never really looked at."),
    ("Weekend scouting", "Pick one new place to explore this weekend and add it to a list on Afiyeat."),
    ("Step inside", "That place you always walk past but never go into? Go in today."),
    ("Historic stroll", "Find your city's oldest street or district and take a walk through it."),
    ("Photo walk", "Go on a walk just to take photos. You'll notice things you've passed for years."),
    ("Hidden courtyards", "Cities are full of hidden courtyards and rooftop gardens. Go find one."),
    ("Start an explore list", "Make an Afiyeat list of places in your city you want to visit, and tick one off."),
]
assert len(morning_explore) == 30



# Activity tags: the 8am and 5pm pushes must never suggest the same kind of
# activity on the same day. Both rotate by days since a fixed epoch, so on
# day d the pair is (morning[d % 30], evening[d % 40]): morning index a only
# ever meets evening index b with a % 10 == b % 10. The evening list is
# reordered below so that no such pair shares a tag.
morning_tags = [
    "new-spot", "route", "cafe", "ask-locals", "museum", "park", "library", "view",
    "neighborhood", "sunset", "market", "route", "landmark", "shops", "park", "architecture",
    "ride", "art", "new-spot", "cafe", "water", "events", "route", "art", "plan",
    "detour", "history", "photo", "hidden", "plan",
]
evening_tags = [
    "new-spot", "sunset", "route", "museum", "market", "neighborhood", "books", "park",
    "events", "architecture", "ride", "art", "water", "signs", "ride", "detour", "route",
    "shops", "park", "cafe", "neighborhood", "music", "view", "sky", "neighborhood",
    "dessert", "bridge", "cinema", "theater", "cafe", "view", "plan", "market", "plaza",
    "hidden", "events", "market", "history", "ask-locals", "save",
]
assert len(morning_tags) == len(morning_explore) and len(evening_tags) == len(evening_explore)


def order_evening():
    """Assign evening messages to positions 0..39 so that position b's tag
    differs from the tags of morning positions b%10, b%10+10, b%10+20.
    Deterministic backtracking, preferring the original order."""
    n = len(evening_explore)
    placed = [None] * n
    used = [False] * n

    def ok(pos, msg):
        r = pos % 10
        return all(evening_tags[msg] != morning_tags[a] for a in (r, r + 10, r + 20))

    def go(pos):
        if pos == n:
            return True
        for msg in range(n):
            if not used[msg] and ok(pos, msg):
                used[msg] = True
                placed[pos] = msg
                if go(pos + 1):
                    return True
                used[msg] = False
        return False

    assert go(0), "no conflict-free evening order"
    return placed


evening_order = order_evening()
evening_explore = [evening_explore[i] for i in evening_order]
evening_tags = [evening_tags[i] for i in evening_order]
for d in range(120):  # lcm(30, 40)
    assert morning_tags[d % 30] != evening_tags[d % 40], d

def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def arr(items, indent="      "):
    return "array[\n" + ",\n".join(indent + q(x) for x in items) + "\n    ]"


for t, b in facts + evening_explore + morning_explore:
    assert len(b) <= 112, (len(b), b)
    assert len(t) <= 45, (len(t), t)
assert len({b for _, b in facts + evening_explore + morning_explore}) == 130, "duplicate body"

subs = {
    "FACT_COUNT": str(len(facts)),
    "FACT_TITLES": arr([t for t, _ in facts]),
    "FACT_BODIES": arr([b for _, b in facts]),
    "MORNING_COUNT": str(len(morning_explore)),
    "MORNING_TITLES": arr([t for t, _ in morning_explore]),
    "MORNING_BODIES": arr([b for _, b in morning_explore]),
    "EVENING_COUNT": str(len(evening_explore)),
    "EVENING_TITLES": arr([t for t, _ in evening_explore]),
    "EVENING_BODIES": arr([b for _, b in evening_explore]),
}
sql = open(sys.argv[1]).read()
for k, v in subs.items():
    sql = sql.replace("{{" + k + "}}", v)
assert "{{" not in sql
open(sys.argv[2], "w").write(sql)

# Also emit the message lists (in rotation order, with activity tags) as
# JSON for review and for the checks in supabase/tests/daily-notifications.
import json
json.dump({
    "rotation_epoch": "2026-01-01",
    "good_morning_fun_fact": [{"title": t, "body": b} for t, b in facts],
    "morning_explore": [{"title": t, "body": b, "activity": g} for (t, b), g in zip(morning_explore, morning_tags)],
    "evening_explore": [{"title": t, "body": b, "activity": g} for (t, b), g in zip(evening_explore, evening_tags)],
}, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
print(len(facts), "facts,", len(morning_explore), "morning,", len(evening_explore), "evening")
