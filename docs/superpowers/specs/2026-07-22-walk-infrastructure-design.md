# 내 주변 보행 인프라 (둘러보기 기능 B) — 설계안

**날짜**: 2026-07-22 · **상태**: v2(codex 적대적 리뷰 22건 반영, §7 처리 기록) · **선행 정본**: `2026-06-20-surroundings-awareness-design.md` §4·§7의 "기능 B" 트랙 · **게이트**: 없음(음향신호기=무인증 파일, OSM=무키 공개 인스턴스)

## 0. 배경·범위

기능 A(카카오 둘러보기 10종+8방위)는 운영 중. 이 spec은 후속으로 확정된 **기능 B: 주변 보행 인프라 안내**를 다룬다 — 시각장애 사용자가 횡단 전 "지금 주변에 음향신호기·횡단보도·점자블록이 어디 있는지"를 확인하는 보조 레이어. best-effort·지역편차 명시가 전제(선행 spec §2)이며, 제1 요구 두 방향: **"정보 없음"을 "시설 없음/안전"으로 오해석시키지 않는다**(거짓 안심 금지) + **"등록됨"을 "현재 작동함"으로 오해석시키지 않는다**(등록≠작동).

데이터 소스 2종(2026-07-22 실호출·실데이터로 확정):

| 소스 | 실체 | 커버리지 | 함정 |
|---|---|---|---|
| 서울시 음향신호기 | **OA-15543** Shapefile(ZIP 폴더명 기준일 2026-05-28, 21,451행 중 좌표 유효 16,847행), EPSG:5186 | 서울 전역(공식) | ⚠ data.go.kr 15047259(2019 1회성 CSV)는 낡은 스냅샷 — **정본은 서울 열린데이터 OA-15543**. 좌표계는 KGD2002 중부원점(GRS80, False N 600,000) — 에어코리아 EPSG:2097(Bessel)·카카오 5181(False N 500,000)과 다름, .prj 실측 확정 |
| OSM Overpass | `highway=crossing`·`tactile_paving=yes` **노드**(V1 커버리지 프로파일 — way/area 점자블록은 미포함, §6 한계) | 지역편차 극심(길동 15·5건 vs 강남 69·8건, 両실측) | 공개 인스턴스 — User-Agent 누락 시 406. **HTTP 200이어도 `remark` 필드가 있으면 부분 응답**(타임아웃·리소스 한도) — 성공으로 처리 금지. 길동 tactile 노드 실체는 버스정류장 승강장 → 호스트 시설 라벨 필수 |

## 1. 아키텍처

```
[빌드타임] scripts/build-audio-signals.mjs (Node+proj4, 수동)
   OA-15543 ZIP → DBF 순수 파싱(cp949) → EPSG:5186→WGS84 → src/lib/data/audio-signals.json (seed+meta)

[런타임]                       ┌ providers/audio-signals.ts (seed 조회, 동기)
  단일 오케스트레이션 서비스 ──┤
  src/lib/walk-infra.ts        └ providers/overpass.ts (타일 fetch+캐시)
        ▲                ▲
  /api/walk/nearby   채팅 get_walk_infrastructure   ← 두 소비자 모두 서비스 계층만 호출
```

- **단일 오케스트레이션 계층 `getWalkInfrastructure(lat, lng)`** (`src/lib/walk-infra.ts`, React 비의존): 소스별 실행·부분 실패 강등·상태 계약 생성을 한 곳에서. 라우트·채팅은 provider를 직접 호출하지 않는다(같은 사실이 소비자마다 다른 상태로 갈라지는 것을 구조적으로 차단). 각 소스 호출은 `(async () => …)()`로 감싸 동기 throw도 settled로 포착.
- **provider 격리**: `overpass.ts`가 OSM 태그를 자체 shape로 정규화 — 서비스·라우트·컴포넌트·채팅은 OSM 원시 필드를 모른다.
- seed 패턴은 subway-stations·voice-guides 관례 미러(원본 미커밋, 스크립트+생성 JSON 커밋).

## 2. 데이터 계약

### 2-A. 빌드 스크립트 `scripts/build-audio-signals.mjs`

