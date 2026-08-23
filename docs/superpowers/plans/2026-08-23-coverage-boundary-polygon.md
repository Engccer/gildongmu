# 커버리지 국경 폴리곤 승격 (E19) 구현 계획

> **For agentic workers:** 이 계획은 **inline 실행**이다(아래 판정 참조). 단계는 체크박스로 추적한다.

**Goal:** `isInKorea`를 사각형에서 국경 폴리곤 판정으로 바꿔 후쿠오카·개성 같은 좌표가 "한국 안"으로 통과하지 않게 한다.

**Architecture:** E12가 walk seed 안에 넣어 둔 국경 링 4개(2,580점)를 `src/lib/data/korea-boundary.json`으로 **분리**해 한 벌로 만들고, `coverage.ts`(사각형 프리필터 + ray casting)와 Kit `Coverage.swift`(SPM 리소스 사본 파싱)가 같은 데이터를 본다. 호출부는 한 줄도 바뀌지 않는다 — 술어의 정밀도만 오른다.

**Tech Stack:** TypeScript(Next.js 16 서버·클라 공용 `src/lib`), Vitest, Swift 6.2(SwiftPM 리소스 `.copy`), Node 스크립트(연 1회 seed 생성).

**Spec:** `docs/superpowers/specs/2026-08-23-coverage-boundary-polygon-design.md`

**구현 방식 판정(AUTONOMY §구현 방식 판정):** **inline**. 태스크가 순차 의존이다 — 데이터 분리(T1)가 확정돼야 `coverage.ts`(T2)의 import 대상이 정해지고, T2의 시그니처가 확정돼야 provider(T3)·Kit(T4)이 붙는다. 수정 파일도 겹친다(T1·T3가 같은 빌드 스크립트). 선행 결정이 후속 태스크의 인터페이스를 바꾸므로 위임 대상이 아니다. 리뷰는 판정과 무관하게 서브에이전트로 분리한다.

## Global Constraints

- **커버리지 마커 계약 불변**: 라우트 응답은 그대로 `200 {"outOfCoverage": true}`. 파싱→마커→키 게이트→upstream 순서를 바꾸지 않는다.
- **폴리곤은 한 벌**: 링 좌표가 두 곳에 존재하면 안 된다(웹 파일 ↔ Kit 리소스는 **바이트 동일 사본**이고 드리프트 테스트가 강제).
- **ODbL**: 새 데이터 파일은 OSM 파생이라 `NOTICE.md`에 자기 행을 갖고, 국내 공공데이터 seed와 한 파일로 합치지 않는다.
- **낭독 문구 변경 0**: 이 마일스톤은 i18n 문자열을 추가·수정하지 않는다.
- 커밋은 pathspec(`git commit -- <경로>`), `git add -A` 금지.

---

### Task 1: 국경 링을 자기 파일로 분리한다

**Files:**
- Create: `src/lib/data/korea-boundary.json` (기존 seed의 `boundary`를 값 변경 없이 옮김)
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json` (바이트 동일 사본)
- Modify: `src/lib/data/osm-walk-nodes.json` (`boundary` 필드 제거)
- Modify: `scripts/build-osm-walk-nodes.mjs` (연 1회 재생성이 두 산출물을 함께 쓰도록)
- Modify: `ios/GildongmuKit/Package.swift` (`.copy("Resources/korea-boundary.json")`)
- Modify: `NOTICE.md` (새 행)
- Test: `src/lib/__tests__/korea-boundary-drift.test.ts`

**Interfaces:**
- Produces: `korea-boundary.json` 모양 `{ meta: { source, license, licenseUrl, attribution, osmTimestamp, points }, rings: Array<Array<[number, number]>> }`. 링은 `[lat, lng]` 쌍이고 닫혀 있다(첫 점 == 끝 점).

- [ ] **Step 1: 드리프트 테스트를 먼저 쓴다(실패해야 한다)**

```ts
// src/lib/__tests__/korea-boundary-drift.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const WEB = join(ROOT, "src/lib/data/korea-boundary.json");
const KIT = join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json");

