import type {
  NearbySubwayStation,
  NearestSubwayStation,
  StationTimetable,
  SubwayStationArrivals,
} from "../types";
import { hasSeoulSubwayRealtimeKey } from "../env";
import { findStationsNear, findStationMetaNear } from "../subway-stations";
import { judgeServiceStatus, kstNowMinutes, parseServiceTime } from "../service-hours";
import { cleanName, fetchSubwayArrivals, withArrivalsEn } from "./seoul-subway-arrival";
import { subwayLineNamesEn } from "../subway-line-names";
import { fetchStationTimetable } from "./tago-subway";

/**
 * 내 주변 서울 지하철 실시간 도착(A2 홈 진입점) — 좌표→근접역→역별 실시간 합성.
 *
 * 버스/따릉이 nearby는 좌표를 그대로 API에 넘기지만(A-2/bikeList), 서울 지하철
 * 실시간(OA-12764)은 **역명** 기반이라 좌표를 직접 못 쓴다. 그래서
 *   1) A3 정적 seed(findStationsNear, Haversine)로 반경 내 근접역을 거리순으로 식별,
 *   2) 각 역명으로 실시간 도착(fetchSubwayArrivals)을 병렬 조회,
 *   3) 실시간이 빈 역만 시간표(TAGO)를 조인해 운행 시간 밖인지 판정,
 *   4) 부분 실패를 BusStop.arrivalStatus와 동형으로 투영(buildNearbyArrivals).
 *
 * **3단계가 있는 이유**: 서울 실시간은 "운행 시간 밖"과 "실시간 미제공 역"에
 * 똑같이 INFO-200을 준다. 그 코드만 보고 "운행이 끝났습니다"라고 말하면 낮에
 * 미커버 역을 만난 사용자에게 거짓이 되고, 반대로 아무 말도 못 하면 심야
 * 사용자는 역이 사라진 화면을 본다. 시각 근사(01~05시)로 가르는 길도 있으나
 * 역·노선마다 다이어가 달라 이 repo 기준에 못 미친다 — 그 역의 실제 첫차·막차로
 * 가른다. 판정은 순수 함수라 심야를 기다리지 않고 테스트한다.
 *
 * 순수 로직(buildNearbyArrivals·judgeStationService)과 seed+fetch 합성
 * (fetchNearbySubwayArrivals)을 분리해, 불변식을 seed·네트워크 없이 검증한다.
 */

/** 근접 탐색 반경(m) — 도보 권역. 따릉이 1km cap과 동일 기준. */
const RADIUS_METERS = 1000;
/** 조회 역 수 상한 — 역마다 실시간 1콜이라 쿼터(1,000/일) 보호 + 미니멀 표시. */
const LIMIT = 3;

/** 실시간이 빈 역의 운행 여부 판정 결과 — 시간표에서 산출한다(순수 입력). */
export interface StationServiceWindow {
  /** 운행 시간 밖으로 확정됐는가. false면 운행 중이거나 판정 불가. */
  closed: boolean;
  /**
   * 가장 이른 첫차 "HH:MM"(closed일 때만 의미).
   * 막차는 싣지 않는다 — closed는 막차가 이미 지났다는 뜻이라 사용자가 물을 것은
   * "언제 다시 타나"뿐이다(미니멀: 쓰지 않을 필드를 계약에 두지 않는다).
   */
  firstTime?: string;
}