- 입력: OA-15543 ZIP(재현 절차 주석: `datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do` POST `infId=OA-15543&infSeq=3&seq=11` — seq 변동 가능성 명시). DBF는 의존성 없이 struct 파싱(cp949), 좌표는 `XCE`/`YCE`.
- 변환: proj4에 EPSG:5186 정의 명시 `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs`.
- **스키마 드리프트·회귀 가드(전부 실패 시 abort — 빈 seed 배포 금지)**:
  1. 필수 필드(`MGRNU`·`XCE`·`YCE`·`STAT_CDE`) 존재 assert.
  2. 총행수 ≥ 20,000 · 좌표 유효율 ≥ 70% · 유효 건수 ≥ 15,000 assert.
  3. 변환 결과 전량 서울 bbox(lat 37.4~37.72, lng 126.73~127.2) 내 + **centroid가 lat 37.5~37.6, lng 126.9~127.1** assert(bbox 통과·전체 이동 회귀 이중 가드).
  4. **golden 좌표 대조**: 원본 5행의 (XCE,YCE)→WGS84 기대값을 pyproj(독립 도구)로 1회 산출해 스크립트에 상수로 박고, proj4 변환 결과와 오차 <1m assert(5181·2097·축 교환 오변환은 수백 m~수십 km 어긋나 즉시 검출 — mutation 테스트 대체).
- 필터·정렬: 좌표 파싱 실패(마스킹) 행과 `STAT_CDE !== "1"` 행 제외(제외 사유별 count를 meta에 기록), 출력은 (lat,lng) 사전순 정렬(diff 안정성).
- 출력 `src/lib/data/audio-signals.json`:
  ```json
  { "meta": { "source": "seoul-open-data OA-15543", "baseDate": "2026-05-28",
              "fetchedAt": "...", "dbfSha256": "...", "counts": { "total": 21451, "noCoord": 4604, "statExcluded": 0, "kept": 16847 } },
    "signals": [[lat, lng], ...] }
  ```
  `baseDate`는 ZIP 내 폴더명(`20260528_…`)에서 **파싱**(수기 입력 금지). 좌표 소수 5자리. 관리번호·제조회사·방향각(DRN_CDE)은 버린다(V1 산문 미사용 — DRN_CDE·STAT_CDE 의미는 정의서 미확보, §6).

### 2-B. Provider `src/lib/providers/audio-signals.ts` (서버 전용, 동기)

```ts
interface AudioSignalSite { distanceMeters: number; bearing: Bearing; deviceCount: number; }
interface NearbyAudioSignals {
  deviceCount: number;        // 반경 내 기기 총수
  sites: AudioSignalSite[];   // 좌표 4자리(≈11m) 군집 후 가까운 순 최대 5 — 한 지주 다기기 반복 낭독 방지
  baseDate: string;
}
findAudioSignalsNear(lat, lng, radiusMeters = 300): NearbyAudioSignals | null  // null = 서울 bbox 밖
```

- Haversine+`bearing.ts` 재사용(8방위, 진북 기준 — 기존 둘러보기와 동일 계약, heading 없어 정면-상대 방향 금지 관례 유지).
- **기기 수(deviceCount)와 지점 수(sites)를 분리** — "12기"가 12개 독립 횡단 지점으로 읽히는 오해 방지(산문은 "N기, 가까운 지점 남동 45m(2기)" 형).

### 2-C. Provider `src/lib/providers/overpass.ts`

```ts
// provider는 원시 좌표만 반환 — 거리·방위는 서비스 계층이 사용자 실좌표로 계산(§2-D 타일 캐시 전제)
interface RawWalkFeature {
  osmId: string;                 // "node/123" — 물리 객체 dedup 키
  lat: number; lng: number;
  crossing: boolean;             // highway=crossing
  crossingSignal: "yes" | "no" | "unknown";  // crossing=traffic_signals→yes / uncontrolled·unmarked→no / 그 외·없음→unknown (고정 매핑 표, 임의 확장 금지)
  tactilePaving: boolean;        // tactile_paving=yes
  hostFeature?: "busStop" | "subwayEntrance"; // 비-crossing tactile 노드의 호스트, 판별 가능할 때만
}
fetchWalkFeaturesTile(anchorLat, anchorLng, radiusMeters): Promise<RawWalkFeature[]>  // 실패·부분응답은 throw

// 서비스 계층이 소비자에 노출하는 최종 형태(거리·방위 부가, 300m 필터·정렬·cap 후)
type WalkFeature = RawWalkFeature & { distanceMeters: number; bearing: Bearing };
```

