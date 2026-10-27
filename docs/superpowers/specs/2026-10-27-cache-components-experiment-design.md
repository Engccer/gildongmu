# D35 Cache Components 실험 — 설계·구현·실측

- 날짜: 2026-10-27 (클라우드 세션, 실험 브랜치 `claude/d35-cache-components`)
- 기준: `392c82e`(브랜치 `claude/backlog-d37-d32-d38`) · Next.js 16.4.3
- 위원장 요청: "큰 이득은 없을 것 같지만 실험적으로 해 보고 싶다. 득실을 실측할 방법은?"

## 1. 무엇을 바꾸나

Cache Components는 **웹 서버(Next.js)만** 바꾼다. iOS·안드로이드 앱은 같은 API 라우트를 부르지만
응답 본문·헤더 계약은 그대로라 앱 코드는 바뀌지 않는다(앱이 체감할 수 있는 축은 §3 ②의 upstream 캐시뿐이고,
그것이 불변임을 실측했다).

| 변경 | 자리 | 이유 |
|---|---|---|
| `cacheComponents: true`, `partialPrefetching: true` | `next.config.ts` | 켜는 스위치. `partialPrefetching`을 비워 두면 경고가 나고, 가이드는 새로 켜는 앱에 둘 다 켜기를 권한다 |
| `export const dynamic = "force-dynamic"` 18곳 삭제 | `src/app/api/**/route.ts` | Cache Components와 비호환(빌드 오류). 변경 라우트들은 요청 정보(쿼리·본문·헤더)를 읽어 원래 요청 시 실행이다 |
| `export const revalidate = 86_400` 삭제 | `src/app/api/station/meta/route.ts` | 같은 이유. 이 라우트는 쿼리를 읽어 종전에도 동적(ƒ)이라 값이 효력이 없었다 |
| 프리렌더 중 `Date.now()` 회피 | `src/hooks/useClockWhile.ts` | 빌드가 막는 유일한 자리였다. 서버엔 측위가 없어 그 값이 화면에 쓰이지 않는다 |
| `force-dynamic` 언급 문서 6곳 | `CLAUDE.md`·`docs/INTEGRATIONS.md`·주석 | "라우트에 `use cache`를 두지 않는다"로 바꿔 적었다 |

종전 D35 기록은 "`Date.now()`·`new Date()`·`Math.random()` 쓰는 클라이언트 파일 8개"를 걱정했지만,
렌더 중에 시계를 읽는 곳은 하나뿐이었다(나머지는 effect·핸들러 안).

**하지 않은 것**: `unstable_cache` → `use cache` 이전(가이드: 선택, 기존 것이 계속 동작) · `use cache`
신규 도입 · provider `fetch` 옵션 변경. ⚠ `use cache`의 기본 저장소는 인스턴스 메모리라 배포·인스턴스를
넘지 못한다(가이드 §fetch cache options). 지금의 `fetch` 데이터 캐시·`unstable_cache`는 넘는다. 쿼터를
지키는 캐시를 `use cache`로 옮기면 ODsay 비용·서울 열린데이터 일 1,000회가 바로 회귀한다. **옮기지 않는다.**

## 2. 측정 방법 (`scripts/cache-components-measure/`)

```bash
# 두 디렉터리 모두 `next build`가 끝난 저장소여야 한다(기준은 git worktree + npm ci — 심볼릭 node_modules는 Turbopack이 거부)
node scripts/cache-components-measure/measure.mjs --baseline <기준> --candidate <후보> --runs 15 --out result.json
npm run test:a11y   # 후보 트리에서(게이트가 직접 빌드한다)
```

- **실호출 0**: 서버는 `playwright.config.ts`와 같은 더미 키 17개 + `upstream-stub.mjs`(전역 fetch 대역,
  Next가 감싸기 전에 얹힌다 → 대역까지 내려온 수 = 실제 upstream 호출 수). 브라우저는 localhost 밖을 끊고
  `/api/**`를 502로 받는다.