describe("국경 폴리곤 웹 ↔ Kit 사본", () => {
  it("두 파일은 바이트 동일이다", () => {
    expect(readFileSync(KIT)).toEqual(readFileSync(WEB));
  });

  it("링은 넷이고 전부 닫혀 있다", () => {
    const { rings } = JSON.parse(readFileSync(WEB, "utf8"));
    expect(rings).toHaveLength(4);
    for (const ring of rings) expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("walk seed는 더 이상 자기 링을 들지 않는다", () => {
    const seed = JSON.parse(readFileSync(join(ROOT, "src/lib/data/osm-walk-nodes.json"), "utf8"));
    expect(seed.boundary).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/korea-boundary-drift.test.ts` → 파일 없음으로 FAIL.

- [ ] **Step 3: 값 변경 없이 분리한다**

일회성 마이그레이션(빌드 스크립트와 같은 직렬화 형식 `JSON.stringify(obj) + "\n"`):

```bash
node -e '
const fs = require("node:fs");
const seedPath = "src/lib/data/osm-walk-nodes.json";
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const boundary = {
  meta: {
    source: seed.meta.source, license: seed.meta.license, licenseUrl: seed.meta.licenseUrl,
    attribution: seed.meta.attribution, osmTimestamp: seed.meta.osmTimestamp,
    points: seed.boundary.reduce((s, r) => s + r.length, 0),
  },
  rings: seed.boundary,
};
const json = JSON.stringify(boundary) + "\n";
fs.writeFileSync("src/lib/data/korea-boundary.json", json);
fs.writeFileSync("ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json", json);
delete seed.boundary;
fs.writeFileSync(seedPath, JSON.stringify(seed) + "\n");
'
```

- [ ] **Step 4: 빌드 스크립트가 다음 재생성에서도 같은 상태를 만들게 한다**

`scripts/build-osm-walk-nodes.mjs`의 `main()`에서 `seed` 객체의 `boundary: rings` 줄을 지우고, seed 기록 뒤에 두 경로로 `korea-boundary.json`을 함께 쓴다. 상단 상수에 출력 경로 둘을 더한다. 주석으로 **"두 산출물은 한 실행이 함께 쓴다 — 링과 노드가 같은 시점의 같은 국경 정의여야 G11이 뜻을 갖는다"**를 남긴다.

- [ ] **Step 5: Package.swift에 리소스 등록**

```swift
resources: [
    .copy("Resources/Localizable.xcstrings"),
    .copy("Resources/korea-boundary.json"),
]
```

- [ ] **Step 6: NOTICE.md 행 추가** — `src/lib/data/korea-boundary.json` / 대한민국 국경(영해 경계) 링 / © OpenStreetMap 기여자 / ODbL 1.0 / `scripts/build-osm-walk-nodes.mjs`. Kit 사본 경로도 같은 행에 병기한다.

- [ ] **Step 7: 통과 확인·커밋**

```bash
npx vitest run src/lib/__tests__/korea-boundary-drift.test.ts
git commit -- src/lib/data/korea-boundary.json ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json src/lib/data/osm-walk-nodes.json scripts/build-osm-walk-nodes.mjs ios/GildongmuKit/Package.swift NOTICE.md src/lib/__tests__/korea-boundary-drift.test.ts
```

---

### Task 2: `isInKorea`를 폴리곤 판정으로 승격한다

**Files:**
- Modify: `src/lib/coverage.ts`
- Create: `src/lib/__tests__/fixtures/korea-boundary-cases.json`
- Create: `src/lib/__tests__/coverage.test.ts`

**Interfaces:**
- Consumes: Task 1의 `korea-boundary.json`.
- Produces: `isInKorea(lat: number, lng: number): boolean` (시그니처 불변). `KOREA_COVERAGE_BBOX`는 **프리필터 전용**으로 남고 export를 유지한다(`scripts/build-crosswalk-seed.mjs`가 같은 값을 자체 복제해 쓰고 있어 이름이 살아 있어야 그 주석이 뜻을 갖는다).

- [ ] **Step 1: 공유 fixture를 만든다**

`src/lib/__tests__/fixtures/korea-boundary-cases.json` — `scripts/build-osm-walk-nodes.mjs`의 `BOUNDARY_GOLDEN` 14점 그대로 + 서귀포 1점:

```json
{
  "cases": [
    { "name": "후쿠오카", "lat": 33.5902, "lng": 130.4017, "inside": false },
    { "name": "기타큐슈", "lat": 33.8835, "lng": 130.8752, "inside": false },
    { "name": "대마도", "lat": 34.2, "lng": 129.29, "inside": false },
    { "name": "시모노세키", "lat": 33.9578, "lng": 130.9414, "inside": false },
    { "name": "개성", "lat": 37.97, "lng": 126.5544, "inside": false },
    { "name": "해주", "lat": 38.04, "lng": 125.715, "inside": false },
    { "name": "파주 문산", "lat": 37.8556, "lng": 126.7869, "inside": true },
    { "name": "강원 고성", "lat": 38.3806, "lng": 128.4678, "inside": true },
    { "name": "정선읍", "lat": 37.3806, "lng": 128.6608, "inside": true },
    { "name": "마라도", "lat": 33.1128, "lng": 126.2683, "inside": true },
    { "name": "서귀포", "lat": 33.2541, "lng": 126.56, "inside": true },
    { "name": "울릉도", "lat": 37.4844, "lng": 130.9057, "inside": true },
    { "name": "독도", "lat": 37.2429, "lng": 131.8664, "inside": true },
    { "name": "백령도", "lat": 37.9658, "lng": 124.71, "inside": true },
    { "name": "가덕도", "lat": 34.98, "lng": 128.82, "inside": true }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/coverage.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isInKorea } from "../coverage";
import seed from "../data/osm-walk-nodes.json";
import cases from "./fixtures/korea-boundary-cases.json";

describe("isInKorea — 국경 폴리곤 판정", () => {
  it("공유 golden 전수를 맞힌다", () => {
    for (const c of cases.cases) {
      expect(isInKorea(c.lat, c.lng), c.name).toBe(c.inside);
    }
  });

  it("사각형 밖 좌표는 여전히 밖이다", () => {
    expect(isInKorea(37.7749, -122.4194)).toBe(false); // 샌프란시스코
  });

  it("OSM seed 노드 79,000여 점 전수가 폴리곤 안이다", () => {
    // 빌드 스크립트의 insideRings와 coverage.ts의 ray casting은 서로 다른 코드다.
    // 이 단언이 두 구현의 합의를 8만 점으로 확인한다(spec §3 방어 2).
    const nodes = (seed as unknown as { nodes: Array<[number, number, number, number]> }).nodes;
    expect(nodes.length).toBeGreaterThan(70_000);
    const stray = nodes.find((n) => !isInKorea(n[1], n[2]));
    expect(stray, stray && `노드 ${stray[0]}(${stray[1]}, ${stray[2]})`).toBeUndefined();
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/lib/__tests__/coverage.test.ts` → 후쿠오카·개성이 `true`라 FAIL.

- [ ] **Step 4: `coverage.ts` 구현**

`KOREA_COVERAGE_BBOX`는 남기되 주석을 **"판정이 아니라 프리필터"**로 고치고, 링을 import해 ray casting을 더한다:

```ts
import boundary from "./data/korea-boundary.json";

const RINGS = (boundary as { rings: Array<Array<[number, number]>> }).rings;

export function isInKorea(lat: number, lng: number): boolean {
  if (lat < KOREA_COVERAGE_BBOX.latMin || lat > KOREA_COVERAGE_BBOX.latMax) return false;
  if (lng < KOREA_COVERAGE_BBOX.lngMin || lng > KOREA_COVERAGE_BBOX.lngMax) return false;

  for (const ring of RINGS) {
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
```

파일 머리 주석에 **왜 사각형이 아닌가**(후쿠오카·개성)와 **번들 대가 실측치**(+53KB raw / 15KB gzip)를 남긴다.

- [ ] **Step 5: 통과 확인·커밋**

```bash
npx vitest run src/lib/__tests__/coverage.test.ts
git commit -- src/lib/coverage.ts src/lib/__tests__/coverage.test.ts src/lib/__tests__/fixtures/korea-boundary-cases.json
```

---

### Task 3: walk provider의 자체 폴리곤을 지운다

**Files:**
- Modify: `src/lib/providers/osm-walk-nodes.ts`
- Modify: `src/lib/providers/__tests__/osm-walk-nodes.test.ts`
- Modify: `src/lib/__tests__/build-osm-walk-nodes.test.ts` (링 출처를 새 파일로)
- Modify: `scripts/build-osm-walk-nodes.mjs` (`BOUNDARY_GOLDEN`을 공유 fixture에서 읽도록)

**Interfaces:**
- Consumes: Task 2의 `isInKorea`.
- Produces: `findWalkFeaturesNear`의 시그니처·반환 계약 불변(제공 지역 밖이면 `null`, 안이면 0건도 `[]`).

- [ ] **Step 1: provider 테스트를 새 술어로 바꾼다** — `isInWalkSeedCoverage` import를 `isInKorea`로 교체하고, 기존 케이스(제공 지역 안 좌표들)를 그대로 둔다. `findWalkFeaturesNear(후쿠오카) === null`을 케이스로 더한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/providers/__tests__/osm-walk-nodes.test.ts` → export 없음으로 FAIL.

- [ ] **Step 3: provider에서 `SEED_BBOX`·`isInWalkSeedCoverage`를 삭제**하고 `findWalkFeaturesNear`가 `isInKorea`를 부르게 한다. `SeedShape`에서 `boundary`를 뺀다. 지운 자리의 ⚠ 주석(사각형을 판정에 쓰면 안 되는 이유)은 **`coverage.ts`로 옮겼으므로 여기서는 한 줄 포인터만** 남긴다.

- [ ] **Step 4: 빌드 가드 테스트의 링 출처 교체** — `src/lib/__tests__/build-osm-walk-nodes.test.ts`가 `seed.boundary` 대신 `korea-boundary.json`의 `rings`를 읽게 한다. G9~G11 케이스는 그대로.

- [ ] **Step 5: `BOUNDARY_GOLDEN`을 공유 fixture에서 읽게 한다** — `scripts/build-osm-walk-nodes.mjs`가 하드코딩 배열 대신 `src/lib/__tests__/fixtures/korea-boundary-cases.json`을 `readFileSync`로 읽어 `BOUNDARY_GOLDEN`으로 export한다(표가 세 곳에서 하나가 된다).

- [ ] **Step 6: 통과 확인·커밋**

```bash
npx vitest run src/lib/providers/__tests__/osm-walk-nodes.test.ts src/lib/__tests__/build-osm-walk-nodes.test.ts
git commit -- src/lib/providers/osm-walk-nodes.ts src/lib/providers/__tests__/osm-walk-nodes.test.ts src/lib/__tests__/build-osm-walk-nodes.test.ts scripts/build-osm-walk-nodes.mjs
```

---

### Task 4: Kit `Coverage.swift` 미러

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Coverage.swift`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/CoverageTests.swift`

**Interfaces:**
- Consumes: Task 1의 Kit 리소스, Task 2의 공유 fixture.
- Produces: `public func isInKorea(lat: Double, lng: Double) -> Bool` (시그니처 불변).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```swift
// CoverageTests.swift에 추가
private struct BoundaryCase: Decodable { let name: String; let lat: Double; let lng: Double; let inside: Bool }
private struct BoundaryCases: Decodable { let cases: [BoundaryCase] }

@Test func 공유_golden_전수를_맞힌다() throws {
    // 웹 src/lib/__tests__/fixtures/korea-boundary-cases.json 공유(CarActionTests 선례).
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/korea-boundary-cases.json")
    let decoded = try JSONDecoder().decode(BoundaryCases.self, from: Data(contentsOf: url))
    #expect(decoded.cases.count >= 15)
    for c in decoded.cases {
        #expect(isInKorea(lat: c.lat, lng: c.lng) == c.inside, "\(c.name)")
    }
}
```

(경로 깊이는 `CarActionTests.swift`의 상승 횟수를 그대로 따른다 — 그 파일을 열어 확인하고 같은 수를 쓴다.)

- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test --filter Coverage` → 후쿠오카·개성 FAIL.

- [ ] **Step 3: `Coverage.swift` 구현**

```swift
import Foundation

/// 대한민국 서비스 커버리지 정본 술어 — 웹 src/lib/coverage.ts 미러.
/// 사각형은 프리필터이고 판정은 국경 링(영해 경계, ODbL/OSM)이 한다.
private let koreaBBox = (latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0)

private let koreaRings: [[(lat: Double, lng: Double)]] = {
    guard let url = Bundle.module.url(forResource: "korea-boundary", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rings = root["rings"] as? [[[Double]]]
    else { return [] }
    return rings.map { $0.compactMap { p in p.count == 2 ? (lat: p[0], lng: p[1]) : nil } }
}()

public func isInKorea(lat: Double, lng: Double) -> Bool {
    guard (koreaBBox.latMin...koreaBBox.latMax).contains(lat),
          (koreaBBox.lngMin...koreaBBox.lngMax).contains(lng) else { return false }
    for ring in koreaRings {
        var inside = false
        var i = 0
        while i < ring.count - 1 {
            let (y1, x1) = (ring[i].lat, ring[i].lng)
            let (y2, x2) = (ring[i + 1].lat, ring[i + 1].lng)
            if (y1 > lat) != (y2 > lat) {
                let xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
                if lng < xAt { inside.toggle() }
            }
            i += 1
        }
        if inside { return true }
    }
    return false
}
```

⚠ 리소스가 없어 `koreaRings`가 비면 **전 좌표가 "밖"이 된다** — 앱이 통째로 죽는 실패이므로 그 상태를 테스트가 잡아야 한다. Step 1의 golden에 `inside: true` 케이스가 9개 있어 빈 링이면 즉시 실패한다.

- [ ] **Step 4: 통과 확인** — `swift test --filter Coverage`.

- [ ] **Step 5: 커밋**

```bash
git commit -- ios/GildongmuKit/Sources/GildongmuKit/Coverage.swift ios/GildongmuKit/Tests/GildongmuKitTests/CoverageTests.swift
```

---

### Task 5: 소비자 확인 + 실호출 게이트 + 문서

**Files:**
- 확인만(변경 없음 예상): `src/lib/chat/router.ts`, `packages/cli/src/lib/api-client.ts`, `packages/mcp/src/index.ts`
- Modify: `CLAUDE.md`(자기 함정 줄), `CHANGELOG.md`, `PROGRESS.md`(상태 한 줄), `docs/BACKLOG.md`(E19 종결 + 조사 표)

- [ ] **Step 1: 소비자 전수 확인**

```bash
grep -rn "isInKorea" src packages ios --include=*.ts --include=*.tsx --include=*.swift | grep -v __tests__
```
`coverageGate`가 `isInKorea`를 그대로 부르는지, CLI/MCP가 서버 마커만 읽는지 확인한다. 자체 좌표 판정이 있으면 그 자리도 승격한다.

- [ ] **Step 2: 전체 게이트**

```bash
npm run test:run && npx tsc --noEmit && npm run lint
cd packages/cli && npx vitest run && cd ../mcp && npx vitest run
```

- [ ] **Step 3: 실호출 게이트(로컬 dev 서버)**

`npm run dev` 뒤 좌표 라우트 표본에 후쿠오카(33.5902/130.4017)와 파주 문산(37.8556/126.7869)을 던져 전자가 `{"outOfCoverage":true}`, 후자가 정상 응답인지 확인하고 결과를 spec §4에 붙인다.

- [ ] **Step 4: 번들 실측 재확인** — `npm run build` 뒤 `du -sh .next/static/chunks`를 기준선(1.3MB)과 대조해 증가분을 spec에 적는다.

- [ ] **Step 5: 문서 분배** — 서사는 `CHANGELOG.md`, 남은 판정(라우트별 0건 문장 표)은 `docs/BACKLOG.md` E19, 새 함정("커버리지 판정은 폴리곤이고 사각형은 프리필터")은 `CLAUDE.md` 횡단 함정의 커버리지 마커 문단, 상태 한 줄은 `PROGRESS.md`.

- [ ] **Step 6: 커밋**

---

## Self-Review

- **spec 커버리지**: D1→T2, D2→T1·T3, D3→T1·T4, D4→T2·T3·T4, D5→T5, §3 방어→T2 Step 2 세 번째 케이스·T4 Step 3 주의, §4 게이트→T1·T2·T4·T5, §5 범위 밖→T5 Step 5.
- **플레이스홀더**: 없음. Swift 경로 상승 횟수만 "CarActionTests를 열어 같은 수를 쓴다"로 남겼다 — 값이 아니라 확인 절차라 의도된 것이다.
- **타입 일관성**: `rings`(웹 JSON 키) ↔ `root["rings"]`(Swift) ↔ `boundary`(구 seed 필드, 제거) 이름이 태스크 간 일치한다. `isInWalkSeedCoverage`는 T3에서 사라지고 이후 어디서도 참조하지 않는다.
