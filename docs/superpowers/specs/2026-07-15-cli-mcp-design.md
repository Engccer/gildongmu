# gildongmu CLI + MCP 서버 설계 (2026-07-15)

> dodo-planet의 CLI/MCP 절차(Round 118~119, 0.1.6 Trusted Publishing 정착)를 gildongmu에 이식한다.
> 위원장 확정(2026-07-15): 무스코프 패키지 `gildongmu`(별칭 `gil`), STT 제외 전체 명령 표면, MCP 서버 동시 제작.

## 1. 목표·비목표

**목표**
- 터미널에서 gildongmu 전 기능(검색·내 주변·역 정보·실시간 도착·경로 브리핑·날씨/공기질·정위·웹검색·채팅)을 사용하는 `gildongmu`/`gil` CLI를 npm에 배포한다.
- 같은 기능을 Claude Code·Cursor 등 MCP 호스트에 노출하는 `gildongmu-mcp` stdio 서버를 함께 배포한다.
- 릴리스는 dodo 동형: `cli-v*` 태그 push → GitHub Actions → npm 자동 발행(Trusted Publishing OIDC).

**비목표**
- 서버(Next.js) 코드 변경 없음 — 기존 공개 REST 라우트가 그대로 진실의 원천.
- STT(음성 입력) 미탑재(터미널엔 키보드가 있어 잉여).
- 인증 계층 없음 — gildongmu API는 전부 공개·무인증(dodo PAT 계층은 이식하지 않는다).
- 지도·시각 레이어 없음(웹에서도 보조 레이어).

## 2. 아키텍처: 씬 클라이언트 + 공유 엔드포인트 카탈로그

```
gildongmu CLI / MCP ──HTTPS──▶ https://gildongmu.vercel.app/api/*  (프로덕션 REST)
```

- 시크릿은 계속 서버에만 존재. CLI/MCP는 키를 전혀 다루지 않는다.
- base URL은 기본 프로덕션, `GILDONGMU_API_URL` env 또는 `config set apiUrl`로 override(로컬 dev 서버 대상 테스트용).
- **엔드포인트 카탈로그**(`endpoint-catalog-shared.ts`): 항목당 `{ name, method, path, params(zod), 설명, 3-state 유형 }`. packages/cli와 packages/mcp에 byte-mirror로 두고 drift 테스트(파일 해시 비교)로 동기 강제 — dodo `function-catalog-shared.ts` 동형.
- CLI 명령과 MCP 도구는 이 카탈로그에서 생성한다. 신규 라우트 추가 시 카탈로그 1곳 + 미러 복사만.

## 3. 패키지 구조

```
package.json               # "workspaces": ["packages/*"] 추가 (루트는 private 유지)
packages/cli/              # npm "gildongmu"  bin: gildongmu, gil
  bin/gildongmu.mjs
  src/index.ts             # citty 메인
  src/commands/*.ts
  src/lib/{api-client,endpoint-catalog-shared,geocode-resolve,output,config,exit-codes}.ts
packages/mcp/              # npm "gildongmu-mcp"
  src/index.ts             # @modelcontextprotocol/sdk stdio 서버
  src/endpoint-catalog-shared.ts   # byte-mirror
.github/workflows/cli-publish.yml
```

- 스택: citty + tsup + vitest + picocolors (dodo 동일 계열). **ora(스피너)·cli-table3(표)는 의도적으로 제외** — §6 접근성 출력 규약.
- Node >= 20, ESM(`type: "module"`), license MIT, repository/homepage/bugs 메타데이터(dodo Round 119 교훈: 첫 발행 전에 채운다).
- 루트 npm workspaces 전환은 Next 빌드에 영향 없음(dodo 선례). 단 전환 후 `npm run build`·`test:run` 그린을 게이트로 확인.

## 4. 명령 트리 (라우트 계약은 route.ts 정본에서 추출·확정)

