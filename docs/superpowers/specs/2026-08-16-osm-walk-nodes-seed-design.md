# OSM 보행 노드 정적 seed화 (E12) 설계

- 날짜: 2026-08-16
- 출처: `docs/BACKLOG.md` E12(착수 확정 2026-08-16, 착수 순서 1순위), ODbL 판정 `docs/research/RESEARCH-2026-08-16-odbl-compliance.md`
- 상태: 설계 확정

## 1. 목적

`/api/walk/nearby`의 OSM 축(횡단보도·점자블록)을 Overpass 실시간 호출에서 정적 seed로 옮긴다. 성과는 **조회 실패의 소멸**이다 — 프로덕션 로그로 확정된 429·504가 원인 자체로 사라진다. 110m 격자 타일이라 걸어가면 정의상 신규 타일이 연속되므로 캐시가 가장 안 듣는 사용자가 보행자였고, 그 사용자가 이 앱의 1급 사용자다.

**이 마일스톤의 실체는 기능 추가가 아니라 계층 제거다.** 타일 캐시·쿨다운·예산·single-flight·클라이언트 타임아웃·실패 범위 판정은 전부 "외부 서버가 실패한다"는 사실 하나에 대응하려고 존재했다. 데이터가 손안에 있으면 그 계층이 통째로 근거를 잃는다.

## 2. 실측 (2026-08-16, 이 설계의 근거)

| 축 | 값 |
|---|---|
| 질의 | `area["ISO3166-1"="KR"][admin_level=2]` + `node[highway=crossing]` ∪ `node[tactile_paving=yes]` |
| 노드 수 | **79,574** (crossing 76,185 · tactile 6,002 · 호스트 판별 1,412) |
| ⚠ bbox 질의였다면 | 97,380 — **일본 노드 17,806개 유입**(대마도·규슈 북부). 국경을 정확히 자르는 것은 area뿐이다 |
| seed 크기 | **2.74MB**(osmId 포함, 좌표 5자리) / 1.82MB(osmId 제외) |
| `JSON.parse` | **8.6ms** (모듈 로드 1회) |
| 반경 조회 | **0.19ms** (위경도 박스 프리필터 + haversine, 전수 스캔) |
| 비교: 현행 Overpass | 성공 1.4~3.9초 · 실패 7.9~8.9초 |

`crossing` 태그 분포는 신호 있음 13,788 · 없음 19,571 · 미상 46,215였다. **미상이 과반이라는 사실이 seed 전환으로 달라지지 않는다** — 지금도 같은 데이터를 실시간으로 받아 같은 비율로 `unknown`을 낸다.

**osmId를 남긴다.** 900KB를 더 쓰지만 iOS `WalkFeature.osmId`가 필수 디코딩 필드이자 `ForEach` 식별자이고, ODbL 맥락에서 원본 대조의 유일한 키다. 파싱 8.6ms는 그 값을 치를 만하다.

## 3. seed 파일

### 3.1 위치와 분리 원칙

`src/lib/data/osm-walk-nodes.json` — **`audio-signals.json`과 절대 합치지 않는다.**

근거는 취향이 아니라 두 제약이 서로를 잠그기 때문이다(research §"설계를 구속하는 결론"): OSM seed와 국내 공공데이터를 한 파일로 합치면 병합본이 논쟁 여지 없는 Derivative Database가 되어 §4.6을 "OSM 원본 가리키기"로 못 채우고 병합본 자체를 제공해야 하는데, 그 순간 공공데이터 국외 반출 제한과 정면 충돌한다. **병합은 런타임에서만 한다**(현행 `getWalkInfrastructure`의 `allSettled` 구조가 이미 그렇다 — 바꿀 것이 없다).

### 3.2 스키마

```json
{
  "meta": {
    "source": "OpenStreetMap contributors",
    "license": "ODbL 1.0",
    "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
    "attribution": "https://www.openstreetmap.org/copyright",
    "query": "area[\"ISO3166-1\"=\"KR\"][admin_level=2] / node[highway=crossing] ∪ node[tactile_paving=yes]",
    "osmTimestamp": "2026-08-16T10:28:21Z",
    "fetchedAt": "2026-08-16T...",
    "counts": { "total": 79574, "crossing": 76185, "tactile": 6002 }
  },
  "nodes": [[id, lat, lng, flags], ...]
}
```

