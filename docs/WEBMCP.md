# WebMCP tool layer

Gildongmu declares seven WebMCP tools so that a browser agent can search Korean places, read station and place information, and plan a trip, and gets back exactly the text the screen shows.

Live: <https://gildongmu.dodoplanet.space/en> (Korean: `/ko`). Source: [`src/lib/webmcp/`](../src/lib/webmcp).

> This document is written in English because its audience is the OpenAI WebMCP Challenge judges. The rest of the repository documentation is Korean.

## What Gildongmu is

An accessibility-first navigation app for South Korea. Its first-class users are blind screen reader users, and its founding rule is that the source of truth is text, never the map canvas: if a piece of information exists only on the map, that is a bug. It ships as a web app, an iOS app, and an npm CLI and MCP server, and it joins about twenty Korean public and commercial APIs (Kakao, Naver, ODsay, TAGO, Seoul Open Data, the national road name address service, and others).

## Why this use case is a strong fit for WebMCP

**The answers were already text.** Most navigation apps keep their answer in pixels, so an agent driving the browser has to guess at a canvas. Gildongmu had to write every answer as a sentence for VoiceOver users before it ever met an agent. Those same sentences are what the tools return, produced by the same functions that render the screen. An agent cannot be told something the screen does not say.

**Neither a plain browser agent nor a server MCP can do this alone.** The data needs API keys, Korean address normalization, three different coordinate systems, and per-agency response envelopes, so an agent reading the page cannot reconstruct it. A server MCP cannot answer "where am I standing right now" because it has no tab. WebMCP sits exactly on that intersection: the page holds the keys and the location, the agent asks in words.

**Location stays in the browser.** The origin of a trip defaults to the user's current position, which the page already holds. Tool output passes an allowlist that structurally forbids coordinates, so the agent's provider receives place names and sentences, never a coordinate pair.

## How it creates a better user experience

For a screen reader user the expensive part is not reaching a screen, it is exploring it. A transit plan on screen is dozens of accessibility objects to swipe through one at a time. As a tool result it is one spoken answer, and the app has still moved to that same screen, so the user can take over with VoiceOver and verify anything.

The output budget is designed like the accessibility contract that preceded it. A transit response is 3,700 characters, far past the 1,500 character guidance, so `plan_directions` returns the recommended route in full, the alternatives as one line each, and the details behind a second tool. That is the same shape as a good spoken answer: here is the recommendation, there are four alternatives, would you like the details.

Nothing regressed for people. The tools call the same screen functions a user clicks, and a human action always wins: type a new search or close a section while a tool is in flight and the tool call ends as `superseded`. While a modal is open, tools decline with `modalOpen` rather than closing it.

## What people and agents can do together that was difficult before

- **"Which car and door do I board so that I get off next to the elevator?"** Gildongmu joins a quick exit seed to the live route, so `get_transit_route_detail` returns the boarding door for each leg. Ask it in the chat, and the app is already sitting on that route.
- **"Does Gangdong Station have an elevator, and when is the first train?"** One call to `get_place_info` returns the timetable, the accessibility facilities, the real-time arrivals and the barrier-free facilities, paged by axis when it exceeds the budget.
- **Handoff runs in both directions.** The agent and the user share one screen state: tools move the app, and `read_current_view` reads whatever the person did by hand. So the agent can set up a trip that the user finishes by touch, or the user can search by hand and then ask the agent about what is on screen. Before WebMCP, asking an assistant and using an app were two separate places with no shared state.
- **Honest absence.** Every tool separates "none", "not known" and "lookup failed", and reports `outOfCoverage` outside Korea instead of inventing a result. A screen reader user cannot glance at a screen to catch a fabricated answer, so the tools never let the agent guess.

## How WebMCP is implemented

Imperative API, `document.modelContext.registerTool({ name, description, inputSchema, execute })`.