| 명령 | 라우트 | 인자 → 파라미터 |
|---|---|---|
| `gil search <질의>` | `/api/places` + `/api/address/search` 병렬, 둘 다 0건이면 `/api/search/web` 폴백, ko면 `/api/places/attractions` 병렬 | `query`, 위치 있으면 `lat`/`lng`(웹 UI의 3+1섹션 결정론 병렬 동형) |
| `gil web <질의>` | `/api/search/web` | `query` |
| `gil nearby subway\|bus\|bike\|clinic\|kids\|around\|barrier-free` | `/api/station/subway-arrival/nearby`, `/api/bus/nearby`, `/api/bike/nearby`, `/api/clinic/nearby`, `/api/places/kids`, `/api/places/around`, `/api/places/barrier-free` | 공통 `lat`/`lng`(§5 위치 해석) |
| `gil station info <역명>` | `/api/station/meta` + `/api/station/facilities` + `/api/station/metro-facilities` 병렬(allSettled) | `station` |
| `gil station arrivals <역명>` | `/api/station/subway-arrival` | `station` |
| `gil bus route --source tago\|seoul --route-id <id> [--city-code <code>]` | `/api/bus/route` | `nearby bus` JSON 출력의 ID를 이어서 사용 |
| `gil route car\|transit <출발> <도착>` | `/api/route/car`, `/api/route/transit` | 출발·도착은 장소명/주소 → §5 지오코딩 → `"위도,경도"` 문자열. 좌표 직접 입력(`37.5,127.1`)도 그대로 수용 |
| `gil weather` / `gil air` | `/api/weather/nearby`, `/api/air-quality/nearby` | `lat`/`lng` |
| `gil whereami` | `/api/where-am-i` | `lat`/`lng` |
| `gil place barrier-free <contentId>` | `/api/places/barrier-free/detail` | `contentId`(barrier-free 목록 출력에서 이어짐) |
| `gil chat [질문]` | `/api/chat` POST NDJSON | 인자 있으면 단발, 없으면 REPL(node:readline). `--near` 좌표를 `userLocation`으로 전달. `placeContext`는 V1 제외 |
| `gil config get\|set\|path` | — | `apiUrl`, `location`(기본 위치), `output` |
| `gil completion bash\|zsh\|fish` | — | dodo 동형 자동완성 스크립트 |

- 언어: `--lang en`(또는 `GILDONGMU_LANG`)이면 라우트가 지원하는 곳에 `lang=en` 전달(places·attractions·route car). 기본 ko.
- dodo의 `raw` escape hatch는 미탑재 — 공개 REST라 curl로 대체 가능(잉여).

## 5. 위치 해석 (GPS 없는 터미널의 정본 규칙)

우선순위: **① `--lat`/`--lng` 직접 → ② `--near "<장소|주소>"` → ③ config `location`**. 셋 다 없고 위치 필수 명령이면 exit 2 + "위치를 지정하세요: --near '길동역' 또는 gil config set location '길동'" 안내.

- `--near`·config location은 `/api/geocode?query=`로 좌표 해석(첫 결과). 해석 실패는 명확한 오류 문장(3-state: 0건 ≠ 실패).
- `config set location <장소>`는 저장 시점에 지오코딩해 `{label, lat, lng}`로 좌표까지 저장(매 호출 지오코딩 방지). config 파일: `~/.config/gildongmu/config.json`.
- `search`·`chat`은 위치가 없어도 동작(위치는 선택 컨텍스트).

## 6. 출력 규약 (접근성 정본 — dodo에서 의도적으로 벗어나는 지점)

- **항목당 한 줄 완성 산문, 구분자는 쉼표** — 웹의 `joinText` 규약(한 줄=한 객체)을 터미널로 이식. 표(cli-table3)는 스크린 리더 낭독에 부적합해 금지.
- **스피너·진행 애니메이션 금지**(ora 미사용) — SR 잡음. 조용히 대기 후 결과만 출력. 챗 스트림만 텍스트 도착분을 순서대로 출력.
- **3-state 불변식 유지**: "0건"("주변에 정류소가 없습니다") ≠ "정보 없음"(unknown 필드는 문장에서 생략) ≠ "조회 실패"(오류 문장 + exit 1). 포매터가 이를 절대 뭉개지 않는다 — 라우트별 3-state 유형을 카탈로그에 명시.
- stdout이 TTY가 아니면 JSON 자동, `--output json|text`로 강제, `config set output`으로 영구 기본값. `NO_COLOR` 존중(색은 장식으로만 — 정보를 색에만 싣지 않는다).
- exit code: 0 정상 / 1 일반·upstream 오류 / 2 잘못된 인자 / 7 네트워크(dodo exit-codes 축소판. 인증 코드는 불필요).

