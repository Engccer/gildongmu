"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Coord, JourneyStopSearchResult, Place, PlaceSearchResult } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { haversineMeters } from "@/lib/geo";
import { stationLayoutKind } from "@/lib/station-phone";
import { journeyLineHint, type JourneyStationPick } from "@/lib/journey/journey-lines";

/** 정류장 이름 검색이 받는 길이(라우트 `/api/route/journey/stops`와 같은 범위). */
const STOP_QUERY_MIN = 2;
const STOP_QUERY_MAX = 30;
/** 후보는 역·정류장 각각 상위 5(끝점 칸 미니 검색과 같은 폭). */
const CANDIDATE_LIMIT = 5;

/** 정류장 후보 한 줄(E70-e) — 역 칸과 입구 칸(E77)이 같은 줄을 쓴다. */
export type StopCandidate = { name: string; lat: number; lng: number; distance: number | null; key: string };

type Candidates = {
  stations: Place[];
  stops: StopCandidate[];
  truncated: boolean;
};

/**
 * 정류장 이름 검색(`/api/route/journey/stops`) — 역 칸과 입구 칸(E77 spec §3.1)의 공용 경로. 기준 좌표(출발·도착 칸의 확정
 * 좌표 중 있는 것)가 없거나 게이트가 거짓이거나 길이가 범위 밖이면 부르지 않는다(`wanted: false`). 거리는 첫 기준 좌표에서 잰다.
 * `failed`는 요청 실패와 응답 안의 일부 원천 실패를 함께 본다(0건과 실패를 뭉개지 않는다, 3-state).
 */