- **One always-on set of seven tools** registered at the app root (`useWebMcpTools`), not per screen, because an agent reads the tool list once. Unavailable tools are still declared and answer `notConfigured`. Tools that need another screen move there themselves (`tools/ensure-view.ts`); there are no `open_*` tools.
- **Screens publish a bridge to a view registry** (`view-registry.ts`) and tools read it at execution time. Waiting is bound to identity (the place id, a publication sequence number), not to a screen name, so a call for place A cannot resolve early because place B mounted.
- **Single flight with an `op` token** (`tool-lock.ts`), capped at 30 seconds. A second concurrent call returns `busy{running}`, and an expired or released op cannot commit a late result.
- **Handles are opaque refs** (`place-refs.ts`) carrying a document nonce, a search generation and an index, resolved once against a snapshot frozen when the search settled. A handle from a superseded search returns `staleResult` together with the call that recovers it, rather than resolving to the wrong place.
- **Every output passes one function**, `finish(value, SHAPE)` (`output.ts`): a field allowlist, `assertNoCoordinates`, a 1,500 character budget with item level elision, and `offset` paging for a single axis.
- **Upstream calls are budgeted** per provider bucket with cooldowns and a session cap, because these are paid third-party quotas.
- **Human sentences come from the shared modules** the screen uses (`place-lines/*`, `route-step-items.ts`), so screen and tool cannot drift.

Verified with 19 test files and 104 tests, with the contracts checked by mutation injection, and on the deployed site through Chrome DevTools WebMCP inspection (`docs/research/RESEARCH-2026-08-29-webmcp-deployed-validation.md`).

## The seven tools

| Tool | What it returns |
|---|---|
| `describe_app` | What this deployment can do, which tools are available, how they chain |
| `search_places` | Places, addresses and web results for a query, with refs to pass on |
| `get_place_info` | A place by ref: category, address, phone; for stations the timetable, accessibility facilities and live arrivals; barrier-free facilities |
| `plan_directions` | Transit, walking and driving summaries for a destination, with a `planId` and route keys |
| `get_transit_route_detail` | One transit route in full, including the quick exit boarding door |
| `get_route_steps` | Walking or driving steps as a numbered page |
| `read_current_view` | Which screen the app is on and what it shows |

## Prior work and new work

Gildongmu existed before the submission period. Everything in this document was written inside it.

| | |
|---|---|
| Added during the submission period | `src/lib/webmcp/**`, `src/hooks/useWebMcpTools.ts`, `src/hooks/useAxisBridge.ts`, the bridges published by `PlaceSearch`, `PlaceDetail` and `DirectionsView`, the shared line modules extracted for them, and the privacy clause for agent output in all six locales |
| Commit evidence | About thirty commits prefixed `webmcp`, dated 2026-08-27 to 2026-08-30. `git log --grep webmcp --since 2026-08-26` |
| Design record | Specs `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` and `2026-08-29-webmcp-wave2-design.md`, plan `docs/superpowers/plans/2026-08-29-webmcp-wave2.md`, research `docs/research/RESEARCH-2026-08-28-webmcp-tool-scope.md` and `RESEARCH-2026-08-29-webmcp-deployed-validation.md` |
| Prior work, not part of this entry | The navigation app itself: the API integrations, the accessibility contracts, the iOS app, the CLI and the server MCP package |

## Trying it

Open <https://gildongmu.dodoplanet.space/en> in the ChatGPT desktop app's built-in browser (GPT-5.6 Sol or Terra; WebMCP is off in Luna), or in Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing`. Coverage is South Korea only.

In the ChatGPT desktop app the built-in browser lives in the **Work** tab: start a chat with no project, open the side panel (Option-Command-B), choose **Browser**, and enter the URL. Then ask the agent to use the page open in its browser tab, for example "Which tools does the Gildongmu page open in your browser tab offer?" or "Gangdong Station (강동역): first train, last train, elevator?" Station names work best with the Korean name alongside.

1. "Ask Gildongmu what it can do."
2. "Find Gangdong Station and tell me the first and last train, and whether it has an elevator."
3. "Plan a trip from Seoul Station to Gangnam Station, then tell me which car and door to board."
4. "Read me the walking directions, ten steps at a time."
5. Turn on VoiceOver for the third one and notice that the app is already on the route screen the agent described.
