/**
 * #2 `search_places`(spec §3.2) — 홈으로 이동해 화면 정본 검색(`HomeBridge.runSearch`)을 원자 호출하고,
 * 정착 시 동결된 스냅샷에서 `ref`를 발급한다. 좌표는 어느 필드에도 없다(거리는 화면 표기 문자열).
 */
import { formatDistance } from "@/lib/format";
import { isStation } from "@/lib/station-match";
import { assertNoCoordinates, finish, withFailure } from "../output";
import { encodeRef } from "../place-refs";
import { checkBudget, consumeBudget } from "../tool-budget";
import { failure, type WebMcpTool } from "../types";
import type { HomeBridge } from "./context";
import { ensureHome, isFailure, withOp } from "./ensure-view";

export const SHAPE = withFailure({
  ok: true,
  view: true,
  searchRef: true,
  query: true,
  sort: true,
  branches: { places: true, addresses: true, web: true },
  places: [
    { ref: true, name: true, category: true, address: true, roadAddress: true, distance: true, phone: true, isStation: true },
  ],
  placesReturnedCount: true,
  placesTotalCount: true,
  addresses: [{ ref: true, road: true, jibun: true, zip: true, english: true }],
  addressesReturnedCount: true,
  addressesTotalCount: true,
  web: [{ title: true, url: true, snippet: true }],
  webReturnedCount: true,
  webTotalCount: true,
});

/** 화면 링크 href의 origin+path만. path에 십진 좌표쌍이 있으면 키를 뺀다(spec §7). */
export function safeUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    const out = `${u.origin}${u.pathname}`;
    return assertNoCoordinates(out) ? undefined : out;
  } catch {
    return undefined;
  }
}

export const DESCRIPTION =
  "Search places and addresses in Korea by name, address or keyword, exactly as the app's search box does. Returns places (with a ref to pass to get_place_info or plan_directions.toRef), addresses, and web results when nothing local matched. The app moves to the home screen and shows the same results.";

export function searchPlacesTool(): WebMcpTool {
  return {
    name: "search_places",
    description: DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Place name, address, or keyword, e.g. '강남역' or 'Seoul Station'." },
        sort: {
          type: "string",
          enum: ["accuracy", "review"],
          description: "accuracy (default) or review (Naver review order, Korean only).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input, context) =>
      withOp(
        "search_places",
        context?.signal,
        async (op) => {
          const query = typeof input.query === "string" ? input.query.trim() : "";
          if (!query) return finish(failure("unsupported", { detail: "emptyQuery" }), SHAPE);
          const sort = input.sort === "review" ? "review" : "accuracy";
          const home = await ensureHome(op);
          if (isFailure(home)) return finish(home, SHAPE);
          const budget = checkBudget("search");
          if (!budget.ok) return finish(failure("cooldown", { retryAfterMs: budget.retryAfterMs }), SHAPE);
          consumeBudget("search");
          const outcome = await home.runSearch({ query, sort }, op);
          if (outcome.kind !== "settled") {
            return finish(
              outcome.kind === "aborted" ? failure("aborted") : failure(outcome.kind),
              SHAPE,
            );
          }
          return finish(project(home, outcome.attempt, outcome.branches), SHAPE, {
            arrays: [
              { path: "web", mode: "count" },
              { path: "addresses", mode: "count" },
              { path: "places", mode: "count" },
            ],
          });
        },
        (running) => finish(failure("busy", { running }), SHAPE),
      ),
  };
}

function project(home: HomeBridge, attempt: number, branches: { places: string; addresses: string; web: string }) {
  const snap = home.snapshotFor(attempt);
  if (!snap) return failure("superseded");
  // 장소·주소 **둘 다** 실패일 때만 searchFailed(0건과 다른 상황).
  if (branches.places === "error" && branches.addresses === "error") return failure("searchFailed");
  const read = home.read();
  return {
    ok: true,
    view: "home",
    searchRef: attempt.toString(36),
    query: snap.query,
    sort: snap.sort,
    branches,
    places: snap.places.map((p, i) => ({
      ref: encodeRef(attempt, "p", i),
      name: p.name,
      category: p.category,
      address: p.address || undefined,
      roadAddress: p.roadAddress || undefined,
      distance: p.distanceMeters !== undefined ? formatDistance(p.distanceMeters) : undefined,
      phone: p.phone || undefined,
      isStation: isStation(p),
    })),
    addresses: snap.addresses.map((a, i) => ({
      ref: encodeRef(attempt, "a", i),
      road: a.roadAddr,
      jibun: a.jibunAddr || undefined,
      zip: a.zipNo || undefined,
      english: a.engAddr || undefined,
    })),
    web: read.webResults.map((w) => ({ title: w.title, url: safeUrl(w.url), snippet: w.snippet })),
  };
}