- `nodes`는 **`[lat, lng]` 사전순 정렬**(diff 안정성 — audio-signals 관례).
- 좌표 5자리(≈1m). audio-signals와 같은 정밀도.
- `flags`는 비트 필드: `bit0` crossing · `bit1~2` crossingSignal(0=no, 1=yes, 2=unknown) · `bit3` tactilePaving · `bit4~5` hostFeature(0=없음, 1=busStop, 2=subwayEntrance).
- `meta`에 라이선스 4필드를 두는 것이 ODbL 체크리스트 4번(*"in a location... such as a readme file, or within the data or metadata"*) 이행이다. **파일 자체가 자기 출처를 들고 다닌다** — `sourceAudio`의 `{baseDate}` 런타임 주입이 옳은 패턴이었던 것과 같은 이유다(voice-guides의 하드코딩 부채가 반례).

### 3.3 비트 필드를 쓰는 이유

값 넷을 필드 넷으로 두면 항목당 JSON 키가 붙어 파일이 두 배가 된다. 판독은 로더 한 곳에서만 하고, 그 해석표는 위 스키마와 빌드 스크립트에 **한 번씩만** 적힌다. ⚠ 비트 폭을 바꾸면 seed와 로더가 함께 움직여야 하므로, 로더는 알 수 없는 비트 조합을 만나면 조용히 무시하지 말고 **미상으로 강등**한다(`crossingSignal` 3은 `unknown`, `hostFeature` 3은 `undefined`).

## 4. 빌드 스크립트 `scripts/build-osm-walk-nodes.mjs`

기존 6종 스크립트의 공통 철학을 그대로 따른다: **조용한 축소가 아니라 빌드 실패**. 모든 가드는 `throw`다.

입력은 인자 없음(HTTP 직접 질의 — `build-voice-guides.py`·`build-congestion-areas.mjs` 선례). 실행은 연 1회 수동.

### 4.1 가드

| # | 가드 | 임계 | 근거 |
|---|---|---|---|
| G1 | 총 노드 수 | ≥ 60,000 | 실측 79,574의 75%. 부분 응답·질의 오타를 잡는다 |
| G2 | crossing 수 | ≥ 55,000 | 실측 76,185 |
| G3 | tactile 수 | ≥ 4,000 | 실측 6,002 |
| G4 | 전 노드가 한국 bbox 안 | `KOREA_WALK_SEED_BBOX`(§5.1) | area 질의가 무너져 국외가 섞이면 즉시 실패 |
| G5 | **국외 부재 golden** | 대마도(34.40, 129.35) 반경 20km에 **0건** | area 필터가 실제로 작동했는지 직접 판정한다. bbox 질의로 되돌아가면 이 가드가 깨진다 |
| G6 | **전국 존재 golden** | 17개 시도 대표 좌표 각각 반경 20km에 ≥ 1건 | area 질의가 일부 지역만 반환하는 조용한 결손을 잡는다 |
| G7 | 도심 밀도 golden | 강남역(37.4979, 127.0276) 300m 내 crossing ≥ 5 | 태그 매핑 회귀 감지 |
| G8 | `remark` 존재 | 있으면 throw | Overpass 부분 응답은 200으로 온다(현행 provider와 같은 판정) |

G5·G6은 `build-tago-cities.mjs`의 `GOLDEN_PRESENT`/`GOLDEN_ABSENT` 패턴이다 — **존재만 검사하면 "전부 담겼다"와 "전부 담겼는데 남의 것도 담겼다"를 구분하지 못한다.**

### 4.2 정규화 로직의 이사

태그 → 플래그 변환(`normalizeOverpassElements`, 현행 `overpass.ts:95-127`)은 **런타임에서 빌드 타임으로 옮긴다.** 런타임에 Overpass 응답이 더는 오지 않으므로 그 함수는 소비자가 사라진다. 복제가 아니라 이동이므로 드리프트가 생기지 않는다.

기존 `overpass.test.ts`의 정규화 케이스(태그 매핑 3종·중복 병합·hostFeature 판별)는 **빌드 스크립트 테스트로 이관**한다. 검증하는 내용이 같고 검증 대상 위치만 바뀐다.

## 5. 런타임: provider 교체

### 5.1 신규 `src/lib/providers/osm-walk-nodes.ts`

