# The Cedar Tree

graphs go brrr

Who knows whom, at Cedarville, measured one to ten.

A study needs edges, and the only person who can draw one is somebody who
knows both ends. So the app is a rating loop and almost nothing else: it puts
a face on screen, you press a number, it puts up the next one. A second per
person is the design budget, and everything below exists to protect it.

Cloudflare Workers, D1 for the graph, R2 for the photographs, React for the
page. One `wrangler deploy`. White, and only white: a face is the most
important thing on the screen and photographs sit better on paper than on
slate.

Deployed at **https://social-graph.kieran-fdb.workers.dev**. The D1 database
and the R2 bucket exist, the schema is migrated, all 10,516 people are seeded,
and Google sign-in is live and restricted to `cedarville.edu`.

```sh
bun install
bun run db:local                          # migrations, local
bun run seed --apply                      # the directory, out of cedarstalk
bun run dev                               # vite + workerd on :5173
bun run deploy                            # build, then wrangler deploy
```

Four secrets live on the worker — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`INGEST_TOKEN` — and `ORIGIN`, `ALLOWED_DOMAIN` and `ADMIN_EMAILS` are plain
vars in `wrangler.jsonc`. The OAuth client's authorized redirect URI has to be
exactly `$ORIGIN/auth/callback`, which is the one thing that silently breaks
if the origin ever changes.

Preview URLs are turned off on purpose. This worker holds ten thousand real
names, and one public surface is enough to keep track of.

There is no way in that is not Google. `/auth/dev` exists for local work and
checks two things before it will answer — an explicit `DEV_LOGIN=1` and a
loopback hostname — so it is dead on the deployed origin even if the flag were
ever set there.

Sign-in is Google, restricted to the school's Workspace domain, which is the
only credential this study needs. Put `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` in `.dev.vars` (see `.dev.vars.example`), and in
production `wrangler secret put` them. Without them the app still runs and
says so, and `DEV_LOGIN=1` opens `/auth/dev` on loopback so the loop can be
worked on before anything is registered.

### the seed

