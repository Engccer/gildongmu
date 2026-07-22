# 보행 인프라(둘러보기 기능 B) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울시 음향신호기 seed(OA-15543)+OSM Overpass(횡단보도·점자블록)를 단일 서비스 계층으로 합성해 "내 주변 보행 인프라" 패널·라우트·채팅 도구를 추가한다.

**Architecture:** spec 정본 `docs/superpowers/specs/2026-07-22-walk-infrastructure-design.md`(v2, codex 리뷰 22건 반영). 빌드타임 seed(EPSG:5186→WGS84, golden 가드) + 런타임 타일 캐시 Overpass + discriminated status 계약. 라우트·채팅은 `getWalkInfrastructure()` 서비스만 호출.

**Tech Stack:** Next.js 16, TypeScript, proj4(기존 의존성), Vitest, next-intl.

## Global Constraints

- **spec이 정본** — 이 플랜과 spec이 다르면 spec을 따르고 보고하라.
- 상태 계약: `SourceStatus<T> = {status:"ok",data:T} | {status:"unsupported",reason:"outsideSeoul"} | {status:"error"}`. count류 필드는 ok.data 안에만.
- 좌표계: EPSG:5186 정의 `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs`.
- Overpass: User-Agent `gildongmu/1.0 (+https://gildongmu.vercel.app)` 필수, `remark` 존재 시 throw, 질의 좌표는 타일 anchor(사용자 정밀 좌표 외부 전송 금지), 반경 400m 고정.
- 산문·라벨: joinText 쉼표 구분, 한 줄=한 객체, 이모지·em dash 금지, `<h4>` 그룹 헤더 3개(음향신호기/횡단보도/점자블록)·항목 heading 미부여, 패널은 `<div>`(region 금지).
- 3-state 산문은 spec §2-F 매트릭스가 정본(공통 각주 "서울시·OSM 등록 자료 기준으로, 실제 시설 유무나 작동 상태와 다를 수 있습니다").
- 커밋: `git add <신규 파일>` 후 같은 체인에서 pathspec 커밋. 메시지 한국어+푸터(Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> / Claude-Session: https://claude.ai/code/session_016bd5VyNbN4CryLmP3M2tqh). 커밋 후 `git show HEAD --stat` 검증. `git add -A` 금지.
- 기존 유틸 재사용: `src/lib/geo/bearing.ts`(`CompassDirection`·`bearingDegrees`·`bearingToCompass8`·`haversineMeters`), `src/lib/rate-limit.ts`, `src/lib/format.ts` joinText. 재구현 금지.
- i18n 5로케일(ko/en/es/fr/it) 동시 갱신 — `i18n-messages.test.ts`가 게이트.

---

### Task 1: 빌드 스크립트 + seed 생성

**Files:**
- Create: `scripts/build-audio-signals.mjs` (파싱·가드·변환 순수 함수 export + main)
- Create: `src/lib/__tests__/build-audio-signals.test.ts`
- Create: `src/lib/data/audio-signals.json` (스크립트 실행 산출물 — 커밋 포함)

**Interfaces:**
- Produces: seed JSON `{ meta: { source, baseDate, fetchedAt, dbfSha256, counts:{total,noCoord,statExcluded,kept} }, signals: [[lat,lng],...] }` — Task 2가 import.
- Produces(스크립트 export): `parseDbf(buffer): {fields:string[], rows:Record<string,string>[]}`, `buildSeed(rows, {now}): {meta, signals}` (가드 실패 시 throw).

- [ ] **Step 1: 실패 테스트 작성** — `buildSeed`에 대해 ① 필수 필드 누락 rows→throw ② 유효 건수 15,000 미만→throw ③ centroid 서울 밖(전 행을 lng+1 오프셋 좌표로)→throw ④ golden 5점 오차 <1m 통과, 5181 정의로 바꾼 변환(테스트에서 proj4로 직접 오변환 좌표 주입) 시 throw ⑤ 마스킹 행 counts.noCoord 집계 ⑥ signals가 (lat,lng) 사전순 정렬. golden 상수(pyproj 독립 산출, 2026-07-22):

```js
const GOLDEN = [
  { x: 187968.299999927, y: 549055.306243806, lat: 37.5409278, lng: 126.8638597 },
  { x: 205994.858585621, y: 553916.705437931, lat: 37.5847878, lng: 127.0678724 },
  { x: 190423.974999942, y: 553317.881244307, lat: 37.5793622, lng: 126.8915903 },
  { x: 209521.207296075, y: 546845.954115851, lat: 37.5210509, lng: 127.1077052 },
  { x: 204606.600000029, y: 552616.993744226, lat: 37.5730855, lng: 127.0521467 },
];
```

테스트 fixture는 GOLDEN의 x/y를 XCE/YCE로 갖는 합성 rows(+마스킹 행 `**********` 1개, STAT_CDE "1")를 만들어 사용. 실 DBF 41MB는 테스트에 쓰지 않는다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/build-audio-signals.test.ts` FAIL(모듈 없음).

- [ ] **Step 3: 스크립트 구현** — `scripts/build-audio-signals.mjs`:

```js
// 서울시 음향신호기 seed 생성 (spec 2026-07-22-walk-infrastructure-design.md §2-A)
// 재생성 절차:
//   1) curl -sL -o /tmp/audio-signal.zip -A "Mozilla/5.0" -X POST \
//      "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false" \
//      --data "infId=OA-15543&infSeq=3&seq=11"   (seq는 변동 가능 — OA-15543 페이지에서 확인)
//   2) unzip -o /tmp/audio-signal.zip -d /tmp/audio-signal
//   3) node scripts/build-audio-signals.mjs "/tmp/audio-signal/<폴더>/<파일>.dbf"
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import proj4 from "proj4";

const EPSG5186 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const REQUIRED_FIELDS = ["MGRNU", "XCE", "YCE", "STAT_CDE"];
// pyproj(독립 도구)로 산출한 대조점 — 5181·2097·축 교환 오변환은 수백 m 이상 어긋나 즉시 검출.
export const GOLDEN = [ /* Step 1의 GOLDEN 배열 그대로 */ ];

export function parseDbf(buf) {
  const nrec = buf.readUInt32LE(4);
  const hdrlen = buf.readUInt16LE(8);
  const reclen = buf.readUInt16LE(10);
  const fields = [];
  for (let off = 32; buf[off] !== 0x0d; off += 32) {
    const name = buf.subarray(off, off + 11).toString("latin1").split("\0")[0];
    fields.push({ name, len: buf[off + 16] });
  }
  const decoder = new TextDecoder("euc-kr");
  const rows = [];
  for (let i = 0; i < nrec; i++) {
    const base = hdrlen + i * reclen;
    let off = base + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = decoder.decode(buf.subarray(off, off + f.len)).trim();
      off += f.len;
    }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

export function buildSeed({ fields, rows }, { now, baseDate, dbfSha256 }) {
  for (const req of REQUIRED_FIELDS) {
    if (!fields.includes(req)) throw new Error(`필수 필드 누락: ${req}`);
  }
  if (rows.length < 20000) throw new Error(`총행수 이상: ${rows.length}`);
  const toWgs = proj4(EPSG5186, "WGS84");
  for (const g of GOLDEN) {
    const [lng, lat] = toWgs.forward([g.x, g.y]);
    const errM = Math.hypot((lat - g.lat) * 111320, (lng - g.lng) * 88000);
    if (errM > 1) throw new Error(`golden 좌표 오차 ${errM.toFixed(1)}m — 좌표계 정의 회귀 의심`);
  }
  let noCoord = 0, statExcluded = 0;
  const signals = [];
  for (const row of rows) {
    const x = Number(row.XCE), y = Number(row.YCE);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { noCoord++; continue; }
    if (row.STAT_CDE !== "1") { statExcluded++; continue; }
    const [lng, lat] = toWgs.forward([x, y]);
    if (lat < 37.4 || lat > 37.72 || lng < 126.73 || lng > 127.2) {
      throw new Error(`서울 bbox 이탈: ${lat},${lng} — 좌표계 회귀 의심`);
    }
    signals.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  }
  if (signals.length < 15000) throw new Error(`유효 건수 부족: ${signals.length}`);
  const cLat = signals.reduce((s, p) => s + p[0], 0) / signals.length;
  const cLng = signals.reduce((s, p) => s + p[1], 0) / signals.length;
  if (cLat < 37.5 || cLat > 37.6 || cLng < 126.9 || cLng > 127.1) {
    throw new Error(`centroid 이탈: ${cLat},${cLng}`);
  }
  signals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    meta: { source: "seoul-open-data OA-15543", baseDate, fetchedAt: now, dbfSha256,
            counts: { total: rows.length, noCoord, statExcluded, kept: signals.length } },
    signals,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const dbfPath = process.argv[2];
  if (!dbfPath) { console.error("사용법: node scripts/build-audio-signals.mjs <dbf 경로>"); process.exit(1); }
  const buf = readFileSync(dbfPath);
  // baseDate는 폴더명(20260528_…)에서 파싱 — 수기 입력 금지(spec §2-A)
  const m = basename(dirname(dbfPath)).match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) throw new Error("폴더명에서 기준일을 파싱할 수 없음");
  const seed = buildSeed(parseDbf(buf), {
    now: new Date().toISOString(),
    baseDate: `${m[1]}-${m[2]}-${m[3]}`,
    dbfSha256: createHash("sha256").update(buf).digest("hex"),
  });
  writeFileSync("src/lib/data/audio-signals.json", JSON.stringify(seed));
  console.log("생성 완료:", seed.meta.counts);
}
```

주의: euc-kr TextDecoder가 Node에서 미지원이면(`RangeError`) `latin1`로 읽되 한글 필드는 seed에 안 쓰므로 파싱만 통과시켜라(MK_CPY 등은 버려짐) — 이 경우 보고서에 기록.

- [ ] **Step 4: 테스트 통과 확인** — 위 vitest GREEN.
- [ ] **Step 5: 실데이터로 seed 생성** — 주석의 재생성 절차 1~3 실행(스크래치 디렉터리 사용). 기대: `kept` 약 16,800±100(STAT_CDE 제외로 16,847보다 약간 작을 수 있음), `src/lib/data/audio-signals.json` 생성(약 400~500KB).
- [ ] **Step 6: 커밋** — `git add scripts/build-audio-signals.mjs src/lib/__tests__/build-audio-signals.test.ts src/lib/data/audio-signals.json` 후 pathspec 커밋 `feat(walk-infra): 음향신호기 seed 파이프라인 — OA-15543 DBF 파싱+EPSG:5186 golden 가드`.

---

### Task 2: audio-signals provider

**Files:**
- Create: `src/lib/providers/audio-signals.ts`
- Test: `src/lib/providers/__tests__/audio-signals.test.ts`

**Interfaces:**
- Produces:
```ts
import type { CompassDirection } from "@/lib/geo/bearing";
export interface AudioSignalSite { distanceMeters: number; bearing: CompassDirection; deviceCount: number; }
export interface NearbyAudioSignals { deviceCount: number; sites: AudioSignalSite[]; baseDate: string; }
export function findAudioSignalsNear(lat: number, lng: number, radiusMeters?: number): NearbyAudioSignals | null;
```

- [ ] **Step 1: 실패 테스트** — 실 seed JSON을 import해 ① 서울 좌표(길동 37.5378,127.1399)에서 non-null·deviceCount≥0 ② 부산(35.18,129.07)→null ③ 군집: 합성 검증은 내부 함수 `clusterSites(points, origin)` export로 — 같은 4자리 좌표 2점이 site 1개 deviceCount 2 ④ sites 가까운 순·최대 5 ⑤ 300m 밖 점 미포함.
- [ ] **Step 2: 실패 확인** (vitest FAIL).
- [ ] **Step 3: 구현** — seed 정적 import(`import seed from "@/lib/data/audio-signals.json"` — 서버 전용 모듈), 서울 bbox(스크립트와 동일 상수) 밖 null, 반경 내 필터(haversineMeters), 좌표 `toFixed(4)` 키로 군집, 각 군집 최근접점 기준 distance/bearing(bearingDegrees→bearingToCompass8), 거리순 상위 5. 기본 radiusMeters 300.
- [ ] **Step 4: GREEN 확인** → **Step 5: 커밋** `feat(walk-infra): 음향신호기 provider — bbox 3-state·지점 군집`.

---

### Task 3: overpass provider

**Files:**
- Create: `src/lib/providers/overpass.ts`
- Test: `src/lib/providers/__tests__/overpass.test.ts` (+fixture 상수는 테스트 파일 내 인라인)

**Interfaces:**
- Produces:
```ts
export interface RawWalkFeature {
  osmId: string; lat: number; lng: number;
  crossing: boolean;
  crossingSignal: "yes" | "no" | "unknown";
  tactilePaving: boolean;
  hostFeature?: "busStop" | "subwayEntrance";
}
export function normalizeOverpassElements(elements: unknown[]): RawWalkFeature[];
export function fetchWalkFeaturesTile(anchorLat: number, anchorLng: number, radiusMeters: number, opts?: { signal?: AbortSignal }): Promise<RawWalkFeature[]>;
```

- [ ] **Step 1: 실패 테스트** — `normalizeOverpassElements`: ① crossing 노드(`tags:{highway:"crossing",crossing:"traffic_signals"}`)→`{crossing:true,crossingSignal:"yes"}` ② `crossing:"uncontrolled"`→"no", `crossing:"zebra"`→"unknown"(고정 표 밖), 태그 없음→"unknown" ③ crossing+`tactile_paving:"yes"` 동시→항목 1개 両플래그 ④ 같은 id 중복 요소 dedup ⑤ tactile 버스정류장(`highway:"bus_stop"`)→`hostFeature:"busStop"`, `railway:"subway_entrance"`→"subwayEntrance" ⑥ `fetchWalkFeaturesTile`은 fetch mock으로: 200+`remark` 필드→throw, elements 비배열→throw, 비200→throw, 정상→정규화 결과. 고정 매핑 표: `traffic_signals→yes`, `uncontrolled→no`, `unmarked→no`, 그 외 전부 unknown.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — POST body `data=[out:json][timeout:10];(node(around:R,lat,lng)[highway=crossing];node(around:R,lat,lng)[tactile_paving=yes];);out tags center;`(cap 없음 — cap은 서비스 계층), User-Agent 헤더, 인스턴스 URL은 `process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter"`(실호출 게이트의 강제 실패용 env 우회 허용), AbortSignal 12초 기본. 좌표는 `el.lat/el.lon`(node) 우선, `el.center` 폴백.
- [ ] **Step 4: GREEN** → **Step 5: 커밋** `feat(walk-infra): Overpass provider — 다중 라벨 정규화·remark 부분응답 차단`.

---

### Task 4: 서비스 계층 walk-infra.ts (타일 캐시·상태 계약)

**Files:**
- Create: `src/lib/walk-infra.ts`
- Test: `src/lib/__tests__/walk-infra.test.ts`

**Interfaces:**
- Consumes: Task 2·3의 export.
- Produces:
```ts
export type SourceStatus<T> =
  | { status: "ok"; data: T }
  | { status: "unsupported"; reason: "outsideSeoul" }
  | { status: "error" };
export type WalkFeature = RawWalkFeature & { distanceMeters: number; bearing: CompassDirection };
export interface OsmWalkData { features: WalkFeature[]; totalCount: number; listedCount: number; truncated: boolean; }
export interface WalkInfrastructure {
  audioSignals: SourceStatus<NearbyAudioSignals>;
  osm: SourceStatus<OsmWalkData>;
}
export function getWalkInfrastructure(lat: number, lng: number): Promise<WalkInfrastructure>;
export function __resetWalkInfraForTest(): void; // in-flight Map·전역 카운터 리셋
```

- [ ] **Step 1: 실패 테스트**(provider mock — `vi.mock`): ① 両소스 정상→両 ok, osm totalCount=원본 수·listedCount≤10(그룹별 아님 — **crossing projection 10·비-crossing tactile projection 10을 각각 cap** 후 합집합, truncated는 둘 중 하나라도 잘리면 true) ② overpass reject→osm error, audioSignals는 ok 유지(부분 실패 보존) ③ 부산→audioSignals unsupported ④ findAudioSignalsNear가 throw해도(모킹) audioSignals error로 강등(동기 throw 포착) ⑤ **같은 타일 두 좌표**: fetch 1회(single-flight/캐시), 두 결과의 distanceMeters가 서로 다름(실좌표 재계산) ⑥ 전역 카운터 30 초과 시 osm error.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — 타일 anchor=좌표 `toFixed(3)`, Overpass 호출은 `unstable_cache`(키 `walk-tile:${anchorLat}:${anchorLng}`, revalidate 3600)로 감싸되 **성공만 캐시**(throw는 캐시 안 됨 — unstable_cache는 throw 시 미저장), 모듈 스코프 `Map<string, Promise<RawWalkFeature[]>>` single-flight(정착 시 delete), 모듈 스코프 분당 카운터(30 초과 시 즉시 throw). 각 소스 `(async () => …)()` 래핑 후 `Promise.allSettled`. osm 성공 시: 사용자 실좌표로 haversine 300m 필터→거리·방위 부가→거리순→projection별 cap 10→합집합(osmId 유일). 반경 400 고정으로 타일 fetch.
- [ ] **Step 4: GREEN** → **Step 5: 커밋** `feat(walk-infra): 단일 오케스트레이션 서비스 — discriminated status·타일 캐시 실좌표 재계산`.

---

### Task 5: 라우트 /api/walk/nearby

**Files:**
- Create: `src/app/api/walk/nearby/route.ts`
- Modify: `src/lib/rate-limit.ts` (`checkWalkInfraRateLimit` 60초 10회 — 기존 함수들과 동형 3줄)
- Test: `src/lib/__tests__/walk-nearby-route.test.ts` (기존 라우트 테스트 관례 확인 후 동형 — 없으면 서비스 mock으로 GET 핸들러 직접 호출)

**Interfaces:**
- Consumes: `getWalkInfrastructure`.
- Produces: GET `?lat&lng` → 200 `{ walk: WalkInfrastructure }` / 400 zod / 429 / 503(両소스 error일 때만).

- [ ] **Step 1: 실패 테스트** — ① 정상 200 shape ② lat 누락 400 ③ 両 error→503 ④ 부분 실패(osm error)는 200. **Step 2: 실패 확인** → **Step 3: 구현** — zod `z.coerce.number()` lat(-90~90)/lng(-180~180), `clientIpFromHeaders`+`checkWalkInfraRateLimit`, `force-dynamic` 불필요(서비스 내부 캐시가 담당 — 라우트는 기본). **Step 4: GREEN + `npm run test:run` 전체** → **Step 5: 커밋** `feat(walk-infra): /api/walk/nearby 라우트 — 3-state 직렬화·레이트리밋`.

---

### Task 6: UI 패널 + i18n 5로케일

**Files:**
- Create: `src/components/WalkInfraNearby.tsx`
- Modify: 패널 마운트 지점(기존 6종 nearby가 나열된 부모 — `BarrierFreeNearby` 마운트 위치를 grep해 같은 곳에 추가)
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json` (`walkInfra.*` 네임스페이스)
- Test: `i18n-messages.test.ts` 자동 게이트(키 일관성)

**Interfaces:**
- Consumes: `/api/walk/nearby` fetch, `useGeolocation`/`awaitGeolocation`(직접 getCurrentPosition 금지), `useNearbyPanel`(claim/close 계약), joinText.

- [ ] **Step 1: 기존 패널 정독** — `src/components/BarrierFreeNearby.tsx`(가장 단순한 버튼 트리거 nearby)를 열어 구조(버튼→fetch→패널·live region·포커스·`useNearbyPanel` 사용법)를 그대로 미러한다. 이 Task는 컴포넌트 와이어링이라 단위테스트 레인 없음(관례) — lint+build+실호출이 게이트.
- [ ] **Step 2: 구현** — spec §3 구조: 트리거 버튼 라벨 ko "주변 보행 인프라", 패널 `<div>`, 그룹 `<h4>` 3개, 항목 joinText 단일 텍스트, truncated 총수 병기, §2-F 매트릭스별 문장(각 소스 독립), 공통 각주+출처 "© OpenStreetMap 기여자 · 음향신호기: 서울특별시 제공({baseDate} 기준)", 단일 polite 통지(ok 소스 수치만·error/unsupported는 해당 문구), 방위는 기존 `COMPASS_KO` 대응 i18n 키 재사용(둘러보기 컴포넌트의 방위 키를 grep해 재사용 — 신규 중복 정의 금지).
- [ ] **Step 3: i18n 5로케일** — walkInfra 키 전체(버튼·헤더 3·상태 문장 6·각주·출처·통지 합성)를 ko 먼저, en/es/fr/it 번역. `npx vitest run src/lib/__tests__/i18n-messages.test.ts` GREEN.
- [ ] **Step 4: lint+build** — `npm run lint && npm run build` PASS. **Step 5: 커밋** `feat(walk-infra): 보행 인프라 패널 — 7번째 nearby·3-state 산문·5로케일`.

---

### Task 7: 채팅 도구 get_walk_infrastructure

**Files:**
- Modify: `src/lib/chat/declarations.ts` (`get_surroundings` 항목을 참조해 동형 추가 — 게이트 없음이라 항상 노출)
- Modify: `src/lib/chat/router.ts` (도구 실행 분기 — 기존 좌표 도구 케이스 미러, anchorOf 규칙 적용)
- Test: `src/lib/chat/__tests__/` 기존 도구 테스트 관례에 맞춰 1파일 추가(선언 노출+라우터 위임+data shape)

**Interfaces:**
- Consumes: `getWalkInfrastructure`(서비스만 — provider 직접 호출 금지), `anchorOf`.
- Produces: `ToolResult{ data: WalkInfrastructure, source }` — source는 성공 소스만(서울시 음향신호기 baseDate 병기·OSM).

- [ ] **Step 1: 기존 도구 1개(get_surroundings) 선언·라우팅·테스트를 정독 후 실패 테스트 작성** → **Step 2: FAIL** → **Step 3: 구현**(declaration description은 "주변 음향신호기·횡단보도·점자블록(등록 자료 기준)" — LLM이 작동 보장으로 산문화하지 않도록 "등록 기준, 실제와 다를 수 있음"을 description에 명시) → **Step 4: GREEN+전체 suite** → **Step 5: 커밋** `feat(walk-infra): 채팅 get_walk_infrastructure 도구(17종)`.

---

### Task 8: 실호출 게이트 + 문서

**Files:** 검증 전용 + Modify: `PROGRESS.md`, `docs/SPEC.md`(실험 백로그 갱신 관례)

- [ ] **Step 1: 로컬 실호출 4종** — dev 서버(`npm run dev`)로:
```bash
curl -s "localhost:3000/api/walk/nearby?lat=37.5378&lng=127.1399" | python3 -m json.tool | head -40   # 길동: audioSignals ok(개수>0 기대)·osm ok(crossing 존재)
curl -s "localhost:3000/api/walk/nearby?lat=37.4979&lng=127.0276" | python3 -m json.tool | head -40   # 강남: truncated true 기대
curl -s "localhost:3000/api/walk/nearby?lat=35.18&lng=129.07"                                          # 부산: audioSignals unsupported
OVERPASS_URL=https://invalid.example.com/api npm run dev  # 재기동 후 길동 재호출: osm error·audioSignals ok(부분 실패 200)
```
- [ ] **Step 2: 채팅 도구 실호출** — dev 채팅에서 장소 상세("길동생태공원" 등) 진입 후 "주변에 음향신호기 있어?" 1회 — 도구 호출·산문에 등록 기준 각주 반영 확인.
- [ ] **Step 3: 결과를 PROGRESS.md 운영 표 신규 행 + docs/SPEC.md 실험 백로그에 기록, 커밋** `docs(progress): 보행 인프라(기능 B) 실호출 검증 기록`.
- [ ] **Step 4: a11y-auditor 서브에이전트 점검**(신규 패널 — 헌장 기준: 과잉 ARIA 없음·한 줄=한 객체·단일 polite·h4 계층) — 지적 시 fix 커밋.
- [ ] **Step 5: push(자동배포) 후 프로덕션 스모크** — `curl -s "https://gildongmu.vercel.app/api/walk/nearby?lat=37.5378&lng=127.1399"` 200 확인.