export async function searchStopCandidates(
  q: string,
  stopRefs: { origin: Coord | null; dest: Coord | null },
  canSearchStops: boolean,
): Promise<{ wanted: boolean; stops: StopCandidate[]; failed: boolean; truncated: boolean }> {
  const refs = [stopRefs.origin, stopRefs.dest].filter((c): c is Coord => c !== null);
  const wanted = canSearchStops && refs.length > 0 && q.length >= STOP_QUERY_MIN && q.length <= STOP_QUERY_MAX;
  if (!wanted) return { wanted, stops: [], failed: false, truncated: false };
  const params = new URLSearchParams({ q });
  if (stopRefs.origin) params.set("origin", `${stopRefs.origin.lat},${stopRefs.origin.lng}`);
  if (stopRefs.dest) params.set("dest", `${stopRefs.dest.lat},${stopRefs.dest.lng}`);
  let body: JourneyStopSearchResult | { outOfCoverage: true };
  try {
    const r = await fetch(`/api/route/journey/stops?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    body = (await r.json()) as JourneyStopSearchResult | { outOfCoverage: true };
  } catch {
    return { wanted, stops: [], failed: true, truncated: false };
  }
  const result = "stops" in body ? body : null;
  const reference = refs[0];
  const stops = (result?.stops ?? []).slice(0, CANDIDATE_LIMIT).map((s, i) => ({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    distance: haversineMeters(reference.lat, reference.lng, s.lat, s.lng),
    key: `${s.source}:${s.stopNo ?? i}:${s.lat},${s.lng}`,
  }));
  return { wanted, stops, failed: result?.failed === true, truncated: result?.truncated === true };
}

/**
 * 여정의 갈아탈 역·정류장 칸(E70-f spec §3). 끝점 칸(`EndpointField`)과 같은 입력 + [검색] 모양이되 **후보가 역과 정류장뿐이다**:
 * `/api/places` 중 `stationLayoutKind`가 지하철·기차역인 것 + 정류장 이름 검색(`canSearchStops`일 때). 고르는 즉시 칸이 확정되는
 * 흐름이라 역이 아닌 것을 보였다가 거절하지 않는다(iOS `notStation` 통지는 웹에 없다).
 *
 * 통지는 화면 단일 창구(`announce`, A40)로만 낸다. 후보가 오면 첫 후보로, 고르면 목록 제거 전에 `focusAfterResolve`로 포커스를
 * 선점 이동한다(포커스를 쥔 요소를 없애는 전이, 헌장 §5).
 */
export function JourneyStationField({
  label,
  value,
  onResolve,
  onEdit,
  stopRefs,
  canSearchStops,
  registerInput,
  focusAfterResolve,
  announce,
}: {
  label: string;
  value: JourneyStationPick | null;
  onResolve: (pick: JourneyStationPick) => void;
  /** 확정된 칸의 글자를 고쳤다 — 부모가 확정을 풀고 결과를 버린다(끝점 칸과 같은 원자 상태). */
  onEdit: () => void;
  /** 정류장 검색의 기준 좌표(출발·도착 칸의 확정 좌표 중 있는 것). 비면 정류장을 찾지 않는다. */
  stopRefs: { origin: Coord | null; dest: Coord | null };
  canSearchStops: boolean;
  registerInput?: (el: HTMLInputElement | null) => void;
  focusAfterResolve: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations("directions");
  const tJourney = useTranslations("journey");
  const inputId = useId();
  const [text, setText] = useState(value?.label ?? "");
  // 밖에서 확정 값이 바뀌면(최근 경로 활성화) 입력 글자도 그 이름으로 — 칸이 옛 글자를 말하지 않게(리뷰 m6). 렌더 중 파생 조정.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (value) setText(value.label);
  }
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const reqRef = useRef(0);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (revision > 0) firstRef.current?.focus();
  }, [revision]);

  async function search() {
    const q = text.trim();
    if (!q) return;
    const myId = ++reqRef.current;
    const [placesRes, stopRes] = await Promise.all([
      fetch(`/api/places?query=${encodeURIComponent(q)}&lang=ko`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { status: "fulfilled" as const, value: (await r.json()) as PlaceSearchResult };
        })
        .catch(() => ({ status: "rejected" as const })),
      searchStopCandidates(q, stopRefs, canSearchStops),
    ]);
    if (myId !== reqRef.current) return;
    const stations =
      placesRes.status === "fulfilled"
        ? placesRes.value.places.filter((p) => stationLayoutKind(p) !== null).slice(0, CANDIDATE_LIMIT)
        : [];
    const stops = stopRes.stops;
    const stopsWanted = stopRes.wanted;
    const stopsFailed = stopRes.failed;
    if (listRef.current?.contains(document.activeElement)) {
      document.getElementById(inputId)?.focus();
    }
    setCandidates({ stations, stops, truncated: stopRes.truncated });
    const count = stations.length + stops.length;
    if (count > 0) {
      const base = t("candidateCount", { count });
      announce(stopsFailed ? `${base} ${tJourney("stopSearchFailed")}` : base);
      setRevision((r) => r + 1);
    } else if (placesRes.status === "rejected" && (!stopsWanted || stopsFailed)) {
      announce(t("candidateError"));
    } else {
      announce(stopsFailed ? `${t("candidateNone")} ${tJourney("stopSearchFailed")}` : t("candidateNone"));
    }
  }

  function pick(p: JourneyStationPick) {
    focusAfterResolve();
    setCandidates(null);
    setText(p.label);
    onResolve(p);
  }

  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={inputId}
          ref={(el) => registerInput?.(el)}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCandidates(null);
            if (value) onEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          className="min-h-11 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void search()}
          className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
        >
          {tJourney("searchField", { field: label })}
        </button>
      </div>
      {candidates && (candidates.stations.length > 0 || candidates.stops.length > 0 || candidates.truncated) && (
        <ul ref={listRef} className="mt-1">
          {candidates.stations.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                ref={i === 0 ? firstRef : undefined}
                onClick={() =>
                  pick({
                    label: p.name,
                    lat: p.lat,
                    lng: p.lng,
                    ...(journeyLineHint(p) ? { line: journeyLineHint(p) } : {}),
                  })
                }
                className="min-h-11 w-full text-left text-sm underline"
              >
                {joinText(p.name, p.roadAddress || p.address)}
              </button>
            </li>
          ))}
          {candidates.stops.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                ref={candidates.stations.length === 0 && i === 0 ? firstRef : undefined}
                onClick={() => pick({ label: s.name, lat: s.lat, lng: s.lng, kind: "stop" })}
                className="min-h-11 w-full text-left text-sm underline"
              >
                {joinText(s.name, tJourney("busStopKind"), s.distance !== null && formatDistance(s.distance))}
              </button>
            </li>
          ))}
          {candidates.truncated && <li className="text-sm">{tJourney("stopSearchTruncated")}</li>}
        </ul>
      )}
    </div>
  );
}
