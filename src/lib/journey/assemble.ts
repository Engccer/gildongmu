import { getCarRoute } from "../car-route";
import { haversineMeters } from "../geo";
import { getTransitCandidates } from "../providers/odsay";
import { selectTransitRoutes } from "../providers/odsay-select";
import { searchSubwayExitsKakao, searchTaxiStandsKakao, type KakaoLocalDocument } from "../providers/kakao-local";
import { normalizeStationName } from "../station-match";
import type { CarRouteBriefing, Coord, EgressOption, JourneyResult, JourneyStationInput, JourneyVariant, TransitRoute } from "../types";
import { planTaxiCalls, type TaxiStart } from "./budget";
import { boardOppositeOnly, findDesignated, firstVehicle, lastVehicle, legEndStop, missingSide } from "./designated";
import { exitQueryStationName } from "./display";
import { chooseFastest, exitsForLine, parseExitDoc, pickStand, type ParsedExit, type StandPick } from "./egress";
import { trimJourneyTransit } from "./trim";

export interface JourneyRequest {
  from: Coord;
  to: Coord;
  board?: JourneyStationInput;
  alight?: JourneyStationInput;
  /** E70-e 옵트인: 정류장 입력을 받고, 역 입력이 버스 경로(약한 맞음)·버스만 후보로도 맞춰진다. */
  stops?: boolean;
}

export interface JourneyDeps {
  candidates: typeof getTransitCandidates;
  car: (origin: Coord, dest: Coord) => Promise<CarRouteBriefing>;
  exits: (stationDisplay: string, coord: Coord) => Promise<KakaoLocalDocument[]>;
  stands: (stationDisplay: string, coord: Coord) => Promise<KakaoLocalDocument[]>;
}

export type JourneyReserve = (cost: number) => "ok" | "rateLimited" | "budgetExhausted";

export type JourneyOutcome =
  | { kind: "ok"; result: JourneyResult }
  | { kind: "rateLimited" }
  | { kind: "budgetExhausted" };

/** 실제 provider. 택시 시간은 기하가 필요 없어 `includeGeometry` 없이(안내 세션은 시작 뒤 스스로 다시 조회한다, spec §6.3). */
export const journeyDeps: JourneyDeps = {
  candidates: getTransitCandidates,
  car: (origin, dest) => getCarRoute({ origin, dest }),
  exits: searchSubwayExitsKakao,
  stands: searchTaxiStandsKakao,
};

const coordKey = (c: Coord) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
const minutesOf = (b: CarRouteBriefing) => Math.round(b.durationSeconds / 60);

/**
 * 같은 탈 것들로 이루어진 경로인가 — 지하철만 재조회(`modeAxis`)의 후보는 routeKey 접두가 달라(`s0`) 같은 경로도
 * 키가 다르다. 탈것 leg의 (수단, 노선, 승차, 하차)로 비교한다(판정 13 "두 변형이 같으면 한 경로").
 */
function sameItinerary(a: TransitRoute, b: TransitRoute): boolean {
  const sig = (r: TransitRoute) =>
    JSON.stringify(r.legs.filter((l) => l.mode !== "walk").map((l) => [l.mode, l.lineName, l.fromName, l.toName]));
  return sig(a) === sig(b);
}

interface AlightGroup {
  stopCoord: Coord;
  exits: ParsedExit[];
  stand: StandPick | null;
  lookupFailed: boolean;
}

/**
 * 여정 조회(E70 spec §4.2 — **순서가 계약**): ① 대중교통 후보 전체 → ② 지정 역 판정(없으면 지하철만 후보에서 한 번 더)
 * → ③ 추천 → ④ 자르기 → ⑤ 출구 수집(카카오, 무료) → ⑥ Tmap 비용 계산·예약 → ⑦ Tmap 팬아웃 → ⑧ 조립.
 * 예약하지 않은 Tmap 호출은 없다(거절이면 Tmap 0회, 후보가 실패해도 Tmap을 더 부르지 않는다).
 * 조회 실패는 throw(라우트가 502). 대중교통 경로 없음은 `variants: []`.
 *
 * 지금 탄 열차(`board.kind === "aboard"`, E71 spec §4.2)는 같은 파이프라인에서 달라지는 곳이 다섯이다: 지정 판정의 술어
 * (`sideMatch`), 정류장 약 맞음·버스만 조회 없음, 추천 변형 없음(R5), 택시 앞 구간 없음(R6), 못 맞추면 즉시 사실 줄 반환.
 */
