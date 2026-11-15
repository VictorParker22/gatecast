# Gatecast user research

What we know from desk research, what we are assuming, and the plan for testing it with real travellers. The full sourced report is in `docs/research-report.md`.

## What desk research established

These findings come from search-result extracts, not full reads of the sources, so figures should be re-checked before they are quoted publicly.

- **Weather is the largest cause of air-traffic-system delay, and the cause is often somewhere else.** The FAA attributes about 74% of system delays over 15 minutes to weather (June 2017 to May 2023). Flights are held at the departure airport for weather at the hub. A normal weather app shows neither the hub nor the timing.
- **Travellers want earlier, plainer information.** 89% of US flyers worry about disruption (Hopper, 2026); 57% of UK passengers wanted more information during disruption (UK CAA, 2025).
- **No mainstream product joins the itinerary to the forecast.** Flighty comes closest but is iOS-only, paid, and its connection rating is based on minimum connection time, not weather. FlightAware's MiseryMap is real-time and US-only. FAA and aviation-weather pages use UTC and jargon.
- **People read probabilities better than symbols when told what the number means**, and colour scales need a text label because a minority confuse adjacent warning colours.

Not found: any public data linking layover length to missed connections, any sourced gust or snowfall thresholds for airport disruption, or any published segmentation of travellers by weather-information need.

## Assumptions to test

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Travellers will type their route and time by hand, without a flight number | Nobody gets past the form |
| A2 | A three-level verdict with one reason is enough to act on | People want a percentage or ignore the verdict |
| A3 | People understand the hourly strip without a tutorial | The core evidence is unread |
| A4 | Showing each airport in its own local time is clearer than one reference time | Mis-read connection times |
| A5 | "Elevated" is read as "watch this", not "it will be delayed" | False alarm, lost trust |
| A6 | People return 1 to 3 days before flying, when the forecast is sharpest | One-visit product |

## Proto-personas (assumptions, not findings)

- **Anxious connector.** Flies a few times a year, has a tight connection through a winter hub, checks the weather app for the destination only. Needs a clear answer and a suggested action.
- **Frequent flyer.** Knows the hubs, wants the hourly evidence and the live airport state fast, distrusts simplified verdicts.
- **Meeter and greeter.** Picking someone up; cares about one arrival airport and whether to leave home yet.

## Jobs to be done

1. When I have a connection coming up, I want to know whether weather threatens it, so I can rebook while there are still seats.
2. When a storm is in the news, I want to see whether it touches my airports at my times, so I can stop worrying or start planning.
3. When I am about to leave for the airport, I want the current state of each airport on my route, so I know what I am walking into.

## Study plan

| Phase | Method | Participants | Time | Answers |
|---|---|---|---|---|
| 1 | Moderated usability test on the live site | 6 to 8 people with a connecting flight in the next month | 1 to 2 weeks | A1 to A5 |
| 2 | Interviews after a disrupted trip | 5 to 8 people delayed by weather in the last 6 months | 2 to 3 weeks | Jobs, moments of need, what they did |
| 3 | One-question on-page survey ("Did this help you decide anything?") | 100+ responses | Ongoing | A2, A6 |
| 4 | Verdict back-test against actual delays for a sample of routes | Data, not people | 2 weeks | Whether the thresholds are right |

Recruit a mix of device (at least half on phones), flying frequency, and at least two people who use a screen reader or have a colour-vision deficiency.

### Usability test tasks (45 minutes)

1. "You fly New York to Denver through Chicago next Tuesday at 8:30. Find out whether weather might be a problem." Observe: do they find the connection field, set the layover, understand the verdict?
2. "What time do you land in Chicago, and how long do you have there?" Observe: local-time reading (A4).
3. "Which hour looks worst in Chicago, and why?" Observe: hourly strip comprehension without help (A3).
4. "The site says Elevated. What would you do now?" Observe: interpretation and action (A2, A5).
5. "Send this to the person travelling with you." Observe: do they find Copy link?
6. "Change everything to Fahrenheit and miles per hour."

Measure per task: completion without help, time, errors, and a confidence rating from 1 to 5.

### Interview guide (disrupted travellers)

- **Warm-up (5 min).** Tell me about the last trip you took by air.
- **Context (10 min).** Walk me through the day your flight was delayed. When did you first suspect a problem? What did you check, in what order?
- **Deep dive (20 min).** What did you want to know that you could not find? Did you look at the weather for anywhere other than where you were? What did the airline tell you, and when? What did you decide, and what would have changed that decision?
- **Reaction (10 min).** Show Gatecast with their own route. What is this telling you? Would you have done anything differently with this the day before?
- **Wrap-up (5 min).** Anything we missed? Who else should we talk to?

## Success measures

- Eight in ten first-time visitors reach a verdict without help.
- Nine in ten can state the worst airport and the reason after ten seconds on the result.
- Fewer than one in ten mis-read a local time.
- At least a quarter of results are reopened from a shared or saved link.

## Synthesis

After each phase: affinity-map observations into themes, rate each finding by impact and effort, and update the assumptions table with "held", "partly held" or "failed". Changes to risk wording or thresholds need evidence from phase 1 or phase 4, not opinion.
