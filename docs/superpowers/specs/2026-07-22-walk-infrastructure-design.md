# 내 주변 보행 인프라 (둘러보기 기능 B) — 설계안

**날짜**: 2026-07-22 · **상태**: 초안(codex 적대적 리뷰 대기) · **선행 정본**: `2026-06-20-surroundings-awareness-design.md` §4·§7의 "기능 B" 트랙(범위 확정 2026-06-20, 기능 A 선행 완료) · **게이트**: 없음(음향신호기=무인증 파일, OSM=무키 공개 인스턴스)

## 0. 배경·범위

기능 A(카카오 둘러보기 10종+8방위)는 운영 중. 이 spec은 후속으로 확정된 **기능 B: 주변 보행 인프라 안내**를 다룬다 — 시각장애 사용자가 횡단 전 "지금 주변에 음향신호기·횡단보도·점자블록이 어디 있는지"를 확인하는 보조 레이어. best-effort·지역편차 명시가 전제(선행 spec §2)이며, **"정보 없음"을 "시설 없음/안전"으로 오해석시키지 않는 것**이 제1 요구다.

데이터 소스 2종(2026-07-22 실호출·실데이터로 확정):

| 소스 | 실체 | 커버리지 | 함정 |
|---|---|---|---|
| 서울시 음향신호기 | **OA-15543** Shapefile(2026-05-28 기준, 21,451기 중 **좌표 유효 16,847기**), EPSG:5186 | 서울 전역(공식) | ⚠ data.go.kr 15047259(2019 1회성 CSV)는 낡은 스냅샷 — **정본은 서울 열린데이터 OA-15543**. 좌표계는 KGD2002 중부원점(GRS80, False N 600,000) — 에어코리아 EPSG:2097(Bessel)과 다름, .prj 실측 확정 |
| OSM Overpass | `highway=crossing`·`tactile_paving=yes` 노드 | 지역편차 극심(길동 15·5건 vs 강남 69·8건, 2026-06·07-22 両실측 동일) | 공개 인스턴스 — User-Agent 누락 시 406. 길동 tactile 노드의 실체는 **버스정류장 승강장**(횡단보도 점자블록 아님) → 호스트 시설 라벨 필수 |

## 1. 아키텍처 (기존 패턴 준수)

```
[빌드타임] scripts/build-audio-signals.mjs (Node+proj4, 수동 연 1~2회)
   OA-15543 ZIP → DBF 순수 파싱 → EPSG:5186→WGS84 → src/lib/data/audio-signals.json (seed)

[런타임]
SurroundingsNearby류 신규 패널 ──fetch──▶ /api/walk/nearby?lat&lng
                                            ├─ providers/audio-signals.ts (seed, 서버 전용 import)
                                            └─ providers/overpass.ts (Overpass POST, allSettled)
채팅 get_walk_infrastructure ──────────────▶ 위 provider 직접 호출 (ToolResult)
```

- **seed 패턴은 subway-stations·voice-guides 관례 미러**: 원본은 repo에 안 담고 빌드 스크립트+생성 JSON만 커밋, 스크립트 헤더에 재생성 절차 주석.
- **provider 격리**(선행 spec 불변식): `overpass.ts`가 OSM 태그를 자체 shape로 정규화 — 라우트·컴포넌트·채팅은 OSM 필드를 모른다.
- React/Next 비의존 `src/lib/` 유지(dodo 이식성).

## 2. 데이터 계약

### 2-A. 빌드 스크립트 `scripts/build-audio-signals.mjs`

- 입력: OA-15543 ZIP(다운로드 절차 주석: `datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do` POST `infId=OA-15543&infSeq=3&seq=11`). DBF는 의존성 없이 struct 파싱(cp949), 좌표는 XCE/YCE 필드.
- 변환: proj4(기존 runtime 의존성 재사용)에 **EPSG:5186 정의 문자열을 스크립트에 명시** `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs`. ⚠ 5181(y_0=500000)·2097(Bessel)과 혼동 금지 — .prj 파라미터(False N 600,000·GRS80)와 대조 검증을 스크립트가 assert.
- 필터: XCE/YCE 숫자 파싱 실패(마스킹 `**********`) 행 제외 — 21,451→16,847. 서울 bbox(lat 37.4~37.72, lng 126.73~127.2) 밖으로 변환된 행은 **변환 오류로 간주해 abort**(전량 서울이어야 정상 — 좌표계 회귀 가드).
- 출력 `src/lib/data/audio-signals.json`: `{ baseDate: "2026-05-28", signals: [[lat,lng], ...] }` — 소수 5자리(≈1m). 관리번호·제조회사·방향각(DRN_CDE)은 **버린다**(V1 산문에 불필요 — YAGNI. DRN_CDE는 의미 문서 미확보로 보류 기록).

