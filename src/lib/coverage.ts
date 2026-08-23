import boundary from "./data/korea-boundary.json";

/**
 * 대한민국 서비스 커버리지 정본 술어. iOS Kit Coverage.swift 미러(값·알고리즘 동조).
 *
 * **판정은 국경 폴리곤이고 사각형은 프리필터다**(E19, 2026-08-23). 사각형만으로는
 * 후쿠오카·기타큐슈·대마도·시모노세키가 "한국 안"으로 통과하고, 개성·해주는 파주와
 * 위경도가 겹쳐 어떤 사각형 뺄셈으로도 갈리지 않는다. 링은 E12가 walk seed용으로
 * 받아 둔 OSM `admin_level=2` 경계이며, 그것은 해안선이 아니라 **영해 경계선**이라
 * 좌표점이 2,580개뿐이다(연안·항만이 넉넉히 안쪽이고 판정 비용이 사실상 0).
 *
 * ⚠ 이 술어의 뜻은 **"한국 안인가"**이지 "이 upstream이 답하는 범위인가"가 아니다.
 * upstream 범위는 `unavailableHere`(국내 지역별 미제공)와 0건 축이 따로 든다.
 *
 * ⚠ **클라이언트에서도 같은 술어를 쓴다.** 대가는 번들 +53,814 bytes(gzip 약 15KB,
 * 2026-08-23 실측 chunks 합계 1.3MB의 4%)이고, 느슨한 클라 전용 술어를 이름 있는
 * API로 남기지 않기 위해 수용한 값이다 — 서버 왕복이 없는 소비자(deeplink.ts)에서는
 * 그 술어가 최종 판정이므로, 클라만 사각형으로 두었다면 후쿠오카 좌표에 네이버 지도
 * 링크가 나갔을 것이다.
 */
const KOREA_RINGS = (boundary as unknown as { rings: Array<Array<[number, number]>> }).rings;

/**
 * 네이버 지도 URL scheme의 좌표 유효 범위(구 `deeplink.ts` 승격). **판정에도 프리필터에도
 * 쓰지 않는다** — `scripts/build-crosswalk-seed.mjs`가 seed 생성 필터로 같은 값을 자체
 * 복제하고 있어 그 근거로 남는다.
 *
 * ⚠ **이 값을 프리필터로 되돌리지 말 것**(2026-08-23 리뷰 검출): 독도 영해 링이 동경
 * 132.12까지 뻗어 이 사각형(≤132.0)이 링을 다 감싸지 못한다. 사각형이 폴리곤의
 * 상위집합이 아니면 프리필터가 **거짓 "밖"**을 내고, 그 구간(독도 동쪽 해상)은 조용히
 * 잘려 나간다.
 */
export const KOREA_COVERAGE_BBOX = {
  latMin: 31.43,
  latMax: 44.35,
  lngMin: 122.37,
  lngMax: 132.0,
} as const;

/**
 * 프리필터 사각형은 **링에서 유도한다** — 상수로 두면 "사각형이 폴리곤을 감싼다"는
 * 전제가 링 갱신 때마다 조용히 깨질 수 있다. 유도하면 그 전제가 구조적으로 참이다.
 * 비용은 모듈 로드 시 2,580점 1회 순회.
 */
const PREFILTER = KOREA_RINGS.reduce(
  (box, ring) => {
    for (const [lat, lng] of ring) {
      if (lat < box.latMin) box.latMin = lat;
      if (lat > box.latMax) box.latMax = lat;
      if (lng < box.lngMin) box.lngMin = lng;
      if (lng > box.lngMax) box.lngMax = lng;
    }
    return box;
  },
  { latMin: Infinity, latMax: -Infinity, lngMin: Infinity, lngMax: -Infinity },
);

export function isInKorea(lat: number, lng: number): boolean {
  if (lat < PREFILTER.latMin || lat > PREFILTER.latMax) return false;
  if (lng < PREFILTER.lngMin || lng > PREFILTER.lngMax) return false;

  for (const ring of KOREA_RINGS) {
    let inside = false;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [y1, x1] = ring[i];
      const [y2, x2] = ring[i + 1];
      if (y1 > lat !== y2 > lat) {
        const xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1);
        if (lng < xAt) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/**
 * 서울시를 감싸는 bbox — **서울 전용 데이터 소스의 서비스 지역 판정 정본**.
 * 소비자: 따릉이(대여소)·문화행사·음향신호기 seed.
 *
 * ⚠ `scripts/build-audio-signals.mjs`가 seed 생성 필터로 같은 값을 하드코딩한다.
 * 값을 바꾸면 그 스크립트도 함께 갱신하고 seed를 재생성할 것.
 */
export const SEOUL_BBOX = {
  latMin: 37.4,
  latMax: 37.72,
  lngMin: 126.73,
  lngMax: 127.2,
} as const;

/**
 * 서울 bbox 밖으로 벗어난 거리(m). bbox 안이면 0.
 *
 * 서울 전용 서비스의 "이 좌표에서는 결과가 나올 수 없다" 판정에 쓴다. 판정선을
 * 임의로 고르지 말고 **그 도메인의 조회 반경을 그대로** 넘길 것: 반경 1km로 찾는
 * 따릉이는 bbox+1km 밖에 대여소가 존재할 수 없으므로, 판정선이 조회 반경과 같으면
 * 정의상 오판이 없다(임의 임계값에 근거를 붙일 필요 자체가 사라진다).
 *
 * ⚠ 이 판정을 **연속량인 도메인에 쓰지 말 것**. 지하철은 "역이 얼마나 먼가"가
 * 전국에 연속 분포해(2026-08-02 실측: 울산 3.5km·세종 10.0km·창원 17.3km·원주
 * 26.6km로 간격 없이 이어짐, 6~26km 구간에 국토 격자 15.7%) 어떤 임계값도
 * 자의적이다. 그런 도메인은 판정 대신 최근접 대상을 그대로 알린다.
 */
export function metersOutsideSeoul(lat: number, lng: number): number {
  const dLat =
    lat < SEOUL_BBOX.latMin
      ? SEOUL_BBOX.latMin - lat
      : lat > SEOUL_BBOX.latMax
        ? lat - SEOUL_BBOX.latMax
        : 0;
  const dLng =
    lng < SEOUL_BBOX.lngMin
      ? SEOUL_BBOX.lngMin - lng
      : lng > SEOUL_BBOX.lngMax
        ? lng - SEOUL_BBOX.lngMax
        : 0;
  if (dLat === 0 && dLng === 0) return 0;
  const latMeters = dLat * 111_000;
  const lngMeters = dLng * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.sqrt(latMeters ** 2 + lngMeters ** 2);
}
