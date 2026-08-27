import type { DirEndpoint } from "@/lib/directions-state";
import { resolveAddressCoord } from "@/lib/resolve-address-coord";
import type { JusoAddress, PlaceSearchResult } from "@/lib/types";
import { listHighLevelTargets, makeCooldown } from "../dom";
import { finish, withFailure } from "../output";
import { failure, type ToolFailure, type WebMcpTool } from "../types";
import type { DirectionsBridge, ToolPlan } from "./context";

/** 쿨다운(spec §3.4·§7) — 시작 시각 기준, 성공·실패 무관. */
const COOLDOWN_MS = 3_000;
/** `needsDisambiguation` 후보 토큰 보관(§3.4 — `execute` 클로저 안 단기 토큰). */
const CANDIDATE_TTL_MS = 60_000;
const MAX_CANDIDATES = 5;

type Field = "from" | "to" | "via";

interface Candidate {
  candidateId: string;
  field: Field;
  label: string;
  address: string;
  kind: "place" | "address";
  coord?: { lat: number; lng: number };
  roadAddr?: string;
  expiresAt: number;
}

export const SHAPE = withFailure({
  ok: true,
  planId: true,
  resolved: { from: true, to: true, via: true, avoidStairs: true },
  transit: {
    outcome: true,
    recommended: {
      routeKey: true,
      totalMinutes: true,
      transfers: true,
      fare: true,
      walkMinutes: true,
      legLines: [true],
    },
    alternatives: [{ routeKey: true, oneLine: true, highlight: [true] }],
    totalCandidates: true,
  },
  walk: {
    outcome: true,
    distanceMeters: true,
    durationSeconds: true,
    stepCount: true,
    stepFree: true,
    stepFreeNotice: true,
  },
  car: { outcome: true, distanceMeters: true, durationSeconds: true, guideCount: true },
  targets: [{ id: true, label: true }],
});

/** 정확 일치 판정용 정규화 — 공백·구두점을 걷어 내고 소문자·NFC. */
function normalizeName(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s··,.'"()\-_/]/g, "");
}

function notFound(field: Field, extra?: Record<string, unknown>): ToolFailure {
  return failure(`${field}NotFound`, extra);
}

/**
 * #4 `plan_directions`(spec §3.4). 후보 해석 → 화면 정본 조회(`bridge.runQuery`, 완전 교체) →
 * 세대 결박 대기 → 화면 상태에서 요약 조립. 새 fetch 경로를 만들지 않는다(후보 검색만
 * 화면 필드가 쓰는 두 라우트를 같은 계약으로 부른다).
 */