### 2-B. Provider `src/lib/providers/audio-signals.ts` (서버 전용)

```ts
interface NearbyAudioSignals {
  count: number;            // 반경 내 총수
  nearest: { distanceMeters: number; bearing: Bearing }[]; // 가까운 순 최대 5
  baseDate: string;         // "2026-05-28"
}
findAudioSignalsNear(lat, lng, radiusMeters = 300): NearbyAudioSignals | null
```

- Haversine+`bearing.ts` 재사용. **서울 bbox 밖 좌표는 `null`**(= "서울 외 지역 미제공" 3-state, 0건과 구분).
- 정적 seed 조회라 실패 상태 없음(모듈 로드 실패는 빌드 오류).

### 2-C. Provider `src/lib/providers/overpass.ts`

```ts
type WalkFeatureKind = "crossing" | "tactilePaving";
interface WalkFeature {
  kind: WalkFeatureKind;
  distanceMeters: number;
  bearing: Bearing;
  crossingDetail?: "signals" | "marked" | "unmarked" | "zebra"; // crossing=* 태그, 있을 때만
  hostFeature?: "busStop" | "crossing" | "subwayEntrance";     // tactile 노드의 호스트 시설, 판별 가능할 때만
}
fetchWalkFeatures(lat, lng, radiusMeters = 300): Promise<WalkFeature[]>  // 실패는 throw
```

- Overpass POST(`overpass-api.de`), **User-Agent 명시**(`gildongmu/1.0 (+https://gildongmu.vercel.app)`), `[timeout:10]`, AbortSignal 12초.
- 쿼리: `node(around:R,lat,lng)[highway=crossing]; node(around:R,lat,lng)[tactile_paving=yes];` union, `out tags center`.
- 정규화: crossing 노드→`crossing`(+`crossing=*` 태그를 crossingDetail로), tactile 노드→`tactilePaving`+호스트 판별(`highway=bus_stop`→busStop, `highway=crossing` 동시 태그→crossing, `railway=subway_entrance`→subwayEntrance). tactile이면서 crossing인 노드는 **crossing 항목 1개로 합치고 tactile 여부를 detail로**(이중 계상 금지).
- 거리순 정렬 후 kind별 cap(각 10) — "내 주변 거리순 정렬은 코드 책임" 원칙.
- upstream 비200·타임아웃·파싱 실패는 throw(라우트에서 osmFailed로 강등 — 아래 2-D).

### 2-D. Route `/api/walk/nearby` (GET, lat/lng zod)

```ts
{ walk: {
    audioSignals: NearbyAudioSignals | null,  // null = 서울 외(미제공)
    features: WalkFeature[] | null,           // null = OSM 조회 실패
} }
```

- 두 소스 `Promise.allSettled` — **부분 실패 보존**(LocalConditions 관례): 음향신호기는 정적이라 사실상 항상 fulfilled, OSM rejected면 `features: null`.
- 캐시: `unstable_cache` 키=좌표 3자리 반올림(≈110m 그리드)+반경, revalidate 3600. 실패는 throw로 캐시 회피(웹검색 관례). IP 레이트리밋 60초 10회(공용 모듈 재사용) — 공개 Overpass 인스턴스 예의+비용 방어.
- 400(zod)/429/500(양쪽 전멸 시에만) 구분. 부분 실패는 200.

### 2-E. 3-state 매트릭스 (산문 정본)