- **다중 라벨 모델**: crossing이면서 tactile인 노드는 항목 1개(osmId dedup)에 両플래그 — kind 배타 모델의 이중 계상/누락 딜레마 제거. 그룹 표시는 이 배열의 projection(횡단보도 그룹 = `crossing`, 점자블록 그룹 = `tactilePaving`)이며 **두 그룹 합계를 총계로 쓰지 않는다**.
- Overpass POST(`overpass-api.de`), User-Agent `gildongmu/1.0 (+https://gildongmu.vercel.app)`, `[timeout:10]`, AbortSignal 12초.
- **부분 응답 검출**: 응답 최상위 `remark` 존재 또는 `elements` 비배열이면 throw(200 위장 차단).
- 거리·방위는 **여기서 계산하지 않는다**(타일 anchor 기준 원시 좌표 반환, 아래 캐시 설계) — 실제 계산은 서비스 계층이 사용자 실좌표로 수행.

### 2-D. 캐시·호출 통제 (Overpass만 — seed는 무캐시)

- **타일 캐시**: 캐시 키 = 좌표 3자리 반올림 anchor(≈110m 그리드). **Overpass 질의 좌표는 anchor**(사용자 정밀 좌표를 외부 인스턴스로 보내지 않음 — 프라이버시 동시 해결), 반경 = 사용자 반경 300m + anchor 오프셋 상한 버퍼 100m = **400m 고정**. 서비스 계층이 타일 원시 feature를 받아 **사용자 실좌표로 거리·방위·300m 필터를 매 요청 재계산** — 같은 타일의 다른 사용자에게 남의 거리·방위가 재사용되는 결함 원천 차단.
- `unstable_cache`(revalidate 3600)는 **성공한 타일 fetch만** 감싼다(실패는 throw로 캐시 회피 — 부분 실패가 1시간 고착되는 것 방지). 동일 타일 동시 요청은 모듈 스코프 in-flight Map으로 single-flight.
- 호출 예산: IP 레이트리밋 60초 10회(공용 모듈) + **인스턴스 전역 Overpass 호출 카운터 분당 30회**(초과 시 즉시 osm error 강등 — 공개 인스턴스 예의, 서버리스 인스턴스별 한계는 §6 기록). 반경은 서버 고정값(사용자 입력 불가).

### 2-E. 서비스 계층 상태 계약 (discriminated union — nullable 중복 의미 금지)

```ts
type SourceStatus<T> =
  | { status: "ok"; data: T }
  | { status: "unsupported"; reason: "outsideSeoul" }   // 음향신호기 전용
  | { status: "error" };
interface WalkInfrastructure {
  audioSignals: SourceStatus<NearbyAudioSignals>;   // ok.data.deviceCount 0 가능(0 ≠ unsupported ≠ error)
  osm: SourceStatus<{
    features: WalkFeature[]; totalCount: number; listedCount: number; truncated: boolean;
    crossingTotal: number; tactileTotal: number;  // projection별 cap 전 실개수(§3 그룹별 문구용)
  }>;
}
getWalkInfrastructure(lat, lng): Promise<WalkInfrastructure>
```

- `count`류 필드는 `status:"ok"` 안에만 존재 — error 상태에서 0을 합성할 자리가 타입상 없다.
- OSM `totalCount`(cap 전 실개수) / `listedCount`(cap 10 후) / `truncated` 분리. 강남 69곳이 "10곳"으로 과소 낭독되는 것 방지. `crossingTotal`·`tactileTotal`은 crossing·비-crossing tactile 두 projection 각각의 cap 전 실개수라 그룹별 문구("횡단보도 69곳 중 가까운 10곳")를 합집합 수치로 지어내지 않고 그대로 낭독한다.
- 라우트 `/api/walk/nearby`(GET, lat/lng zod)는 이 결과를 `{ walk: WalkInfrastructure }`로 그대로 직렬화. 400(zod)/429(IP)/503(両소스 모두 error일 때만) 구분, 부분 실패는 200.
- 채팅 도구도 같은 `WalkInfrastructure`를 data로 반환하고 `source`는 **성공한 소스만** 명시(서울시 baseDate·OSM 여부 각각).