`audio-signals.ts`와 같은 골격이다(정적 import · bbox 판정 · 박스 프리필터 + haversine).

```ts
export const KOREA_WALK_SEED_BBOX = { latMin: 33.0, latMax: 38.7, lngMin: 124.5, lngMax: 131.9 } as const;

/** seed 범위 밖이면 null(=unsupported), 안이면 0건도 배열. */
export function findWalkFeaturesNear(lat: number, lng: number, radiusMeters: number): RawWalkFeature[] | null;
```

⚠ **bbox는 `KOREA_COVERAGE_BBOX`(31.43~44.35 / 122.37~132.0)와 다르고, 다른 것이 정상이다.** 커버리지 마커는 "이 앱이 서비스한다고 선언한 범위"이고 이 상수는 "이 seed가 실제로 담은 범위"다. 후자가 좁으므로 **판정은 seed 자신의 bbox로 한다** — 넓은 쪽으로 판정하면 북한 좌표에서 "0건"이라는 거짓말이 나온다. audio-signals가 `SEOUL_BBOX`로 판정하는 것과 정확히 같은 층이다.

`RawWalkFeature` 타입은 `overpass.ts`에서 이 파일로 옮긴다(현행 정의 그대로, 필드 변화 0).

### 5.2 삭제 목록

| 대상 | 사유 |
|---|---|
| `src/lib/providers/overpass.ts` 전체(169줄) | 호출자 0 |
| `src/lib/providers/__tests__/overpass.test.ts` | 정규화 케이스는 빌드 스크립트 테스트로 이관, fetch 케이스는 소멸 |
| `walk-infra.ts`: `TileCacheWrapper`·`configureWalkInfraTileCache`·`tileCache` | 캐시할 upstream이 없다 |
| `walk-infra.ts`: `inFlightTiles`·`fetchTileDeduped`·`cachedFetchTile`·`tileAnchor` | single-flight·타일 격자의 근거 소멸 |
| `walk-infra.ts`: 예산(`consumeOverpassBudget`·`OVERPASS_BUDGET_*`) | 상류 호출 0 |
| `walk-infra.ts`: 쿨다운(`recordTileFailure`·`cooldownReason`·`tileCooldownUntil`·`upstreamCooldownUntil`) | 실패할 상류 없음 |
| `walk-infra.ts`: `TILE_RADIUS_METERS` | anchor 오프셋 버퍼가 필요 없다(실좌표로 직접 조회) |
| 라우트 2곳의 캐시 주입(`/api/walk/nearby:9-11`, `/api/chat:13-16`) | 주입 대상 소멸 |
| `OVERPASS_URL` env 참조 | — |

`__resetWalkInfraForTest`는 리셋할 모듈 상태가 사라지므로 함께 제거한다.

⚠ **`USER_RADIUS_METERS`(300)·`GROUP_CAP`(10)·`projectOsmData`는 남긴다.** 거리·방위·필터·cap·정렬은 데이터원과 무관한 표현 계층이다.

### 5.3 축소된 서비스 계층

```ts
async function loadOsm(lat: number, lng: number): Promise<SourceStatus<OsmWalkData>> {
  const raw = findWalkFeaturesNear(lat, lng, USER_RADIUS_METERS);
  if (raw === null) return { status: "unsupported", reason: "outsideKorea" };
  return { status: "ok", data: projectOsmData(raw, lat, lng) };
}
```

`getWalkInfrastructure`의 `allSettled` 구조·부분 실패 보존·`console.error`는 **그대로 둔다.** seed 조회는 사실상 실패하지 않지만, 두 소스를 독립적으로 강등하는 구조 자체가 계약이고 여기서 예외를 만들면 나중에 소스가 늘 때 되살려야 한다.

라우트의 "両소스 error → 503" 분기도 유지한다(도달 불가에 가까워지지만 계약은 계약이다).

## 6. 한국 밖: `unsupported`가 정답이고 "0건"은 거짓말이다

이 전환은 **관측 가능한 동작 변화를 하나 만든다.** 지금은 OSM 축이 전 지구 커버라 도쿄에서도 횡단보도가 나오지만, seed 후에는 국내 자료만 있다. 이때 0건으로 응답하면 시각장애 사용자는 "이 근처에 횡단보도가 없다"로 읽는다 — 3-state 불변식이 금지하는 정확한 실패다.