## 7. 채팅 (NDJSON 클라이언트)

- `/api/chat`에 `{messages, userLocation?, locale}` POST → NDJSON 이벤트 스트림 소비. text 이벤트는 즉시 출력, 진행(status) 이벤트는 텍스트 모드에서 생략(잡음), sources는 답변 끝에 "출처:" 줄로.
- REPL은 node:readline — 히스토리는 세션 내 메모리만(파일 저장 안 함, 미니멀). 종료는 Ctrl+D 또는 `/exit`.
- 마크다운 답변은 터미널 평문으로 경량 정리(헤딩·볼드 기호 제거 수준, 의존성 추가 없음).

## 8. MCP 서버 (`gildongmu-mcp`)

- stdio 전송, `@modelcontextprotocol/sdk` + zod. 카탈로그의 **결정론 도구만** 노출 — `chat`·`web`(LLM/검색 판단은 호스트 몫) 제외한 전 항목, 모두 `readOnlyHint: true`(쓰기 도구가 없다).
- 도구 입력 스키마는 카탈로그에서 생성. 위치 인자는 `lat`/`lng` 필수 노출(MCP 호스트가 좌표를 넘긴다). 장소명→좌표 해석은 별도 도구(`geocode`·`places_search`) 체이닝으로 호스트 LLM이 수행한다 — 도구별 `near` 파라미터는 MCP 서버에 지오코딩 로직을 복제하게 되어 넣지 않는다(구현 확정 2026-07-15, 최종 리뷰 반영).
- 설치: `claude mcp add gildongmu -- npx -y gildongmu-mcp`(무인증이라 env 불필요 — README에 기재).

## 9. 테스트·게이트

- vitest: 카탈로그 drift(두 미러 해시 일치 + 명령 트리 == 카탈로그 항목), 포매터 fixture 단위테스트(3-state 케이스 필수), 위치 해석 우선순위, exit code 매핑.
- **머지 게이트는 실호출**: 프로덕션 API 대상 CLI 실왕복(search·nearby subway·route transit·chat 단발 최소 4종) — fixture green ≠ 실계약(repo 원칙).
- 루트 워크스페이스 전환 후 `npm run build`·`npm run test:run`(기존 웹) 그린 확인.

## 10. 배포 파이프라인

- `.github/workflows/cli-publish.yml` — dodo 동형: PR(paths: packages/**)에서 build+test+`pack --dry-run`, `cli-v*` 태그에서 두 패키지 publish(`npx -y npm@latest publish --access public`, OIDC). **`--provenance` 금지**(private repo — dodo Round 119 실측: 404로 위장된 422).
- **부트스트랩(1회)**: npmjs.com에서 신규 패키지 Trusted Publisher 사전 설정을 먼저 시도 → 지원되지 않으면 dodo Round 119 경로(granular token 발급 → `gh secret set NPM_TOKEN` → 첫 발행 → 토큰 즉시 폐기 → Trusted Publisher 전환). **위원장 개입은 npmjs.com 로그인/OTP 시점뿐.**
- 버전 0.1.0 시작, 두 패키지 버전 동조. 릴리스 절차를 CLAUDE.md에 항구 규칙으로 추가, PROGRESS.md에 검증 로그.

## 11. 후속(비범위)

- dodo처럼 서버 declarations와의 자동 동기(현재는 REST가 정본이라 해당 없음), `placeContext` 채팅, Bun 단일 바이너리, repo public 전환 시 provenance 재활성화.
