/**
 * #3 `get_place_info`(spec §3.3) — `ref`를 동결 스냅샷에서 한 번 해석해 상세로 이동하고, 요청한 축을
 * 화면 소유 명령(`ensureLoaded`/`refresh`)으로 실행해 **같은 봉투**로 돌려준다. 문장은 화면과 같은
 * 함수(place-lines)가 만든 것을 소스가 `data`에 실어 준 그대로다(도구는 i18n을 모른다).
 */
import { finish, withFailure, type CapPlan, type Shape } from "../output";
import { resolveRef } from "../place-refs";
import { checkBudget, consumeBudget, type BudgetBucket } from "../tool-budget";
import type { Op } from "../tool-lock";
import { failure, type ToolFailure, type WebMcpTool } from "../types";
import { bridgeOf } from "../view-registry";
import type {
  ArrivalsAxisData,
  AxisEntry,
  AxisKey,
  AxisOutcome,
  BarrierFreeAxisData,
  HomeBridge,
  KorailFacilitiesAxisData,
  MetroFacilitiesAxisData,
  PlaceBridge,
  StationMetaAxisData,
  TimetableAxisData,
} from "./context";
import { ensureOpenedPlace, ensurePlace, isFailure, withOp } from "./ensure-view";

/** 도구 입력의 축 이름(소스 키 `facilitiesMetro`는 `facilities`에 접힌다). */
export type RequestAxis = "basic" | "timetable" | "facilities" | "arrivals" | "barrierFree";
const AXES: readonly RequestAxis[] = ["basic", "timetable", "facilities", "arrivals", "barrierFree"];

const LINES: Shape = [true];
export const SHAPE = withFailure({
  ok: true,
  view: true,
  ref: true,
  name: true,
  category: true,
  isStation: true,
  basic: {
    status: true,
    address: { english: true, road: true, jibun: true },
    phone: true,
    stationMeta: { status: true, lines: LINES, linesReturnedCount: true, linesTotalCount: true, refreshError: true },
  },
  timetable: {
    status: true,
    basis: true,
    lines: [{ line: true, first: true, last: true, direction: true, coverage: true }],
    linesReturnedCount: true,
    linesTotalCount: true,
    refreshError: true,
    retryAfterMs: true,
  },
  facilities: {
    status: true,
    korail: { status: true, lines: LINES, linesReturnedCount: true, linesTotalCount: true, retryAfterMs: true },
    metro: {
      status: true,
      groups: [{ name: true, lines: LINES }],
      groupsReturnedCount: true,
      groupsTotalCount: true,
      supplementFailed: true,
      retryAfterMs: true,
    },
    refreshError: true,
  },
  arrivals: {
    status: true,
    items: [{ line: true, direction: true, message: true, state: { kind: true } }],
    itemsReturnedCount: true,
    itemsTotalCount: true,
    refreshError: true,
    retryAfterMs: true,
  },
  barrierFree: {
    status: true,
    match: { kind: true, facilityCount: true },
    facilities: [{ label: true, value: true }],
    facilitiesReturnedCount: true,
    facilitiesTotalCount: true,
    source: true,
    refreshError: true,
    retryAfterMs: true,
  },
  axesRequested: LINES,
  offset: true,
});

export const DESCRIPTION =
  "Open a place from search_places by ref and return its info exactly as shown: category, addresses, phone; for stations the timetable (first/last trains), accessibility facilities, real-time arrivals; and barrier-free facilities. Pick axes to narrow. If truncated, call again with one axis and offset. refresh re-fetches. The app moves to the place screen.";

/** 축 → 소스 키(시설은 코레일·서울 둘). */
function sourceKeys(axis: RequestAxis): AxisKey[] {
  return axis === "facilities" ? ["facilities", "facilitiesMetro"] : [axis];
}
function bucketOf(key: AxisKey): BudgetBucket | null {
  switch (key) {
    case "timetable":
      return "stationTimetable";
    case "facilities":
    case "facilitiesMetro":
      return "stationFacilities";
    case "arrivals":
      return "stationArrivals";
    case "barrierFree":
      return "barrierFree";
    default:
      return null; // basic(역 메타)은 정적 seed — 예산 대상 아님
  }
}