**`SourceStatus`의 `reason`을 `"outsideSeoul" | "outsideKorea"`로 확장**하고, 음향신호기의 `outsideSeoul`과 동형으로 다룬다. iOS `WalkSourceStatus`는 `reason`을 디코딩하지 않으므로(`status` 문자열만 본다) **Kit 변경 0**이다.

소비자별 이행:

| 소비자 | 현행 | 변경 |
|---|---|---|
| 웹 `WalkInfraNearby.tsx:146-210` | unsupported·error를 `crossingError`/`tactileError`로 **합침** | 분리: `crossingUnsupported`·`tactileUnsupported` 신설 |
| iOS `WalkInfraNearbyView.swift` | 동형으로 합쳐져 있음 | 같은 두 키로 분리 |
| CLI `formatters.ts:588-645` | OSM은 `unsupported`/`error` 구분 없이 else 한 갈래 | 분리(음향신호기 쪽 분기와 동형) |
| 채팅 `router.ts:207-223` | 성공 소스만 인용 | **변경 없음** — unsupported는 이미 인용에서 빠진다 |

문구(ko): `crossingUnsupported` = "횡단보도 정보는 국내만 제공됩니다.", `tactileUnsupported` = "점자블록 정보는 국내만 제공됩니다."

⚠ **두 그룹에 같은 문장을 쓰지 않는 이유**: 그룹 헤더가 각각 있고 문구가 그룹 이름을 포함하므로 연속 낭독에서도 중복이 아니다. 반대로 "국내만 제공됩니다"라는 한 문장을 두 자리에 두면 같은 말이 두 번 들린다.

⚠ **꼬리 문장을 붙이지 않는다** — "다른 지역에서 이용해 주세요" 같은 문장은 새 정보가 없다.

## 7. ODbL 이행

판정 정본은 research 문서이고, 우리 아키텍처가 그 조건절 하나를 **소멸시킨다**:

- **iOS 번들에 seed가 들어가지 않는다.** iOS는 `WalkInfraService`가 `/api/walk/nearby`를 치는 API 소비자다(iOS 번들 seed는 현재 0종, `release-notes.json`은 seed가 아니다). 따라서 §4.2.b(라이선스 URI 동봉)는 **적용되지 않는다.** research가 조건부로 경고한 의무가 실제 구조에서 성립하지 않는 경우다.
- 웹·CLI·MCP도 seed가 서버에 남고 API 응답만 나가므로 conveying이 아니다.
- 남는 의무는 **attribution**과 **§4.6 요청 시 제공**이다.

### 7.1 attribution 배치

**이미 화면에 있다** — `walkInfra.sourceOsm`("© OpenStreetMap 기여자")이 웹·iOS 패널 각주로 노출 중이다. 여기에 위원장 판정(BACKLOG ⓑ)을 이행해 **iOS 설정에 "정보 출처" 화면을 신설**한다.

⚠ research §32("설정 화면에만 묻어 두는 것은 safe harbour 밖")와 위원장 판정("설정 항목에만 둔다")이 문면상 충돌하는데, **실제 구현은 둘 다 만족한다**: 각주는 그대로 두고 설정 화면을 더하므로 배치는 "각주 + 설정"이다. 각주를 지울 이유가 없다 — 지우면 attribution이 약해지고, 위원장 판정의 취지는 "시작 시 강제 낭독을 하지 않는다"였지 "기존 표기를 없앤다"가 아니었다.

### 7.2 iOS "정보 출처" 화면 (`DataSourcesView.swift`)

설정 List의 "업데이트 이력" 위에 `NavigationLink`. 내용은 **앱 전체 데이터 출처 목록**이다 — OSM만 담으면 화면 이름이 거짓이 되고, iOS 사용자는 지금 19곳 각주 중 2곳만 볼 수 있어(웹은 19곳 전부) 이 화면이 그 비대칭도 함께 해소한다.

- 재료는 기존 `source.*` 사전 17종(`messages/ko.json:514-531`, 채팅 출처 라벨).
- OSM 항목만 라이선스 줄을 덧붙인다: "OpenStreetMap 기여자, ODbL 1.0" + `openstreetmap.org/copyright` 링크.
- §4.6 이행 한 줄: "지도 자료 사본은 문의하면 제공합니다"(문의 경로는 설정에 이미 있는 "문제 신고" mailto).
- 접근성: 각 출처는 **한 줄 = 한 텍스트**(라벨+설명을 `joinText` 정신으로 합침). 링크만 별도 객체(인터랙티브는 합치지 않는다).