/**
 * 시간표로 그 역이 지금 운행 시간 밖인지 판정한다(순수).
 *
 * 규칙 — **"운행이 끝났다"는 단정이라 조건을 좁게 잡는다**:
 * - 시간표 없음(미커버·조회 실패) → 판정 불가(closed:false). 단정하지 않는다.
 * - `partial`(일부 노선·방향 시간표 결측) → 판정 불가. 빠진 노선이 운행 중일 수
 *   있으므로 "전부 운행 밖"이라고 말할 근거가 못 된다.
 * - 노선·방향 창이 **하나라도 running** → 판정 불가(closed:false). 그 노선은
 *   다니는데 실시간만 없는 경우다.
 * - 판정 가능한 창이 있고 **전부 outside** → closed. 환승역은 노선마다 첫차가
 *   다르므로 가장 이른 값을 쓴다(사용자에게 유리한 쪽).
 * - **노선 coverage allowlist(A19)**: `ok`·`noTrains`인 노선만 판정에 참여한다. 그 외
 *   값(unknown·unavailable·미지 값)이 하나라도 있으면 판정 불가. 업스트림이 (역·노선)별로
 *   0행을 주는 일이 상시라(홍대입구 2호선·강남 신분당·서울역 공항) 그 노선이 다니는데
 *   "운행 종료, 첫차 X"를 단정할 수 있다. denylist가 아닌 이유: fixture 누락·미래 값이
 *   `undefined`로 게이트를 통과해 단정 쪽으로 fail-open 된다. **대가**: 0행 노선이 있는
 *   역은 심야 "운행 종료" 안내가 나가지 않는다 — 거짓 확정보다 침묵이 덜 해롭다(교환이지
 *   회귀가 아니다. 화면으로 반증 못 하는 사용자는 거짓 "첫차 05:20"을 믿고 기다린다).
 *
 * ⚠ 막차가 자정을 넘기는 경우(00:03)의 비교는 `judgeServiceStatus`가 이미
 * 처리한다(last < first면 자정 넘김 구간). 여기서 다시 보정하지 않는다.
 */
export function judgeStationService(
  timetable: StationTimetable | null,
  nowMinutes: number,
): StationServiceWindow {
  if (!timetable || timetable.partial) return { closed: false };
  if (timetable.lines.some((l) => l.coverage !== "ok" && l.coverage !== "noTrains")) {
    return { closed: false }; // 확인되지 않은 노선이 있다 — 단정하지 않는다
  }
  const judged = timetable.lines.flatMap((line) =>
    line.directions.flatMap((d) => {
      const first = parseServiceTime(d.first.time.replace(":", ""));
      const last = parseServiceTime(d.last.time.replace(":", ""));
      if (first == null || last == null) return [];
      return [{ firstRaw: d.first.time, first, last }];
    }),
  );
  if (judged.length === 0) return { closed: false }; // 판정 가능한 창이 없다
  if (judged.some((w) => judgeServiceStatus(nowMinutes, w.first, w.last) === "running")) {
    return { closed: false };
  }
  const earliest = judged.reduce((a, b) => (a.first <= b.first ? a : b));
  return { closed: true, firstTime: earliest.firstRaw };
}

/** buildNearbyArrivals 입력 한 건 — seed 메타 + settled 실시간 결과. */
export interface NearbyArrivalInput {
  /** seed 역명(표시 전 cleanName 처리됨) */
  name: string;
  /** 영문 역명(seed 메타, 없을 수 있음) */
  nameEn?: string;
  /** 노선들(seed 메타 집계) */
  lines: string[];
  /** 노선 영문(`lang=en`에만, 전부 매핑될 때만 — 호출부가 채운다) */
  linesEn?: string[];
  /** 현재 위치로부터 거리(m) */
  distanceMeters: number;
  /** 역별 실시간 도착 조회의 settled 결과(null=실시간 데이터 없음) */
  result: PromiseSettledResult<SubwayStationArrivals | null>;
  /** 실시간이 null인 역의 운행 판정(미조회·판정 불가면 undefined) */
  service?: StationServiceWindow;
}