/** 단일 축 페이징의 배열 경로(spec §3.3 상한 순서와 같은 자리). */
const PAGE_PATH: Record<RequestAxis, string> = {
  arrivals: "arrivals.items",
  facilities: "facilities.metro.groups",
  timetable: "timetable.lines",
  basic: "basic.stationMeta.lines",
  barrierFree: "barrierFree.facilities",
};
const CAP_ORDER: string[] = [
  "arrivals.items",
  "facilities.metro.groups",
  "facilities.korail.lines",
  "timetable.lines",
  "basic.stationMeta.lines",
  "barrierFree.facilities",
];

type AxisResult = Record<string, unknown>;

/** 축 실행 한 번 — 예산(fetch 시에만) → 명령 → 결과 투영. `aborted`는 호출 전체의 실패다. */
async function runKey(
  entry: AxisEntry,
  key: AxisKey,
  refresh: boolean,
  op: Op,
): Promise<{ kind: "ok"; status: string; snapshot?: AxisOutcome & { kind: "settled" }; retryAfterMs?: number } | { kind: "aborted" }> {
  const needsFetch = entry.present && (refresh || entry.read().status === "idle");
  const bucket = bucketOf(key);
  if (needsFetch && bucket) {
    const b = checkBudget(bucket);
    if (!b.ok) return { kind: "ok", status: "cooldown", retryAfterMs: b.retryAfterMs };
    consumeBudget(bucket);
  }
  const out = refresh ? await entry.refresh(op) : await entry.ensureLoaded(op);
  switch (out.kind) {
    case "aborted":
      return { kind: "aborted" };
    case "settled":
      return { kind: "ok", status: out.snapshot.status, snapshot: out };
    default:
      return { kind: "ok", status: out.kind };
  }
}

function slice<T>(arr: readonly T[], offset: number | undefined): T[] {
  return offset ? arr.slice(offset) : [...arr];
}

export function getPlaceInfoTool(): WebMcpTool {
  return {
    name: "get_place_info",
    description: DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "A place or address ref from search_places." },
        axes: {
          type: "array",
          items: { type: "string", enum: [...AXES] },
          description: "Which info to return. Omit for all that apply (non-stations: basic, barrierFree).",
        },
        refresh: { type: "boolean", description: "Re-fetch the requested axes (real-time arrivals etc.)." },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Item offset for paging one axis (requires exactly one axis in axes).",
        },
      },
      required: ["ref"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input, context) =>
      withOp(
        "get_place_info",
        context?.signal,
        async (op) => {
          const home = bridgeOf<HomeBridge>("home")?.bridge;
          if (!home) return finish(failure("unsupported", { detail: "noHomeView" }), SHAPE);
          const axesReq = parseAxes(input.axes);
          if (axesReq === null) return finish(failure("unsupported", { detail: "axes" }), SHAPE);
          // offset 0도 "페이징 요청"이다(단일 축 page 모드) — 없음은 undefined뿐.
          const offset =
            typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset >= 0
              ? input.offset
              : undefined;
          if (offset !== undefined && axesReq?.length !== 1) {
            return finish(failure("unsupported", { detail: "offsetNeedsSingleAxis" }), SHAPE);
          }
          const refresh = input.refresh === true;

          const read = home.read();
          const r = resolveRef(input.ref, read.attempt === null ? null : home.snapshotFor(read.attempt));
          if (r.kind === "staleResult") {
            return finish(failure("staleResult", { recovery: "search_places", query: read.query }), SHAPE);
          }
          if (r.kind === "notFound") return finish(failure("notFound"), SHAPE);

          const bridge =
            r.kind === "place"
              ? await ensurePlace(r.place, op)
              : await ensureOpenedPlace(op, async () => {
                  const o = await home.openAddress(r.address, op);
                  if (o.ok) return null;
                  return o.reason === "geocodeFailed" ? failure("geocodeFailed") : failure(o.reason);
                });
          if (isFailure(bridge)) return finish(bridge, SHAPE);

          const info = bridge.read();
          const wanted: RequestAxis[] =
            axesReq ?? (info.isStation ? [...AXES] : ["basic", "barrierFree"]);
          const results: Record<string, AxisResult> = {};
          for (const axis of wanted) {
            const perKey: Partial<Record<AxisKey, Awaited<ReturnType<typeof runKey>>>> = {};
            for (const key of sourceKeys(axis)) {
              const out = await runKey(bridge.axes[key], key, refresh, op);
              if (out.kind === "aborted") return finish(failure("aborted"), SHAPE);
              perKey[key] = out;
            }
            results[axis] = projectAxis(axis, perKey, info, offset);
          }
          return finish(
            {
              ok: true,
              view: "place",
              ref: r.ref,
              name: info.name,
              category: info.category,
              isStation: info.isStation,
              ...results,
              axesRequested: wanted,
              offset,
            },
            SHAPE,
            capPlan(wanted, offset),
          );
        },
        (running) => finish(failure("busy", { running }), SHAPE),
      ),
  };
}