**웹에는 이 화면을 만들지 않는다.** 웹은 각 화면 각주 19곳이 이미 그 일을 하고 있어 추가 화면은 잉여다. 비대칭이 아니라 결손 보정이다.

## 8. 테스트

| 파일 | 못 박는 것 |
|---|---|
| `src/lib/__tests__/build-osm-walk-nodes.test.ts` (신규) | 태그→플래그 매핑 3종·중복 노드 병합·hostFeature 판별(overpass.test.ts에서 이관) + 가드 G1~G8이 각각 throw하는지(합성 입력) |
| `src/lib/providers/__tests__/osm-walk-nodes.test.ts` (신규) | 실 seed: 강남역 300m 내 crossing 존재 · 도쿄 좌표 **null**(0건 아님) · 대마도 null · 반경 0이면 빈 배열 · 플래그 판독 왕복 |
| `src/lib/__tests__/walk-infra.test.ts` (개정) | 쿨다운·예산·single-flight 케이스 **삭제**, `outsideKorea` unsupported 추가, cap/count·부분 실패 보존은 유지 |
| `src/app/api/walk/nearby/__tests__/route.test.ts` (개정) | 캐시 주입 관련 삭제, 한국 밖 200 + osm unsupported |
| `src/components/__tests__/WalkInfraNearby.contract.test.tsx` (개정) | unsupported 문구가 error 문구와 **다른지**(뭉개기 회귀 가드) |
| `packages/cli/src/__tests__/formatters.test.ts` (개정) | 동일 |
| `src/lib/chat/__tests__/walk-infrastructure.test.ts` | 변경 없음(unsupported는 이미 인용 제외) |

**변이 주입으로 검출력을 실측한다**: `loadOsm`의 `null` 분기를 `{status:"ok", data: 빈 배열}`로 바꿔 3-state 가드가 실제로 실패하는지 확인한다. 계약 테스트가 있다는 것과 그 축이 지켜진다는 것은 다르다([[mutation-proves-test-detection-power]]).

## 9. 성능·운영

- 콜드 스타트에 8.6ms 파싱이 더해진다. Vercel 콜드 스타트가 람다 묶음 단위이고 우리 코드 몫이 4% 미만이었던 실측을 감안하면 무시할 수준이며, **대신 요청당 1.4~3.9초(성공 시)가 0.19ms가 된다.**
- `src/lib/data/`의 다른 seed와 같이 **서버 전용 import**다. 클라이언트 번들에 넣지 말 것(2.74MB).
- 레이트리밋(60초 10회)은 **유지한다.** 상류 보호 목적은 사라졌지만 서버 CPU 보호 목적은 남는다.
- 갱신 주기 연 1회(위원장 판정). 갱신 절차는 스크립트 상단 주석에 기록.

## 10. 범위 밖

- 음향신호기 seed·`walk-route.ts`의 음향신호기 병합: 건드리지 않는다(다른 소스, 다른 계층).
- M4의 iOS "주변 보행 인프라" 화면 제거: 별개 항목이고 이 마일스톤과 충돌하지 않는다(데이터원 교체는 화면 존재 여부와 독립).
- 점자블록 커버리지 확대: E8에서 별도 판정된 축.

## 11. 설계 리뷰 판정

codex 설계 단계 적대적 리뷰 **생략**한다.

- 새 불변식·판정 계층 신설이 아니다 — `unsupported` 확장은 음향신호기 `outsideSeoul`과 동형인 기존 계약의 재사용이다.
- 새 외부 통합의 계약 가정 첫 정의가 아니다 — **외부 통합을 없애는** 작업이다.
- 비가역·고파급이 아니다(저장 포맷은 신규 파일, 되돌리려면 provider 한 줄).
- 안전·정확성 크리티컬 축에 닿지만(보행 안내), 정확성 리스크는 설계가 아니라 **데이터**에 있고 그 방어는 빌드 가드 G1~G8과 3-state 테스트가 맡는다. 설계에서만 잡을 수 있는 결함이 보이지 않는다.
- ODbL은 이미 1차 출처 조사(research)와 위원장 판정으로 닫혔다.