export async function getJourney(req: JourneyRequest, deps: JourneyDeps, reserve: JourneyReserve): Promise<JourneyOutcome> {
  const designation = { board: req.board, alight: req.alight };
  const aboard = req.board?.kind === "aboard";
  const origin = req.board?.coord ?? req.from;
  const dest = req.alight?.coord ?? req.to;

  // ①② — 지정 역 경로는 선정이 자르기 전의 전체 후보 위에서 찾는다(선정 밖에 있을 수 있다).
  const all = await deps.candidates({ origin, dest, includeStops: true });
  if (!all || all.ranked.length === 0) return { kind: "ok", result: { variants: [] } };
  const stops = req.stops === true;
  // 강이 약보다 앞선다 — 풀 사이에서도(spec E70-e §4.3): ① 전체 강 ② 지하철만 강(모든 지정 쪽이 역일 때만)
  // ③ 이미 받은 풀 강·약(호출 없음) ④ 버스만 강·약. 찾으면 멈춘다.
  const pools: TransitRoute[][] = [all.ranked];
  const allStations = (!req.board || req.board.kind !== "stop") && (!req.alight || req.alight.kind !== "stop");
  let designated = findDesignated(all.ranked, designation);
  let designatedMissing: JourneyResult["designatedMissing"];
  if (!designated && allStations) {
    const subway = await deps.candidates({ origin, dest, includeStops: true, modeAxis: "subwayOnly" });
    if (subway) pools.push(subway.ranked);
    designated = subway ? findDesignated(subway.ranked, designation) : null;
  }
  if (!designated && stops && !aboard) {
    for (const pool of pools) {
      designated = findDesignated(pool, designation, { allowWeak: true });
      if (designated) break;
    }
    if (!designated) {
      const busOnly = await deps.candidates({ origin, dest, includeStops: true, modeAxis: "busOnly" });
      if (busOnly) pools.push(busOnly.ranked);
      designated = busOnly ? findDesignated(busOnly.ranked, designation, { allowWeak: true }) : null;
    }
  }
  if (!designated && !aboard) designatedMissing = { side: missingSide(pools, designation, stops) };

  // ③ 추천 = 기존 선정의 1순위. 지정 역 경로와 같으면 변형 하나(판정 13).
  //   aboard는 추천을 내지 않는다(R5) — 이미 열차 안이라 다른 곳에서 타는 경로는 쓸 수 없다. 역 B까지 맞는 경로가 없으면
  //   aboard만 맞는 경로를 recommended로 내고(여전히 그 열차를 탄다), 그것도 없으면 사실 줄만 두고 끝낸다.
  let picked: Array<{ kind: JourneyVariant["kind"]; route: TransitRoute }>;
  if (aboard) {
    let route = designated;
    if (!route && req.alight) {
      for (const pool of pools) {
        route = findDesignated(pool, { board: req.board });
        if (route) break;
      }
      if (route) designatedMissing = { side: "alight" };
    }
    if (!route) {
      const opposite = boardOppositeOnly(pools, req.board!);
      return { kind: "ok", result: { variants: [], designatedMissing: { side: "board", ...(opposite ? { oppositeDirection: true as const } : {}) } } };
    }
    picked = [{ kind: designated ? "designated" : "recommended", route }];
  } else {
    const recommended = selectTransitRoutes(all.ranked)[0];
    picked = designated
      ? [
          { kind: "designated", route: designated },
          ...(sameItinerary(designated, recommended) ? [] : [{ kind: "recommended" as const, route: recommended }]),
        ]
      : [{ kind: "recommended", route: recommended }];
  }

  // ④ 자르기(D3) — 지정한 쪽만.
  const variants = picked.map((p) => {
    const transit = trimJourneyTransit(p.route, { trimBoard: !!req.board, trimAlight: !!req.alight });
    const first = firstVehicle(transit);
    const last = lastVehicle(transit);
    const boardStop = first ? legEndStop(first, "board") : undefined;
    const alightStop = last ? legEndStop(last, "alight") : undefined;
    if (!boardStop || !alightStop) throw new Error("여정 조립 실패: 탈것 정류 좌표 없음(includeStops 누락?)");
    return { ...p, transit, last: last!, boardStop, alightStop };
  });

  // ⑤ 출구·승강장 — 하차 지정 시만. 원시 검색은 하차역 이름 키 단위로 한 번(역끼리는 병렬), 선정은 (하차역, 노선)
  //   그룹마다(§4.5-2). 질의 이름은 괄호 부기를 뗀 것(`exitQueryStationName` — 표시 이름이 아니다).
  const groupOf = new Map<number, number>(); // 변형 index → 그룹 index
  const groups: AlightGroup[] = [];
  if (req.alight) {
    type Raw = { exits: KakaoLocalDocument[] | null; stands: KakaoLocalDocument[] };
    const rawByStation = new Map<string, Promise<Raw>>();
    const pending: Array<{ key: string; build: (raw: Raw | null) => AlightGroup; stationKey: string | null }> = [];
    for (const [i, v] of variants.entries()) {
      const subway = v.last.mode === "subway";
      const stationKey = normalizeStationName(v.alightStop.name);
      const key = subway ? `${stationKey}|${v.last.lineName ?? ""}` : `stop|${coordKey(v.alightStop)}`;
      let g = pending.findIndex((p) => p.key === key);
      if (g < 0) {
        g = pending.length;
        const stopCoord = { lat: v.alightStop.lat, lng: v.alightStop.lng };
        const query = exitQueryStationName(v.alightStop.name);
        if (subway && !rawByStation.has(stationKey)) {
          rawByStation.set(
            stationKey,
            Promise.all([
              deps.exits(query, stopCoord).catch((e) => {
                console.warn("[journey] 카카오 출구 조회 실패:", e);
                return null;
              }),
              // 승강장은 선택 정보다 — 조회 실패를 출구 실패 문장으로 바꾸지 않고 승강장 없음으로 둔다(로그만).
              deps.stands(query, stopCoord).catch((e) => {
                console.warn("[journey] 카카오 승강장 조회 실패:", e);
                return [] as KakaoLocalDocument[];
              }),
            ]).then(([exits, stands]) => ({ exits, stands })),
          );
        }
        const lineName = v.last.lineName;
        pending.push({
          key,
          stationKey: subway ? stationKey : null,
          // 버스로 끝나는 변형: 출구가 없다 — 택시는 내린 정류장에서(kind none).
          build: (raw) =>
            !raw
              ? { stopCoord, exits: [], stand: null, lookupFailed: false }
              : raw.exits === null
                ? // 출구 조회 실패 그룹의 후보는 하차 정류 좌표 하나다(§4.5-7) — 승강장을 실으면 「출구 정보를 불러오지
                  //   못했습니다. 내린 역에서 택시로 N분」의 N이 승강장 출발 값이 되어 문장과 출발 자리가 어긋난다.
                  { stopCoord, exits: [], stand: null, lookupFailed: true }
                : {
                    stopCoord,
                    exits: exitsForLine(raw.exits.flatMap((d) => parseExitDoc(d, query) ?? []), lineName),
                    stand: pickStand(raw.stands, stopCoord),
                    lookupFailed: false,
                  },
        });
      }
      groupOf.set(i, g);
    }
    for (const p of pending) groups.push(p.build(p.stationKey ? await rawByStation.get(p.stationKey)! : null));
  }

  // ⑥ 비용 계산·예약 — 기본 변형의 그룹이 [0]이 되도록 변형 순서대로 만들었다.
  const plan = planTaxiCalls({
    taxiInDests: req.board && !aboard ? variants.map((v) => ({ lat: v.boardStop.lat, lng: v.boardStop.lng })) : [],
    groups: groups.map((g) => ({ exits: g.exits, stand: g.stand, fallbackStop: g.stopCoord })),
    to: req.to,
  });
  const reserved = reserve(plan.cost);
  if (reserved !== "ok") return { kind: reserved };

  // ⑦ Tmap 팬아웃. 택시 앞 실패는 여정 전체 실패(택시 없는 여정은 여정이 아니다), 택시 뒤는 후보별로.
  //   예약은 Tmap 호출 수다 — Tmap이 실패한 후보의 provider 폴백(카카오모빌리티, `getCarRoute`)은 Tmap 예산 밖이고,
  //   후보가 전부 실패해도 Tmap을 더 부르지 않는다.
  const outStarts = new Map<string, Coord>();
  for (const g of plan.groups) for (const s of g.starts) outStarts.set(coordKey(s.coord), s.coord);
  const [inBriefings, outBriefings] = await Promise.all([
    Promise.all(plan.taxiIn.map((c) => deps.car(req.from, c))),
    Promise.all(
      [...outStarts.values()].map((c) =>
        deps.car(c, req.to).catch((e) => {
          console.warn("[journey] 택시 뒤 후보 실패(그 후보만 뺀다):", e);
          return null;
        }),
      ),
    ),
  ]);
  const taxiInResults = new Map(plan.taxiIn.map((c, i) => [coordKey(c), inBriefings[i]]));
  const taxiOutResults = new Map([...outStarts.keys()].map((k, i) => [k, outBriefings[i]]));

  // ⑧ 조립.
  const egressFor = (groupIndex: number): JourneyVariant["egress"] => {
    const group = groups[groupIndex];
    const withTimes = plan.groups[groupIndex].starts.flatMap((s: TaxiStart) => {
      const taxiOut = taxiOutResults.get(coordKey(s.coord));
      if (!taxiOut) return [];
      const option: EgressOption = {
        kind: s.kind,
        label: s.label,
        ...(s.lineName !== undefined ? { lineName: s.lineName } : {}),
        placeName: s.placeName,
        coord: s.coord,
        taxiOut,
      };
      return [option];
    });
    if (withTimes.length === 0) throw new Error("여정 조립 실패: 택시 뒤 후보가 전부 실패했다");
    const exits = withTimes.filter((o) => o.kind === "exit");
    const fastest = chooseFastest(
      exits.map((option) => ({
        option,
        walkFromStopM: haversineMeters(group.stopCoord.lat, group.stopCoord.lng, option.coord.lat, option.coord.lng),
      })),
    );
    const stand = withTimes.find((o) => o.kind === "stand");
    const none = withTimes.find((o) => o.kind === "none");
    const options = [fastest, stand].filter((o): o is EgressOption => !!o);
    return { options: options.length > 0 ? options : [none!], ...(group.lookupFailed ? { lookupFailed: true as const } : {}) };
  };

  const result: JourneyResult = {
    variants: variants.map((v, i): JourneyVariant => {
      const taxiIn = req.board && !aboard ? taxiInResults.get(coordKey(v.boardStop)) : undefined;
      const g = groupOf.get(i);
      const egress = g !== undefined ? egressFor(g) : undefined;
      const taxiOut = egress?.options[0].taxiOut;
      return {
        kind: v.kind,
        boardStation: { name: v.boardStop.name, coord: { lat: v.boardStop.lat, lng: v.boardStop.lng } },
        alightStation: { name: v.alightStop.name, coord: { lat: v.alightStop.lat, lng: v.alightStop.lng } },
        ...(taxiIn ? { taxiIn } : {}),
        transit: v.transit,
        ...(egress ? { egress } : {}),
        totals: {
          minutes: (taxiIn ? minutesOf(taxiIn) : 0) + v.transit.summary.totalMinutes + (taxiOut ? minutesOf(taxiOut) : 0),
          taxiFare: (taxiIn?.taxiFare ?? 0) + (taxiOut?.taxiFare ?? 0),
          transitFare: v.transit.summary.fare,
        },
      };
    }),
    ...(designatedMissing ? { designatedMissing } : {}),
  };
  return { kind: "ok", result };
}