`bun run seed` reads the directory snapshot in
[cedarstalk](https://tangled.org/dunkirk.sh/cedarstalk-raycast) — ten and a
half thousand people, with class standing, residence hall, department and
hometown — and writes it out as one idempotent SQL file. Re-running adds
whoever is new and updates nobody, because by then the rows carry photographs
people uploaded, majors they typed, and withdrawals that must not be quietly
undone by the next snapshot.

The valuable column is `Username`. A username plus the school's domain is the
Google account, so a seeded row already carries the address the person will
sign in with. Signing in *claims* that row rather than making a second one,
and every rating already pointing at it stays pointing at it. That is an exact
join where the usual thing is guessing at names.

Being seeded is not being enrolled. A seeded row is a name the directory
published; `joined_at` marks the people who turned up.

### segments

Everybody is imported, and which slices are live is a setting:

    ug      4,651   undergraduates          <- live
    de      3,785   dual-enrolled high schoolers
    grad    1,353   graduate and professional
    staff     679   faculty and staff
    other      48

Undergraduates only to begin with; the admin tab moves the line. This is the
actual research decision, and it should be a checkbox rather than a re-import:
a study of residential undergraduates and a study of the whole institution are
this database with a different set of boxes ticked.

Sorting people into those buckets took two wrong turns and is worth reading
`segmentOf` for. Neither directory field can be trusted alone. `StudentClass`
is a fossil on anybody who has stopped being a student — Matthew Clark, adjunct
instructor, is filed "JR" — so a job title with no student type has to be
caught first, and 207 rows depend on it. But `StudentType` lags in the other
direction, and 468 people carry graduate standing under a type that still says
UG; every one of them has no residence hall, against 63 to 88 per cent of every
undergraduate standing, which is what proves they are graduates. So: no student
type plus a job means staff, and after that the standing leads.

Anyone who has signed in stays visible whatever is ticked. Turning somebody
invisible after they consented would be the wrong way round.

### invitations

Every account has one durable link, `/i/<code>`. The code survives the round
trip through Google in the OAuth `state`, so it works in a browser that has
never seen the site, and whoever shared it is the first card the newcomer
sees.

That is the point. A new account with an empty graph is worth very little:
every candidate is a stranger and every answer is "never heard of them". One
guaranteed real edge on the first card is an entry into a neighbourhood, and
the second card can already be somebody that person knows.

### which face is next

`worker/queue.ts`, in tiers, strongest signal first:

    inviter     whose link you followed
    reciprocal  people who have already placed you; the edge is half drawn
    mutual      friends of friends, scored by the product of both hops
    cluster     the same suite, or the same floor
    dorm        the same residence hall
    cohort      the same major, or the same year
    unrated     random, least-looked-at first

Multiplying the two hops rather than adding them is the load-bearing bit: a
strong tie to someone who barely knows the candidate is weak evidence, and so
is the reverse. Summing that product over intermediaries rewards the person
several of your friends know.

Random never goes away, and proximity is capped. A quarter of every batch is
drawn at random however well connected the rater is, spliced through rather
than appended, because a queue made only of friends of friends finds one dense
component and never learns the rest of the school exists.

A queue made of whoever lives nearby is worse, because it looks productive
while mapping one building — so no proximity tier may fill more than an eighth
of a batch, which holds residence to the same quarter the strangers get.

`cluster` is the sharpest of these and comes free with the room number.
Willetts 206 is a three digit room whose first digit is a floor, about a
hundred and fifty people sharing a stairwell; Printy 27C is a suite, where 27
is the unit and C is the bedroom, eight people sharing a bathroom. One column
holds whichever grain the building publishes, because the queue only ever asks
whether two people are neighbours.

Zero is a separate answer, not a low one. "Never heard of them" is real data:
a graph that only records acquaintance cannot tell a sparse region from a
question nobody asked.

### photographs

Recognition is most of what makes a one-to-ten answer accurate; a page of
initials asks people to rate names, which is a different and much worse
question. The directory's photo endpoint needs a signed-in Cedarville session,
so `bun run photos` runs on your laptop with your own account — reusing
cedarstalk's auth helper — and posts each image through the worker's ingest
route into R2. Nothing hands the server a session.

    INGEST_TOKEN=… bun run photos --dry-run --limit 20
    INGEST_TOKEN=… bun run photos --origin https://social-graph.kieran-fdb.workers.dev

Nineteen are in already, as a proof that the whole chain works: session, fetch,
ingest route, R2, and a face served back over the internet. They come out at
282x282 and about 15 KB, so the full ten and a half thousand is around 158 MB —
nothing against R2's ten free gigabytes. The run takes six concurrent fetches
and something under ten minutes.

Anybody can replace theirs from their own page, and the ingest never
overwrites a photograph somebody uploaded themselves.

There is no image library anywhere in this project. The page resizes on a
canvas before uploading, so the worker only has to check the magic bytes, cap
the size, and put the object.

### the card and the question

The card holds the person and nothing else: a photograph, a name, a year, a
major if there is one. What you *do* to them happens on the page below it,
because two panels stacked read as two objects and there is one object here
with a set of controls under it.

The scale runs one to ten left to right with its two ends labelled, and
"never heard of them" comes after it rather than before — it is the answer for
when none of the ten apply, and on top it looked like a heading for a row it
was not part of. It is sized to its own words; full width read as a banner.

Under that, optionally, **where did you meet them**. Typing in it swallows
the number keys, so "chem 101" is a note and not a rating; Enter is the one
key that still sends from inside it. Free text on purpose: a
fixed list of choices would decide in advance what kinds of tie exist, which
is one of the things the study is supposed to find out. Most edges will not
have one and that is fine; the ones that do are worth more than the number
beside them. Correcting a number later never throws the note away.

### what a card says

A name, a photograph, a year, and a major if there is one. Not the residence
hall, not the room, not the hometown — those are the queue's best signals and
it uses all of them, but a page that prints where somebody lives to everybody
shown their face is an address book, not a study.

They are absent from the wire rather than merely undrawn: `toPerson` in
`worker/db.ts` is the only thing that turns a row into something a browser
sees, and those fields are not in it. Your own hall is on your own page, where
you can correct it; correcting it discards the room cluster the directory gave
you, since a wrong neighbour is worse than no neighbour.

There is no reason line under the proximity tiers at all. "Same major", "you
may cross paths", "not yet placed" describe how the software works, which is
not interesting and is one more thing to read on every card; naming the
building would also undo the care above. The badge appears only when the
answer is a person: who invited you, who has already placed you, who you are
known by.

### the card

A prototype, and the one place in this app allowed to show off. Ten thousand
people are being asked to do something repetitive for nothing, and a number
that only goes up is the cheapest honest motivator there is — honest because
you cannot level by answering badly, only by answering more.

Level is `1 + √(answers / 5)`, so the thresholds run 5, 20, 45, 80, 125, 180,
245, 320, 405. Quadratic on purpose: linear makes level 40 as cheap as level 2
and the number stops meaning anything, exponential strands you at 6 forever.

Three things make one card differ from another. The **school** you are in
picks the colour and the type mark, derived from your major or your
department — ten of them, and everything in the stylesheet hangs off one
`--hue`, so ten schools cost ten lines rather than ten palettes. The **level**
picks the finish, and each tier differs at rest and not only under a pointer,
because a reward you can only see by hovering is no reward on a phone. And two
things you **choose**: a frame colour, more of which unlock as you go, and a
line of your own under the art.

### withdrawing

Anybody can leave, from their own page, without asking. It destroys everything
that identifies them — name, photograph, email, major, hall, hometown, year —
deletes the object out of R2 rather than only the column pointing at it, ends
their sessions, and stops them ever being shown to anyone again. No new edge
can be drawn to them afterwards. The row survives as an opaque id so a later
re-seed cannot bring them back as somebody new.

The connections stay, and that is a deliberate choice rather than an
oversight. When somebody rates you a nine, that is a fact *they* authored
about their own social world; deleting it because you left edits their
contribution, not yours. Withdrawals also will not be random — they cluster
among the people who feel most exposed, who are exactly the structurally
interesting ones — so removing those nodes would put a systematic hole in the
measures this whole thing exists to compute.

The honest word for what remains is pseudonymous, not anonymous. A node with
forty edges, a degree and a set of timestamps can be picked out by somebody who
already knows part of the network, and the page says so instead of implying
otherwise. Withdrawn people appear in `nodes.csv` with an empty name and
`withdrawn=1`, because their edges are still in `edges.csv` and a node has to
exist for an edge to point at.

### shape

    shared/schema.ts        the shapes both halves agree on
    migrations/             one D1 migration, the whole schema
    worker/db.ts            every query; the two rules that matter live here
    worker/auth.ts          google oidc, sessions, the domain check
    worker/queue.ts         which face is next, and why
    worker/photos.ts        R2, and no decoder
    worker/index.ts         hono; every route the page can call
    web/src/Home.tsx        the page: search over the placing loop
    web/src/settings.ts     the one preference, kept per device
    web/src/Rate.tsx        the loop itself, which is the whole product
    scripts/seed.ts         directory snapshot -> D1
    scripts/photos.ts       directory photographs -> R2
    scripts/export.ts       nodes.csv and edges.csv, pseudonymous by default

Choosing and sending are two steps. They used to be one, and the card flew
past the instant you touched a number: fast, but a misread name was already
recorded, and the note field below could never be filled in because the person
it belonged to was gone. Now a number is selected, `next` (or Enter) sends it,
and `undo` puts the previous answer back on screen still selected, so
correcting one is a keystroke rather than a retype.

### forms, and letting the platform do its job

The ten cells are a `<fieldset>` of eleven native radios sharing one name, so
the whole question is one tab stop, the arrow keys move the answer, and a
screen reader announces the group without a word of ARIA. The hand written
version of that — a roving tabindex and a keydown handler — did a worse job
than the platform does for free. The radios are visually hidden inside the
cells you can see, and the cells take their selected and focused look straight
off `:has(:checked)` and `:has(:focus-visible)`, so there is no class anyone
can forget to set.

The keys are always live — 1 to 9, 0 for ten, `x` or space for a stranger,
Enter to send, `s` to defer, `z` to undo — but they are not printed on the buttons
unless you tick the box on your own page. They also step aside: a shortcut that fires while somebody is
activating the button they just tabbed to does two things at once, and one of
them is a wrong edge. Space belongs to whatever has focus, and Enter still
sends from the note field and from the scale.

Each card announces itself. Replacing text in place is silent, so a screen
reader would answer one question and be handed the next without being told
whose face it was; the card sits inside a polite live region that stays put
while the card inside it is keyed, which keeps the entrance animation.

The answer is a real `<form>` with a real submit button, and so is the
profile, which is where Enter comes from. There is no Enter handler in this
project: [implicit submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission)
already sends a form when you press Enter in a field inside it, from the note,
from the scale, from anywhere. Choosing by keyboard puts focus on the radio it
chose, so the caret is inside the form the way it would be if you had clicked
the cell, and the browser takes it from there. The one form that is
deliberately *not* a form is withdrawing: Enter should never be able to delete
somebody's account.

The fields say what they are, so the platform can help: `autocomplete="name"`
on the name field, `enterkeyhint` so a phone's return key is labelled with
what it will do, `autocapitalize="sentences"` and a spell check on the note
because it is a sentence about a person, and all of that turned off for the
search box because names are neither sentences nor dictionary words.

The one place the palette leaves shadcn's defaults is
[WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
which wants 3:1 against the adjacent colour for anything you must see in order
to use it. A white input on a white page is identifiable only by its border,
and zinc-200 gives **1.27:1** — the prettiest failing contrast in front-end.
Form control edges use a separate `--input` token at **3.38:1**, measured in
the browser; card and divider edges keep the light hairline, because a card is
not a control you have to find and the criterion does not apply to it.
Three grey letters on every card, for a shortcut most people will never press,
is clutter charged to everyone to benefit a few. The switch is on your own
page and lives in localStorage rather than the database, because whether to
show them is a fact about the machine in front of you: on for the laptop you
place two hundred people from, off for the phone you use in a queue.

One card, one row of ten targets, and everything else sized around them. On a
phone the ten become two rows of five at fifty-two pixels tall, the keyboard
hints disappear, and a search result opens its scale below the name when you
tap it rather than trying to fit eleven buttons across a 390px screen — which
works out at fourteen pixels each, and fourteen pixels is not a button.

There is one page, and it is the loop. The word everywhere above the database
is *answer*: the table records ratings because that is what an edge weight is
called in the literature, but the thing a person does here is answer a
question — including the answer "never heard of them", which is neither a
rating nor a placement. Two vocabularies for one action is worse than either. Search sits above the card
rather than behind a tab, because looking somebody up is the same task as
rating them: you thought of a person, or you want to change an answer, and
either way it ends in pressing a number. Typing swaps the card for the
matches; clearing the box puts the queue back where it was, which is why the
card is hidden rather than unmounted.

The loop never waits on the network. A batch is fetched ahead and refilled
while the previous one is still being answered, answers post in the
background, and a failed post is retried on the next answer rather than thrown
away. One through nine, zero for ten, space for a stranger, `s` to defer, `z`
to undo.

### getting the data out

    bun run export           .data/nodes.csv and .data/edges.csv, ids only
    bun run export --names   the same with names attached
    bun run export --remote  from the deployed database

Withdrawn people are present with an empty name and `withdrawn=1`; their edges
are still in the edge list and a node has to exist for an edge to point at.
The edge list carries `where_met` alongside the strength.

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy; 2026-present <a href="https://dunkirk.sh">Kieran Klukas</a></code></i>
</p>

<p align="center">
    <a href="https://tangled.org/dunkirk.sh/social-graph/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=MIT&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