- ① **첫 화면**: `/ko`·`/en`·`/ko/about`을 매 회 새 컨텍스트(빈 캐시)로 15회, 중앙값 TTFB·FCP·LCP·DCL·load,
  HTML 바이트, 전송 바이트. 첫 낭독 순서 대리 지표로 헤딩·랜드마크 앞 12개를 두 빌드에서 대조.
- ② **upstream 캐시**: 같은 요청 5회. 카카오 장소(`next.revalidate: 300`) 기대 1회 — 늘면 비용·쿼터 회귀.
  지하철 도착(`no-store`) 기대 5회 — 줄면 낡은 도착 정보 회귀. 검색어는 실행마다 새 꼬리(디스크 캐시가
  앞 실행 응답을 300초 안에 재사용해 0회로 나온 실측이 있어서).
- ③ 빌드 라우트 표 · 정적 JS 총량 · 실브라우저 접근성 게이트.

**범위 밖(한계)**: 실데이터가 채워진 화면 · Vercel 실배포(엣지·서버리스 콜드스타트) · `unstable_cache`
경로(문화행사·혼잡도·juso 도로명 — 대역이 그 봉투를 흉내 내지 않아 0회 vs 1회를 가를 수 없다. 가이드는
"변경 불필요"라고 한다) · 화면 간 이동(앱은 History API 뷰 전환이라 라우트 이동이 드물다).

## 3. 결과 (2026-10-27, 컨테이너 Chromium · `next start` · 15회 중앙값)

| 화면 | 지표 | 기준 | 후보 |
|---|---|---|---|
| `/ko` | TTFB / FCP / load (ms) | 12.7 / 148 / 205 | 13.7 / 156 / 210 |
| `/en` | TTFB / FCP / load (ms) | 12.7 / 116 / 177 | 13.4 / 112 / 182 |
| `/ko/about` | TTFB / FCP / load (ms) | 12.7 / 152 / 194 | 12.2 / 140 / 189 |
| `/ko` | HTML / 전송 (B) | 21,607 / 253,570 | 22,094 / 236,905 |
| 전체 | 정적 JS (B) | 1,281,356 | 1,282,846 (+1.5KB) |

- ① 첫 화면: **차이 없음.** 화면별 ±10ms 안에서 방향이 엇갈린다(측정 잡음 수준). HTML은 약 +400B
  (Partial Prefetching 메타). 헤딩·랜드마크 순서는 세 화면 모두 같다.
- ② upstream 캐시: 두 빌드 모두 카카오 **1/1**. 지하철 도착 **5/5**는 HTTP 503 대역의 호출 횟수이며, 정상 응답의 실시간성 검증은 §6 재측정 결과를 따른다.
- ③ 라우트 표: 기준도 이미 화면 4종 × 6개 언어가 전부 정적(●)이고 후보도 정적(○, 일반 경로 틀만 ◐)이다.
  API 41개는 둘 다 요청 시 실행(ƒ). 접근성 게이트 9/9 통과.

**해석**: Cache Components의 대표 이득(동적 화면의 정적 뼈대)은 길동무에 해당하지 않는다. 화면은 이미
정적이고 데이터는 전부 클라이언트가 API로 가져온다. 대신 잃는 것도 측정 범위 안에선 없었다.

## 4. 판정할 것

- ⓐ **머지한다**: 이득은 없지만 다음 메이저에서 Cache Components·Partial Prefetching이 기본이 되고 옛 설정이
  사라진다(16.4.3 빌드 경고 원문). 지금 옮기면 그때 할 일이 없다. 대가는 "라우트에 `use cache` 금지"라는
  규칙 하나와 Vercel 실배포 확인(§5).
- ⓑ **버리고 다음 메이저 때 한다**: 지금 득이 0이니 바꾸지 않는다. 이 문서와 측정 도구가 그때 재료다.

▶ **위원장 판정 2026-10-27: ⓐ 머지한다.**

## 5. 남은 확인

운영 웹 첫 화면을 VoiceOver로 열어 첫 낭독과 탐색 순서를 확인한다(BACKLOG §2 D35).
Chrome 접근성 트리와 자동 접근성 검사는 실제 낭독 판정을 대신하지 않는다.