export function planDirectionsTool(bridge: DirectionsBridge): WebMcpTool {
  const cooldown = makeCooldown(COOLDOWN_MS);
  const candidateStore = new Map<string, Candidate>();

  async function searchCandidates(
    field: Field,
    query: string,
    lang: "ko" | "en",
    signal: AbortSignal | undefined,
    now: number,
  ): Promise<{ candidates: Candidate[]; allFailed: boolean }> {
    const [placesRes, addrRes] = await Promise.allSettled([
      fetch(`/api/places?query=${encodeURIComponent(query)}&lang=${lang}`, { signal }).then(
        async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as PlaceSearchResult;
        },
      ),
      fetch(`/api/address/search?query=${encodeURIComponent(query)}`, { signal }).then(
        async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { addresses: JusoAddress[] };
        },
      ),
    ]);
    const places =
      placesRes.status === "fulfilled" ? placesRes.value.places.slice(0, MAX_CANDIDATES) : [];
    const addresses =
      addrRes.status === "fulfilled" ? addrRes.value.addresses.slice(0, MAX_CANDIDATES) : [];
    const candidates: Candidate[] = [
      ...places.map((p) => ({
        field,
        candidateId: "",
        label: p.name,
        address: p.roadAddress || p.address,
        kind: "place" as const,
        coord: { lat: p.lat, lng: p.lng },
        expiresAt: now + CANDIDATE_TTL_MS,
      })),
      ...addresses.map((a) => ({
        field,
        candidateId: "",
        label: a.roadAddr,
        address: a.roadAddr,
        kind: "address" as const,
        roadAddr: a.roadAddrPart1 || a.roadAddr,
        expiresAt: now + CANDIDATE_TTL_MS,
      })),
    ].map((c, i) => ({ ...c, candidateId: `${field}-${now.toString(36)}-${i + 1}` }));
    return {
      candidates,
      allFailed: placesRes.status === "rejected" && addrRes.status === "rejected",
    };
  }

  async function adopt(
    c: Candidate,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; endpoint: DirEndpoint } | { ok: false; failure: ToolFailure }> {
    if (c.kind === "place" && c.coord) {
      return { ok: true, endpoint: { kind: "place", label: c.label, coord: c.coord } };
    }
    const r = await resolveAddressCoord(c.roadAddr ?? c.label, signal);
    if (r.kind !== "resolved") {
      return { ok: false, failure: notFound(c.field, { detail: "geocodeFailed" }) };
    }
    return {
      ok: true,
      endpoint: { kind: "place", label: c.roadAddr ?? c.label, coord: { lat: r.lat, lng: r.lng } },
    };
  }

  async function resolveEndpoint(
    field: Field,
    text: string,
    candidateId: string | undefined,
    lang: "ko" | "en",
    signal: AbortSignal | undefined,
    now: number,
  ): Promise<{ ok: true; endpoint: DirEndpoint } | { ok: false; failure: ToolFailure }> {
    if (candidateId) {
      const stored = candidateStore.get(candidateId);
      if (stored && stored.field === field && stored.expiresAt > now) return adopt(stored, signal);
      // 만료·미지 토큰은 재검색으로 떨어진다(아래) — 조용히 다른 것을 고르지 않는다.
    }
    const { candidates, allFailed } = await searchCandidates(field, text, lang, signal, now);
    if (allFailed) return { ok: false, failure: notFound(field, { detail: "searchFailed", retryable: true }) };
    if (candidates.length === 0) return { ok: false, failure: notFound(field) };
    // 자동 채택은 후보 1건 또는 정규화 이름 정확 일치 1건뿐(§3.4 — "후쿠오카"→대구 가게 재발 방지).
    const wanted = normalizeName(text);
    const exact = candidates.filter((c) => normalizeName(c.label) === wanted);
    const auto = candidates.length === 1 ? candidates[0] : exact.length === 1 ? exact[0] : null;
    if (auto) return adopt(auto, signal);
    for (const c of candidates) candidateStore.set(c.candidateId, c);
    for (const [key, c] of candidateStore) if (c.expiresAt <= now) candidateStore.delete(key);
    return {
      ok: false,
      failure: failure("needsDisambiguation", {
        field,
        candidates: candidates
          .slice(0, MAX_CANDIDATES)
          .map((c) => ({ candidateId: c.candidateId, label: c.label, address: c.address })),
      }),
    };
  }

  return {
    name: "plan_directions",
    description:
      "Plan a trip in the Gildongmu directions view: resolve the destination (and optional origin, one via point, stair-avoiding walk), run the search for transit, walking and driving as the user would, and return a compact summary per mode with a planId and route keys. Origin defaults to the user's current location, which stays in the browser. If a name is ambiguous, returns candidates instead of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Destination: a place name or address, e.g. 'Seoul Station' or '세종대로 110'.",
        },
        toCandidateId: {
          type: "string",
          description: "Pick one of the candidates returned by needsDisambiguation.",
        },
        from: {
          type: "string",
          description: "Origin place name or address. Omit for the user's current location.",
        },
        fromCandidateId: { type: "string" },
        via: {
          type: "string",
          description: "One via point. Transit does not support via and reports unsupportedWaypoint.",
        },
        viaCandidateId: { type: "string" },
        avoidStairs: {
          type: "boolean",
          description: "Prefer a stair-free walking route. Default false.",
        },
      },
      required: ["to"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      const now = Date.now();
      const wait = cooldown.remaining(now);
      if (wait > 0) return finish(failure("cooldown", { retryAfterMs: wait }), SHAPE);
      cooldown.mark(now);
      const signal = context?.signal;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const toText = str(input.to);
      if (!toText) return finish(notFound("to"), SHAPE);
      const lang = bridge.read().lang;

      const to = await resolveEndpoint("to", toText, str(input.toCandidateId) || undefined, lang, signal, now);
      if (!to.ok) return finish(to.failure, SHAPE);
      const fromText = str(input.from);
      let from: DirEndpoint = { kind: "current" };
      if (fromText) {
        const r = await resolveEndpoint("from", fromText, str(input.fromCandidateId) || undefined, lang, signal, now);
        if (!r.ok) return finish(r.failure, SHAPE);
        from = r.endpoint;
      }
      const viaText = str(input.via);
      let via: DirEndpoint | null = null;
      if (viaText) {
        const r = await resolveEndpoint("via", viaText, str(input.viaCandidateId) || undefined, lang, signal, now);
        if (!r.ok) return finish(r.failure, SHAPE);
        via = r.endpoint;
      }
      if (signal?.aborted) return finish(failure("aborted"), SHAPE);

      // 완전 교체(리뷰 #24): 생략된 from은 현재 위치, via는 없음, avoidStairs는 false로 한 번에.
      const outcome = await bridge.runQuery(
        { from, to: to.endpoint, via, avoidStairs: input.avoidStairs === true },
        signal ?? new AbortController().signal,
      );
      switch (outcome.kind) {
        case "busy":
          return finish(failure("busy"), SHAPE);
        case "superseded":
          return finish(failure("superseded"), SHAPE);
        case "aborted":
          return finish(failure("aborted"), SHAPE);
        case "outOfCoverage":
          return finish(failure("outOfCoverage"), SHAPE);
        case "needEndpoints":
          return finish(failure("unsupported", { detail: "needEndpoints" }), SHAPE);
        case "geoError":
          return finish(
            failure(
              outcome.reason === "denied"
                ? "geoDenied"
                : outcome.reason === "timeout"
                  ? "geoTimeout"
                  : "geoUnavailable",
            ),
            SHAPE,
          );
        case "settled":
          break;
      }
      const plan = bridge.read().plan;
      if (!plan || plan.planId !== outcome.planId) return finish(failure("superseded"), SHAPE);
      return finish(
        summarizePlan(plan, listHighLevelTargets()),
        SHAPE,
        {
          arrays: [
            { path: "targets", mode: "count" },
            { path: "transit.alternatives", mode: "count" },
            { path: "transit.recommended.legLines", mode: "count" },
          ],
        },
      );
    },
  };
}

