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
| `export const dynamic = "force-dynamic"` 18곳 삭제 | `src/app/api/**/route.ts` | Cache Components와 비호환(빌드 오류). 19곳 모두 `request.nextUrl.searchParams`를 읽어 원래 요청 시 실행이다 |
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
- ② upstream 캐시: 두 빌드 모두 카카오 **1/1**, 지하철 도착 **5/5**. 캐시 수명도 실시간성도 그대로다.
- ③ 라우트 표: 기준도 이미 화면 4종 × 6개 언어가 전부 정적(●)이고 후보도 정적(○, 일반 경로 틀만 ◐)이다.
  API 41개는 둘 다 요청 시 실행(ƒ). 접근성 게이트 9/9 통과.

**해석**: Cache Components의 대표 이득(동적 화면의 정적 뼈대)은 길동무에 해당하지 않는다. 화면은 이미
정적이고 데이터는 전부 클라이언트가 API로 가져온다. 대신 잃는 것도 측정 범위 안에선 없었다.

## 4. 판정할 것

- ⓐ **머지한다**: 이득은 없지만 다음 메이저에서 Cache Components·Partial Prefetching이 기본이 되고 옛 설정이
  사라진다(16.4.3 빌드 경고 원문). 지금 옮기면 그때 할 일이 없다. 대가는 "라우트에 `use cache` 금지"라는
  규칙 하나와 Vercel 실배포 확인(§5).
- ⓑ **버리고 다음 메이저 때 한다**: 지금 득이 0이니 바꾸지 않는다. 이 문서와 측정 도구가 그때 재료다.

## 5. 다음 세션이 할 일

- 판정 ⓐ면: 로컬 Mac에서 `public-repo-privacy-guard` 실행 → main 머지(자동 배포) → 배포 직후 실서버에서
  ① `/ko` 첫 화면·스크린 리더 첫 낭독 ② `/api/places` 같은 요청 두 번(Vercel Observability로 카카오 호출 1회)
  ③ 지하철 도착이 매번 새 값인지 확인. 문제가 있으면 되돌린다(`git revert` 한 번).
- 판정 ⓑ면: 브랜치를 지우고 BACKLOG D35를 "다음 메이저(Next 17) 편승"으로 고친다. 측정 도구는 main에 남겨도 된다.