### 2-F. 상태×산문 매트릭스 (정본 — UI i18n·채팅 산문 공통 판정)

| audioSignals | osm | 산문(요지) |
|---|---|---|
| ok(N>0) | ok(M>0) | §3 낭독(기수·지점·그룹별) |
| ok(0) | — | "반경 300m 안에 등록된 음향신호기가 없습니다" |
| unsupported | — | "음향신호기 정보는 서울만 제공됩니다" |
| error | — | "음향신호기 정보를 불러오지 못했습니다" |
| — | ok(0) | "주변에 등록된 횡단보도·점자블록 정보가 없습니다" |
| — | error | "횡단보도·점자블록 정보를 불러오지 못했습니다" |
| 공통 각주 | | **"서울시·OSM 등록 자료 기준으로, 실제 시설 유무나 작동 상태와 다를 수 있습니다"**(거짓 안심·등록≠작동 両방향) + 출처·기준일 |

- 5×2 소스 독립 조합 전부가 위 행의 합성으로 결정됨(소스별 독립 문장 — 조합 폭발 없음). 단일 polite 통지도 같은 매트릭스에서 합성하되 **ok 소스의 수치만 낭독**(error·unsupported 소스는 실패·미제공 문구로, "0기" 합성 금지).
- 이 판정을 **순수 함수 하나**(웹: i18n 키 선택 헬퍼, 채팅: 산문 캡 헬퍼)로 구현하고, route·UI·채팅이 같은 fixture로 같은 판정을 내리는 parity 테스트를 둔다.

## 3. UI — 신규 "내 주변" 패널 "보행 인프라"

- **별도 패널**(7번째 nearby) — 둘러보기(POI 훑기)와 소비 맥락(횡단 의사결정)이 달라 분리. `nearby-panel-store` claim/close·Esc·포커스 비대칭 계약 재사용. 트리거 버튼이 발견 경로이므로 패널은 `<div>`(region 금지 — 헌장 §3).
- 구조: 그룹 헤더 `<h4>` 3개(음향신호기 / 횡단보도 / 점자블록) + 항목은 이름 없는 인프라 점이라 **heading 미부여**(도착편 목록 관례 — 과잉 방지). 항목 한 줄 = 한 객체(joinText, 쉼표):
  - 음향신호기: 요약 줄 "반경 300m 안 12기" + 지점 줄 "남동 45m(2기)" ×최대 5.
  - 횡단보도: "남 30m, 신호등 있음"(crossingSignal=yes일 때만 병기, unknown은 침묵) · "동 25m, 점자블록 있음"(tactilePaving 병기).
  - 점자블록(비-crossing): "동 60m, 버스정류장".
  - truncated면 그룹 헤더에 총수 병기("횡단보도 69곳 중 가까운 10곳").
- 통지: 단일 polite 1회(§2-F 매트릭스 합성), 로드 후 포커스는 기존 nearby 패널 관례 미러.
- 출처 표기(ODbL 의무): "© OpenStreetMap 기여자 · 음향신호기: 서울특별시 제공(2026-05-28 기준)". 이모지·em dash 금지.
- i18n 5로케일(거리·방위 합성 산문이라 전체 번역 가능, `prefersEnglish` 규칙 준수).

## 4. 채팅 도구 `get_walk_infrastructure` (17번째)

- 좌표 도구(anchorOf 규칙 — placeContext 있으면 장소 좌표 기준, 기존 도구 관례 동일). **서비스 계층만 호출**. 게이트 불필요(무키)라 항상 등록. 도구가 준 필드만 산문화(날조 금지 systemInstruction 기존 원칙). render 카드 생략(산문 정본). CLI/MCP 카탈로그 반영은 다음 CLI 릴리스에 편승.

## 5. 테스트·머지 게이트 (2레인)