/** 화면 상태 → 요약 출력(spec §3.4, 순수). 수단 키 부재 = 그 수단을 제공하지 않는 화면. */
export function summarizePlan(
  plan: ToolPlan,
  targets: Array<{ id: string; label: string }>,
): Record<string, unknown> {
  const transit = plan.transit
    ? {
        outcome: plan.transit.outcome,
        recommended: plan.transit.routes[0]
          ? {
              routeKey: plan.transit.routes[0].routeKey,
              totalMinutes: plan.transit.routes[0].summary.totalMinutes,
              transfers: plan.transit.routes[0].summary.transfers,
              fare: plan.transit.routes[0].summary.fare,
              walkMinutes: plan.transit.routes[0].summary.walkMinutes,
              legLines: plan.transit.routes[0].legLines,
            }
          : undefined,
        alternatives: plan.transit.routes.slice(1).map((r) => ({
          routeKey: r.routeKey,
          oneLine: r.oneLine,
          highlight: r.highlight,
        })),
        totalCandidates: plan.transit.routes.length,
      }
    : undefined;
  const walk = plan.walk
    ? {
        outcome: plan.walk.outcome,
        distanceMeters: plan.walk.distanceMeters,
        durationSeconds: plan.walk.durationSeconds,
        stepCount: plan.walk.outcome === "done" ? plan.walk.steps.length : undefined,
        stepFree: plan.walk.stepFree,
        stepFreeNotice: plan.walk.stepFreeNotice,
      }
    : undefined;
  const car = plan.car
    ? {
        outcome: plan.car.outcome,
        distanceMeters: plan.car.distanceMeters,
        durationSeconds: plan.car.durationSeconds,
        guideCount: plan.car.outcome === "done" ? plan.car.steps.length : undefined,
      }
    : undefined;
  return {
    ok: true,
    planId: plan.planId,
    resolved: plan.resolved,
    transit,
    walk,
    car,
    targets,
  };
}