function parseAxes(raw: unknown): RequestAxis[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RequestAxis[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !(AXES as readonly string[]).includes(v)) return null;
    if (!out.includes(v as RequestAxis)) out.push(v as RequestAxis);
  }
  return out;
}

function capPlan(wanted: RequestAxis[], offset: number | undefined): CapPlan {
  if (wanted.length === 1 && offset !== undefined) {
    return { arrays: [{ path: PAGE_PATH[wanted[0]], mode: "page" }] };
  }
  return { arrays: CAP_ORDER.map((path) => ({ path, mode: "count" as const })) };
}

type KeyOut = Awaited<ReturnType<typeof runKey>> & { kind: "ok" };

function base(out: KeyOut): AxisResult {
  const snap = out.snapshot?.snapshot;
  return {
    status: out.status,
    retryAfterMs: out.retryAfterMs,
    refreshError: snap?.refreshError,
  };
}

function projectAxis(
  axis: RequestAxis,
  perKey: Partial<Record<AxisKey, Awaited<ReturnType<typeof runKey>>>>,
  info: ReturnType<PlaceBridge["read"]>,
  offset: number | undefined,
): AxisResult {
  if (axis === "basic") {
    const meta = perKey.basic as KeyOut;
    const data = meta.snapshot?.snapshot.data as StationMetaAxisData | undefined;
    return {
      status: "done",
      address: info.addressLines,
      phone: info.phone,
      stationMeta: info.isStation
        ? { ...base(meta), lines: data ? slice(data.lines, offset) : undefined }
        : undefined,
    };
  }
  if (axis === "facilities") {
    const korail = perKey.facilities as KeyOut;
    const metro = perKey.facilitiesMetro as KeyOut;
    const kd = korail.snapshot?.snapshot.data as KorailFacilitiesAxisData | undefined;
    const md = metro.snapshot?.snapshot.data as MetroFacilitiesAxisData | undefined;
    return {
      status: combineStatus(korail.status, metro.status),
      korail: { status: korail.status, retryAfterMs: korail.retryAfterMs, lines: kd ? [...kd.lines] : undefined },
      metro: {
        status: metro.status,
        retryAfterMs: metro.retryAfterMs,
        groups: md ? slice(md.groups, offset) : undefined,
        supplementFailed: md?.supplementFailed || undefined,
      },
      refreshError: korail.snapshot?.snapshot.refreshError || metro.snapshot?.snapshot.refreshError || undefined,
    };
  }
  const out = perKey[axis] as KeyOut;
  const data = out.snapshot?.snapshot.data;
  if (axis === "timetable") {
    const d = data as TimetableAxisData | undefined;
    return { ...base(out), basis: d?.basis, lines: d ? slice(d.lines, offset) : undefined };
  }
  if (axis === "arrivals") {
    const d = data as ArrivalsAxisData | undefined;
    return { ...base(out), items: d ? slice(d.items, offset) : undefined };
  }
  const d = data as BarrierFreeAxisData | undefined;
  return {
    ...base(out),
    match: d?.match,
    facilities: d ? slice(d.facilities, offset) : undefined,
    source: d?.source,
  };
}

/** 복합 축(시설)의 결합 status: 둘 다 done → done, 하나만 → partial, 그 밖엔 더 나쁜 쪽. */
function combineStatus(a: string, b: string): string {
  if (a === "done" && b === "done") return "done";
  if (a === "done" || b === "done") return "partial";
  for (const worst of ["error", "cooldown", "superseded", "unknown", "loading", "idle", "empty"]) {
    if (a === worst || b === worst) return worst;
  }
  return a;
}

export type { ToolFailure };
