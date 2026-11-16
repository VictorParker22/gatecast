# Design direction: a departure board for weather

Status: exploration. Nothing in this document is built yet. It records the direction the team is exploring for the next version of Gatecast, why, and what has to be answered before any of it ships. The current site is described in `README.md` and `docs/design-system.md`.

The designs live in a private Claude design canvas, which is not linked from here.

## The big idea

**Your trip is the home page.** Gatecast should work like a departure board for weather: you add a trip once, and every visit opens on that journey and its answer. One journey sits on one time axis, from leaving home to arriving, with every airport in its own local time. The interface is monochrome, so colour only ever means risk: when something turns teal, amber or rose, it is because the weather on your trip changed.

## What prompted it

A critique of the current site found five problems:

1. **The home page reads as a weather app.** A big temperature, a sky and a board of boxes answer "what is the weather here?", which many apps already answer well. They do not answer "will weather disrupt my trip?".
2. **Flights are buried.** The flight and connection tools, which are why Gatecast exists, sit in a box halfway down the board and on two other pages.
3. **Three pages, three looks.** Weather, Flights and Connections grew separately and no longer feel like one product.
4. **Widget and gamification creep.** Resizable boxes, a shelf, a day streak and a daily quiz add things to manage without making the answer clearer.
5. **The connection checker is the differentiator.** Desk research (`docs/research-report.md`) found no mainstream product that joins the itinerary to the forecast. That join should be the front door, not a side page.

## Six rules

1. **Trips first.** If you have a trip, you see it before anything else. Local weather is what you see when you do not.
2. **Colour only means risk.** Everything else is black, white and greys, so a colour on screen is always news about the trip.
3. **One journey, one time axis.** Departure, connection and arrival line up on a single strip, each labelled in its own local time.
4. **Signage, not widgets.** Big, calm, fixed type that you read, like an airport board, rather than boxes you arrange.
5. **Calm collapses.** When nothing threatens the trip, the page says so in one line and gets out of the way.
6. **Risk expands.** When something does, that stop opens up with the reason, the hours that matter and what to do.

These extend the existing principles in `docs/design-system.md` (verdict first, never colour alone, local time labelled, plain words, tokens only); they do not replace them.

## Screens explored

- **Trip-first home.** Opens on your saved trip and its verdict; local weather moves below it.
- **Trip verdict with journey strip.** The one-sentence verdict over a single strip covering every stop, with the risky hours marked.
- **The brief.** A short read for the trip with "because…" content: every item has to say why it is there (because of your weather, your place or your day), following the content rule in `docs/content-sources.md`.
- **Live home.** A home built around live conditions, with the WebGL sky and frosted glass.
- **Today portal and v2.** A daily landing page for people without a trip, with an adaptive hero that changes with the conditions.
- **Share card.** An image-sized summary of a trip verdict for messages.
- **Ad slot and search hub.** Where advertising could sit without touching the verdict, and a single search that takes a flight number, an airport or a city.
- **Travel-day mode.** On the day, the page switches to the next step of the journey and the live state of each airport.
- **Pick-up mode.** For the person meeting a flight: one arrival airport and whether to leave home yet.
- **Packing list.** Built from the forecast at each stop.
- **Time scrubber.** Drag along the journey strip to see the weather at each stop at that moment.
- **Ask Gatecast.** A question box for asking about your trip in plain words.
- **Traveller reports with moderation.** Short reports from people at an airport, reviewed before they appear.
- **Storm mode live blog.** When a major storm affects many airports, a running, dated page of what is known.
- **Daily sky video.** A short clip of the day's sky for the home page and sharing.

## Open questions before launch

- **Open-Meteo licence.** The free tier is for non-commercial use. Ads, a share card for growth or any paid feature need their commercial plan first.
- **Content pipeline and reviewers.** The brief, storm mode and Ask Gatecast need a pipeline that drafts from sources and a person who reviews. Who staffs review, and at what hours, is not decided.
- **Real photography.** Screens that show photographs need real, properly licensed images: licensed photos, written permission or no image at all. An image link is not permission.
- **Moderation for traveller reports.** Reports show real people and places. They need their own written policy, in the spirit of `docs/moderation-policy.md`, before they are switched on.
- **Performance budget.** Under 2 MB on first load, including the sky, fonts and any video. The daily sky video and the live home are the riskiest against that budget.
