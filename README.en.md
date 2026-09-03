# Gildongmu (길동무)

[한국어](README.md) | **English**

**Accessible navigation for South Korea.** Gildongmu treats completing the entire journey from search to directions with a screen reader as a core requirement. It brings together Korean local service APIs, including Kakao, Naver, national public data, and Seoul Open Data.

The app serves two core user groups:

1. **Blind and visually impaired users:** complete the whole flow through text and speech, without relying on a map.
2. **Visitors to South Korea:** use a minimal interface available in six languages, without needing to know Korean.

## Try it

| Channel | Get started |
|---|---|
| Web | [Open Gildongmu in English](https://gildongmu.dodoplanet.space/en) |
| iOS | [App Store](https://apps.apple.com/app/id6792234349) |
| CLI | `npm install -g gildongmu` → [Documentation (Korean)](packages/cli/README.md) |
| MCP | `claude mcp add gildongmu -- npx -y gildongmu-mcp` → [Documentation (Korean)](packages/mcp/README.md) |

The CLI and MCP server require no account or token. They forward requests to the public REST API.

```bash
gil nearby subway --near "강동역"     # Live arrivals at subway stations near Gangdong Station
gil route walk "길동역" "강남역" --accessible true   # Walking directions avoiding stairs, from Gildong to Gangnam
```

## Tools for browser agents (WebMCP)

The app declares seven WebMCP tools at its root. In a compatible browser, such as the ChatGPT in-app browser or Chrome with WebMCP enabled, an agent can call tools to search for places, read station information, and plan routes. The tools return **the same text shown on screen**, and the interface updates to match, so the user can take over from there.

For screen reader users, scanning a screen can take more effort than reaching it. A single route may contain dozens of accessibility objects; a tool can deliver that information in one response. An output allowlist prevents coordinates from being included in WebMCP tool responses to the agent.

See [`docs/WEBMCP.md`](docs/WEBMCP.md) for the implementation, contracts, and validation evidence in English. Development rules and pitfalls are in the WebMCP section of [`CLAUDE.md` (Korean)](CLAUDE.md).

## Core design

- **Lists and text are the source of truth.** Map SDKs render to a canvas that screen readers cannot read, so information available only on a map is a bug. Gildongmu provides text briefings before departure and **live guidance** (walking is released; driving and public transit are experimental). Links to map apps (`nmap://`, `kakaomap://`) are secondary options on place detail screens.
- **Keep result states distinct.** “No results,” “information unavailable,” and “request failed” must be distinguishable in text. “Outside the service area” is another explicit state.
- **Features without an API key stay hidden.** No unusable buttons or fake live data. Place search is the one exception: it has a mock fallback for local development. `PLACES_PROVIDER` can also force a provider for A/B comparisons.
- **One logical line is one accessibility object.** Splitting a line into styled inline `<span>` elements can make VoiceOver stop at each fragment.

The project's shared accessibility charter defines the general rules. Repository-specific implementation guidance is in [`CLAUDE.md` (Korean)](CLAUDE.md).

## Build a service for your own region

This project is open source so that others can build accessible navigation for their own region and users. The [forking guide (Korean)](docs/FORKING.md) lists what to change, including domains, bundle IDs, names, providers, and seed data, and what can be reused, such as accessibility contracts and pure decision functions. A single Kakao API key is enough to enable place search and routing.

## Development

```bash
npm install
npm run dev          # localhost:3000
npm run test:run     # Vitest; required before every commit
npm run lint
```

For live data, copy `.env.example` to `.env.local` and fill in the keys you need. Features without keys stay hidden, so you can develop with only a subset configured.

```bash
node scripts/usage-report.mjs   # API cost, quota, and key expiry checks using non-billable probes
```

## Documentation

Unless marked otherwise, the following documents are in Korean.

| Document | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Lasting rules, patterns, and pitfalls. Read before changing the code. |
| [`PROGRESS.md`](PROGRESS.md) | Current functionality and deployment status |
| [`CHANGELOG.md`](CHANGELOG.md) | Changes by date |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Open work and reasons for rejecting proposals |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Detailed contracts for external integrations |
| [`docs/PATTERNS.md`](docs/PATTERNS.md) | Detailed contracts for UI, state, chat, tools, and builds |
| [`docs/WEBMCP.md`](docs/WEBMCP.md) | WebMCP overview in English: seven tools, implementation, and testing |
| `docs/superpowers/specs` and `plans` | Feature designs and validation records |
| `docs/research/RESEARCH-*.md` | Research into Korean API services |

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, next-intl 4, zod 4, Vitest 4.

The iOS app uses SwiftUI and GildongmuKit (Swift Package Manager). Decision logic is mirrored between the web and iOS implementations, with shared fixtures to prevent behavioral drift.

## License

The code is licensed under [MIT](LICENSE). Bundled public datasets and OpenStreetMap-derived files retain their source-specific terms, including Korea Open Government License Type 1 and ODbL 1.0. See [`NOTICE.md` (Korean)](NOTICE.md) for the inventory. Forks should use their own name, icon, domain, and npm package names instead of Gildongmu's project identifiers.

See [contribution guidelines (Korean)](CONTRIBUTING.md), [security reporting instructions (Korean)](SECURITY.md), and the [research citation file](CITATION.cff).

## Related project

[dodo-planet](https://www.dodoplanet.space) is a family travel guide PWA. The two projects operate independently and share proven features in both directions. They keep their stacks and conventions aligned, and `src/lib/` stays independent of React and Next.js to support reuse.