/**
 * settled 실시간 결과를 역별 표시 모델로 투영(순수).
 * - fulfilled & 값 있음 → "ok", arrivals 정본.
 * - fulfilled & null + service.closed → "closed"(+첫차·막차). 운행 시간 밖 확정.
 * - fulfilled & null + 그 외         → "unknown". 실시간 미제공 역이거나 판정 불가.
 * - rejected                         → "unavailable"(일시 장애, "열차 없음"과 구분).
 *
 * ⚠ **어떤 상태에서도 역을 빼지 않는다.** 종전에는 null을 "미커버 역"으로만 읽고
 * `continue`로 숨겼는데, 심야에는 근접역이 전부 null이라 목록이 비었고 화면이
 * 그것을 "주변에 지하철역이 없습니다"로 낭독했다(위원장 지적 2026-08-02).
 * 근접역은 정적 seed 산출이라 시각과 무관하게 참이므로, 그 참을 부재로 뒤집는
 * 것은 3-state 뭉갬 중에서도 가장 해로운 축이다 — 사용자는 역이 없다고 믿고
 * 다른 수단을 찾아 나선다.
 *
 * **전부 실패(시도한 역이 모두 rejected)면 throw** — 일시 장애를 빈 결과로
 * 위장하지 않는다(라우트가 502로 변환, seoul-subway-arrival 정본 원칙 동형).
 */
export function buildNearbyArrivals(
  inputs: NearbyArrivalInput[],
): NearbySubwayStation[] {
  const stations: NearbySubwayStation[] = [];
  let attempted = 0;
  let failed = 0;
  for (const it of inputs) {
    const base = {
      stationName: cleanName(it.name),
      nameEn: it.nameEn,
      lines: it.lines,
      ...(it.linesEn ? { linesEn: it.linesEn } : {}),
      distanceMeters: Math.round(it.distanceMeters),
    };
    if (it.result.status === "fulfilled") {
      if (it.result.value === null) {
        // 실시간 데이터 없음 — 역은 남기고 운행 여부로 가른다(숨김 금지).
        // attempted에 세지 않는 이유: 이 역은 조회에 성공했고 데이터가 없었을
        // 뿐이라 "전부 실패" 판정 모수가 아니다(종전 규칙 그대로).
        stations.push(
          it.service?.closed
            ? {
                ...base,
                arrivalStatus: "closed",
                arrivals: [],
                ...(it.service.firstTime ? { firstTime: it.service.firstTime } : {}),
              }
            : { ...base, arrivalStatus: "unknown", arrivals: [] },
        );
        continue;
      }
      attempted += 1;
      stations.push({ ...base, arrivalStatus: "ok", arrivals: it.result.value.arrivals });
    } else {
      attempted += 1;
      failed += 1;
      stations.push({ ...base, arrivalStatus: "unavailable", arrivals: [] });
    }
  }
  if (attempted > 0 && failed === attempted) {
    throw new Error("서울 지하철 실시간 도착 근접 조회 전부 실패");
  }
  return stations;
}

/**
 * 반경 밖이어도 **가장 가까운 역 1곳**(seed 조회, 네트워크 0). 결과 0건일 때만 쓴다.
 *
 * "주변에 지하철역이 없습니다"는 반경 1km 안의 사실이라 참이지만, 그것만으로는
 * 강동(1.5km)과 강릉(90km)이 같은 문장을 받는다. 앞은 걸어갈 수 있고 뒤는 도시철도가
 * 없는 지역인데 구분이 사라진다 — 시각장애 사용자는 지도로 그 차이를 볼 수 없다.
 *
 * ⚠ **거리 임계값으로 "도시철도 없는 지역"을 판정하지 않는다.** 최근접 역 거리가
 * 전국에 연속 분포하기 때문이다(2026-08-02 50개 시 실측: 울산 3.5 · 세종 10.0 ·
 * 나주 13.2 · 창원 17.3 · 원주 26.6km로 간격 없이 이어진다). 어떤 선을 그어도
 * 그 근처에서 자의적이 되므로, 판정하지 말고 **거리를 그대로 알려 사용자가
 * 판단하게 한다**(따릉이·문화행사는 "서울 전용"이라는 서비스 속성이라 판정이
 * 성립하지만, 이쪽은 위치의 연속량이라 성격이 다르다).
 */