## 6. 로컬 통합·운영 검증 (2026-10-27)

기준 `60858224`, 통합 `886f7ee9`. D32·D33·D35·D37·D38의 원격 커밋과 의존성 PR #3·설정 PR #10을
통합했다. 두 PR은 GitHub에서 merged, 동일 수정 버전을 포함한 보안 PR #4~#9는 closed이며 열린 PR은 0개다.

### 로컬 검증

- 프로덕션 빌드 성공, lint 오류 0·기존 경고 6.
- 웹 테스트 5,826 통과·7 skip, CLI 250 통과, MCP 12 통과, 브라우저 접근성 9/9 통과.
- 공개 저장소 프라이버시 가드 통과. 별도 컨텍스트 코드 리뷰·의존성 리뷰 통과.
- 초기 지하철 대역은 HTTP 503이라 캐시 회귀가 있어도 호출 5회를 기록할 수 있었다.
  `0f143aa3`에서 HTTP 200·INFO-000 정상 봉투로 바꾸고, 호출마다 다른 도착 문장을 반환하도록 고쳤다.
  판정은 HTTP 200, 파싱값 존재, 고유값 수, upstream 호출 수를 모두 검사한다.
- 동일 더미 키로 빌드한 기준·통합 후보를 각각 실행해 재측정했다(페이지별 5회).
  두 빌드 모두 장소 요청 5회에 카카오 1회·같은 장소 값 5개, 지하철 요청 5회에 upstream 5회·서로 다른 문장 5개,
  응답은 모두 HTTP 200이었다. 세 화면의 헤딩·랜드마크 순서도 같다.
  후보에는 의존성 갱신이 함께 들어 있으므로 이 재측정의 성능 차이는 D35 단독 효과로 해석하지 않는다.
- 테스트용 Chromium 미설치로 브라우저 실행이 실패한 뒤, 각 Playwright 버전의 Chromium을 설치해 재검사했다.
  문서 동기화 도구는 Python 3.9의 `Path.write_text(newline=...)` 미지원으로 실패해 Python 3.12로 실행했다.
- npm audit: critical·high 0, moderate 2(@tailwindcss/typography·postcss-selector-parser).
  GitHub 재평가 뒤에는 postcss-selector-parser medium 알림 1건만 남았다. 자동 강제 수정은 적용하지 않았다.

### 운영 검증

- Vercel 배포 `dpl_DXmXWavstzXWCVtk2YdzckqpM2rw`가 READY, production이고 커밋은 `886f7ee9`다.
- `/ko`·`/en` HTTP 200, `X-Vercel-Cache: PRERENDER`. Chrome에서 첫 화면 제목·검색·길찾기·내 주변 순서 유지,
  콘솔 오류·경고 0. 실제 VoiceOver 낭독은 미확인이다.
- `/api/places`에 동일한 공공 장소 질의를 두 번 보내 모두 HTTP 200·17개 장소·동일 응답을 받았다.
  19:59:28~19:59:30 KST의 Vercel Observability External APIs에서 dapi.kakao.com은 API Calls 1,
  Cached Calls 1이었다. 해당 두 요청의 런타임 로그도 이 배포의 HTTP 200으로 확인했다.
  응답의 `X-Vercel-Cache: MISS`는 라우트 응답 캐시이므로 provider 데이터 캐시 판정에 쓰지 않았다.
- 광화문 지하철 도착을 두 번 조회해 모두 HTTP 200·MISS, 도착 문장과 `receivedAt`이 바뀌는 것을 확인했다.
  외부 호출은 이 공개 웹 API 검사만 사용했고 ODsay·유료 LLM 호출은 하지 않았다.

문서 점검은 이번 통합 범위에 한정했다. D33 mock 폴백, D37 제거된 인자, D35 역 메타 캐시 서술을 정정하고,
완료된 병합 지시는 BACKLOG에서 제거했다. D35 코드 작업의 행선지는 종결 표, 남은 실제 첫 낭독은 §2 행이다.