- **결정론 게이트(매 커밋, Vitest)**: ① §2-F 전 상태 조합(ok/0/unsupported/error × ok/0/error) parity(라우트 직렬화·UI 키 선택·채팅 산문) ② Overpass fixture: 정상·`remark` 부분응답·malformed JSON·429·abort ③ multi-label dedup(crossing+tactile 1건, 両그룹 projection, 합계 미사용) ④ cap: totalCount/listedCount/truncated ⑤ 타일 캐시: 같은 타일 두 anchor 좌표의 거리·방위가 각자 실좌표 기준으로 다르게 계산됨 ⑥ 빌드 스크립트 가드: 필드 누락·전량 필터·centroid 이탈·golden 오차 주입 시 abort(스크립트를 함수로 분리해 단위 테스트).
- **실호출 게이트(머지 전 1회, 데이터 현실 검증)**: 길동(음향신호기 실개수>0·crossing 존재)·강남(truncated 케이스)·부산(unsupported 문장)·Overpass 강제 실패(무효 인스턴스 env로 error 문장) 4종 + 프로덕션 배포 후 스모크. 수치 고정 어서션 금지(OSM은 살아있는 데이터 — 존재·상태만 검증).

## 6. 리스크·미결 (V1 의도적 보류 — 은폐 아닌 기록)

- **DRN_CDE(방향각)·STAT_CDE 의미**: 테이블 정의서 PDF 미확보. V1은 STAT_CDE=1만 수록(21,426/21,451)·작동 상태 무주장. 정의서 확보 시 "신호기가 향한 방향" 안내·상태 필터 재검토.
- **OSM way/area 점자블록·crossing way 미포함**: V1 커버리지 프로파일은 노드 한정 — 산문이 "등록된 정보" 표현으로 과대 주장 안 함. 후속에서 way center 포함 검토.
- **stale-if-error·negative cache·CI 신선도 게이트 미도입**: 트래픽 규모(개인 프로젝트) 대비 과설계로 판단. 장애 시 error 문장 강등으로 안전(거짓 데이터 없음). seed 갱신은 수동(meta.fetchedAt·PROGRESS 기록, 위원장 연 1회 점검 항목).
- **전역 호출 카운터는 인스턴스 단위**(Vercel 서버리스 메모리 한계) — 절대 상한이 아니라 완화 장치. 남용 시 Overpass 측 429가 최종 백스톱(error 강등으로 흡수).
- **GPS 정확도 미반영**: 기존 둘러보기·where-am-i와 동일 계약(8방위 진북) 유지 — 앱 전역 개선 사안이라 이 기능 단독 도입 안 함.
- 전국 확장(경찰청 계열)은 서울 V1 검증 후 별도 spec.

## 7. codex 적대적 리뷰 처리 기록 (2026-07-22, 22건)

- **수용(설계 반영)**: ①null 중복 의미→discriminated union(§2-E) ②단일 오케스트레이션 계층(§1) ③동기 throw 포착(§1) ④상태별 산문 순수 함수+parity(§2-F) ⑤소스 메타 분리(§2-E) ⑥다중 라벨 모델(§2-C) ⑦total/listed/truncated(§2-E) ⑧기기/지점 분리(§2-B) ⑨crossing 매핑 고정 표+unknown(§2-C) ⑩타일 원시 캐시+실좌표 재계산(§2-D) ⑪성공만 캐시(§2-D) ⑫remark 부분응답 검출(§2-C) ⑬전역 카운터+single-flight(§2-D) ⑭정밀 좌표 외부 전송 차단 — 타일 anchor 질의로 해결(§2-D) ⑮golden 좌표 대조(§2-A) ⑯스키마 드리프트 assert(§2-A) ⑱STAT_CDE 필터+등록≠작동 각주(§2-A·§2-F) ⑲manifest·정렬(§2-A) ㉒fixture 결정론 게이트 승격(§5).
- **경량 수용**: ⑧군집=좌표 4자리(§2-B) ⑮mutation 스위트 대신 golden 오차 어서션(§5⑥).
- **보류(§6 기록, 근거 명시)**: ⑰GPS 정확도·bearing 기준 구조화(앱 전역 관례 유지) ⑳CI 신선도 게이트(수동 프로젝트 과설계) ㉑way/area 확장(V1 프로파일 명시로 대체) ⑪-후단 stale-if-error(트래픽 규모).