export function findNearestStationInfo(
  lat: number,
  lng: number,
  lang: "ko" | "en" = "ko",
): NearestSubwayStation | null {
  const [nearest] = findStationsNear(lat, lng, { limit: 1, dedupeByName: true });
  if (!nearest) return null;
  // 이름 집계 금지(A9): 앵커는 매칭된 레코드 좌표 — 전국 동명이역 노선 혼입 차단.
  const meta = findStationMetaNear(nearest.name, nearest.lat, nearest.lng);
  const lines = meta?.lines ?? [nearest.lineName];
  const linesEn = lang === "en" ? subwayLineNamesEn(lines) : undefined;
  return {
    // `NearbySubwayStation.stationName`과 같은 계약(접미사 제거) — 목록과 nearest가
    // 다른 모양이면 소비자가 "역"을 붙일지 말지 판단할 수 없다(CLI에서 "남춘천역역").
    stationName: cleanName(nearest.name),
    nameEn: meta?.nameEn,
    lines,
    ...(linesEn ? { linesEn } : {}),
    distanceMeters: Math.round(nearest.distanceMeters),
  };
}

/**
 * 좌표 근접 서울 지하철역들의 실시간 도착을 합성한다.
 * - 키 없음/근접역 없음 → 빈 배열(graceful, canShowSubway 게이트와 이중 방어).
 * - 실시간이 빈 역 → 그 역만 시간표를 조인해 운행 시간 밖인지 판정(closed/unknown).
 * - 부분 실패 → 해당 역만 unavailable, 나머지 실데이터 보존.
 * - 전부 실패 → throw(라우트 502).
 *
 * 시간표 조회는 **실시간이 빈 역에만** 건다. 낮에는 대개 도착이 있으므로 추가
 * 호출이 0이고, 심야에도 근접역 상한이 3이라 최대 3역이다. TAGO 시간표는
 * `revalidate: 86400`이라 같은 역 재조회는 하루 1회로 수렴한다. 조회 실패는
 * throw하지 않는다 — 도착 정보 화면이 부가 판정 때문에 죽으면 안 된다(판정
 * 불가는 unknown이라는 정직한 상태가 이미 있다).
 */
export async function fetchNearbySubwayArrivals(
  lat: number,
  lng: number,
  /** `en`이면 노선 영문(`linesEn`)·도착 영문 필드를 additive로 싣는다(E27). 한국어 필드 불변. */
  lang: "ko" | "en" = "ko",
): Promise<NearbySubwayStation[]> {
  if (!hasSeoulSubwayRealtimeKey()) return [];
  const near = findStationsNear(lat, lng, {
    radiusMeters: RADIUS_METERS,
    limit: LIMIT,
    dedupeByName: true,
  });
  if (near.length === 0) return [];
  const settled = await Promise.allSettled(
    near.map(async (s) => {
      const r = await fetchSubwayArrivals(s.name);
      return lang === "en" ? withArrivalsEn(r) : r;
    }),
  );
  // 실시간이 빈 역만 시간표를 조인해 "운행 시간 밖"인지 가른다(나머지는 미조회).
  const nowMinutes = kstNowMinutes(new Date());
  const services = await Promise.all(
    settled.map(async (r, i) => {
      if (r.status !== "fulfilled" || r.value !== null) return undefined;
      try {
        return judgeStationService(await fetchStationTimetable(near[i].name), nowMinutes);
      } catch {
        return undefined; // 판정 실패는 unknown으로 흡수(도착 화면을 죽이지 않는다)
      }
    }),
  );
  const inputs: NearbyArrivalInput[] = near.map((s, i) => {
    // 이름 집계 금지(A9): 앵커는 매칭된 레코드 좌표 — 전국 동명이역 노선 혼입 차단.
    const meta = findStationMetaNear(s.name, s.lat, s.lng);
    const lines = meta?.lines ?? [s.lineName];
    const linesEn = lang === "en" ? subwayLineNamesEn(lines) : undefined;
    return {
      name: s.name,
      nameEn: meta?.nameEn,
      lines,
      ...(linesEn ? { linesEn } : {}),
      distanceMeters: s.distanceMeters,
      result: settled[i],
      service: services[i],
    };
  });
  return buildNearbyArrivals(inputs);
}