| 상태 | audioSignals | features | 산문 |
|---|---|---|---|
| 서울 내·데이터 있음 | `{count>0}` | `[...]` | 아래 §3 낭독 |
| 서울 내·반경 내 0기 | `{count:0}` | — | "반경 300m 안에 등록된 음향신호기가 없습니다" |
| 서울 외 | `null` | — | "음향신호기 정보는 서울만 제공됩니다" |
| OSM 0건 | — | `[]` | "주변에 등록된 횡단보도·점자블록 정보가 없습니다" |
| OSM 실패 | — | `null` | "횡단보도·점자블록 정보를 불러오지 못했습니다" |
| 공통 각주 | | | **"등록된 정보가 없다는 것이 시설이 없다는 뜻은 아닙니다"**(거짓 안심 금지) + 출처·기준일 |

## 3. UI — 신규 "내 주변" 패널 "보행 인프라"

- **별도 패널**(7번째 nearby)로 추가 — 둘러보기(POI 훑기)와 소비 맥락(횡단 의사결정)이 달라 분리, `nearby-panel-store` claim/close·Esc·포커스 비대칭 계약 그대로 재사용. 트리거 버튼이 발견 경로이므로 패널은 `<div>`(region 금지 — 헌장 §3).
- 구조: 그룹 헤더 `<h4>` 3개(음향신호기 / 횡단보도 / 점자블록) + 항목은 **이름 없는 인프라 점이라 heading 미부여**(도착편 목록 관례 동형 — 과잉 방지). 항목 한 줄 = 한 객체(joinText):
  - 음향신호기: `"북동 45m"` (가까운 5개) + 요약 줄 `"반경 300m 안 12기, 2026-05-28 서울시 기준"`.
  - 횡단보도: `"남 30m, 신호등 있음"`(crossingDetail=signals일 때만 부가) · 점자블록: `"동 60m, 버스정류장"`(호스트 시설 병기).
- 통지: 단일 polite("보행 인프라: 음향신호기 12기, 횡단보도 8곳" 합산 1회), 로드 후 포커스 이동은 기존 nearby 패널 관례 미러.
- 출처 표기(ODbL 의무): "© OpenStreetMap 기여자 · 음향신호기: 서울특별시 제공". 이모지·em dash 금지.
- i18n 5로케일(en/es/fr/it 포함 — 산문이 거리·방위 합성이라 전체 번역 가능, `prefersEnglish` 규칙 준수).

## 4. 채팅 도구 `get_walk_infrastructure` (17번째)

- 좌표 도구(anchorOf 규칙 적용 — placeContext 있으면 장소 좌표). provider 직접 호출, `ToolResult{data, source: 서울시+OSM}`. 게이트 불필요(무키)라 항상 등록. systemInstruction의 날조 금지 원칙 그대로(도구가 준 필드만).
- render 카드는 **생략**(장소 앵커 시 산문이 정본 — 기존 원칙). CLI/MCP 카탈로그 반영은 **다음 CLI 릴리스에 편승**(V1 범위 외 — 카탈로그 미러 관례 기록만).

## 5. 구현 순서 (plan 분해 가이드)

1. 빌드 스크립트+seed 생성(변환 assert 포함) — 커밋에 seed 포함.
2. providers(audio-signals·overpass)+단위 테스트(fixture: 실호출 캡처 응답).
3. 라우트+3-state 테스트.
4. UI 패널+i18n+a11y(a11y-auditor 점검).
5. 채팅 도구+게이트 테스트.
6. **실호출 머지 게이트**: 길동(음향신호기 실개수·crossing 15 근방)·강남(밀집)·부산(서울 외 null 문장)·Overpass 실패 시나리오(잘못된 인스턴스로 강제) 4종. PROGRESS 기록.

## 6. 리스크·미결

- Overpass 공개 인스턴스 가용성: 장애 시 features null 문장으로 강등(서비스 자체는 유지). 대안 인스턴스 폴백은 V1 제외(YAGNI).
- 음향신호기 데이터 신선도: 서울시 수시 갱신 — seed 재생성 절차를 스크립트 주석+PROGRESS에 기록(연 1~2회 수동).
- DRN_CDE(방향각)·STAT_CDE(상태) 의미는 테이블 정의서 PDF 미확보로 보류 — V1은 위치·개수만. 후속에서 정의서 확보 시 "신호기가 향한 방향" 안내 검토.
- 전국 확장(경찰청 계열 데이터)은 서울 V1 검증 후 별도 spec.
