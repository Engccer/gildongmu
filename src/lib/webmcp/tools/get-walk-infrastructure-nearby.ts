import { isInKorea } from "@/lib/coverage";
import { awaitGeolocation } from "@/lib/geolocation";
import type { WalkInfrastructure } from "@/lib/walk-infra";
import { makeCooldown } from "../dom";
import { finish, withFailure } from "../output";
import { failure, type WebMcpTool } from "../types";

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
/** 쿨다운 10초(spec §3.10·§7). */
const COOLDOWN_MS = 10_000;

/** 출력 표 — 좌표(`lat`·`lng`)는 없다. 방위·거리·종류·이름만(§3.10). */
export const SHAPE = withFailure({
  ok: true,
  audioSignals: {
    status: true,
    reason: true,
    deviceCount: true,
    baseDate: true,
    sites: [{ bearing: true, distanceMeters: true, deviceCount: true }],
  },
  osm: {
    status: true,
    reason: true,
    totalCount: true,
    listedCount: true,
    truncated: true,
    crossingTotal: true,
    tactileTotal: true,
    features: [
      {
        kind: true,
        bearing: true,
        distanceMeters: true,
        crossingSignal: true,
        tactilePaving: true,
        hostFeature: true,
      },
    ],
  },
});

/**
 * #10 `get_walk_infrastructure_nearby`(spec §3.10, readOnly) — 브라우저 위치에 의존하는
 * 유일한 순수 조회. 좌표 인자를 받지 않는다(에이전트가 임의 좌표를 "현재 위치"라 부르는
 * 경로 차단). 이 도구만 대응 화면 섹션이 없다(§1 원칙 ①의 명시적 예외).
 */
export function getWalkInfrastructureNearbyTool(): WebMcpTool {
  const cooldown = makeCooldown(COOLDOWN_MS);
  return {
    name: "get_walk_infrastructure_nearby",
    description:
      "Pedestrian infrastructure within about 150 m of the user's current location: audible traffic signals, crosswalks and tactile paving, each with direction and distance. The location never leaves the browser except to this site's own API. Registry data (Seoul, OpenStreetMap) that may differ from the street. Not shown on this screen.",
    inputSchema: EMPTY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (_input, context) => {
      const now = Date.now();
      const wait = cooldown.remaining(now);
      if (wait > 0) return finish(failure("cooldown", { retryAfterMs: wait }), SHAPE);
      cooldown.mark(now);
      const signal = context?.signal;
      // "지금 어디 있는가"가 답의 일부인 조회는 force:true다(CLAUDE.md 위치 스토어 TTL 함정).
      const geo = await awaitGeolocation({ force: true });
      if (signal?.aborted) return finish(failure("aborted"), SHAPE);
      if (geo.status !== "ready") {
        if (geo.status === "unsupported") return finish(failure("geoUnavailable"), SHAPE);
        const reason = geo.status === "denied" ? geo.reason : undefined;
        return finish(
          failure(reason === "timeout" ? "geoTimeout" : reason === "unavailable" ? "geoUnavailable" : "geoDenied"),
          SHAPE,
        );
      }
      const { lat, lng } = geo.coords;
      if (!isInKorea(lat, lng)) return finish(failure("outOfCoverage"), SHAPE);
      let walk: WalkInfrastructure;
      try {
        const res = await fetch(`/api/walk/nearby?lat=${lat}&lng=${lng}`, { signal });
        if (!res.ok) {
          return finish(failure("unsupported", { detail: `http${res.status}`, retryable: res.status >= 500 }), SHAPE);
        }
        walk = ((await res.json()) as { walk: WalkInfrastructure }).walk;
      } catch {
        if (signal?.aborted) return finish(failure("aborted"), SHAPE);
        return finish(failure("unsupported", { detail: "fetchFailed", retryable: true }), SHAPE);
      }
      const audioSignals =
        walk.audioSignals.status === "ok"
          ? { status: "ok", ...walk.audioSignals.data }
          : walk.audioSignals;
      const osm =
        walk.osm.status === "ok"
          ? {
              status: "ok",
              totalCount: walk.osm.data.totalCount,
              listedCount: walk.osm.data.listedCount,
              truncated: walk.osm.data.truncated,
              crossingTotal: walk.osm.data.crossingTotal,
              tactileTotal: walk.osm.data.tactileTotal,
              features: walk.osm.data.features.map((f) => ({
                kind: f.crossing ? "crossing" : "tactile",
                bearing: f.bearing,
                distanceMeters: f.distanceMeters,
                crossingSignal: f.crossing ? f.crossingSignal : undefined,
                tactilePaving: f.tactilePaving,
                hostFeature: f.hostFeature,
              })),
            }
          : walk.osm;
      return finish(
        { ok: true, audioSignals, osm },
        SHAPE,
        { arrays: [{ path: "osm.features", mode: "count" }, { path: "audioSignals.sites", mode: "count" }] },
      );
    },
  };
}
