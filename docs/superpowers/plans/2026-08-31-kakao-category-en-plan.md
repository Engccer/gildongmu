# 카카오 분류 영문화(A28) 구현 계획

spec: `docs/superpowers/specs/2026-08-31-kakao-category-en-design.md`. 병렬 세션 category-en(웨이브 3, worktree `feat/category-en`).

**구현 방식 판정**: inline. 태스크가 한 데이터 파일(사전)을 중심으로 순차 의존한다 — 스윕 결과가 사전을, 사전이 테스트 기대값과 커버리지 게이트를 정한다(코퍼스 → 번역 → 게이트 루프). 수정 파일이 웹·Kit·앱 세 층에 걸치지만 인터페이스(`categoryEn` additive + `pickCategory`)가 첫 태스크에서 고정되므로 위임 이득이 없다. 리뷰는 별도 컨텍스트(코드 리뷰·a11y-auditor)로 분리한다.

## 태스크

1. spec 작성 → codex adversarial-review(설계 리뷰 게이트, 새 외부 계약 첫 정의) → 판정 반영(§10). ✅
2. 코퍼스 스윕 `scripts/build-kakao-category-en.mjs`(호출 상한·재시도·`--from-corpus`) → 사전 `src/lib/data/kakao-category-en.json` 직접 작성 → 코퍼스 커버리지 97.7%. ✅
3. 순수 계층 `src/lib/kakao-category.ts`(`kakaoCategoryEn`·`categoryEnField`·`pickCategory`) + 공유 fixture + `kakao-category.test.ts`. ✅
4. 서버 투영: `types.ts`·`kakao-local.ts`·`kids-places.ts`·`surroundings.ts`·`surroundings-scene.ts`(소유권 밖)·`nearby-place.ts` + `kakao-category-projection.test.ts`(판정 불변·소스 가드 포함). ✅
5. 웹 표시: `PlaceCard.tsx`·`PlaceDetail.tsx` + 컴포넌트 테스트(en/en-부재/ko). `AroundNearby`·`KidsPlacesNearby`는 원문 분류를 그리지 않아 무변경. ✅
6. iOS: Kit 모델 4종(소유권 밖 3파일 additive)·`PlaceProjection.swift`·`KakaoCategory.swift`·`KakaoCategoryTests.swift`, 앱 `SearchView.swift`(PlaceRow 분류 조각만)·`PlaceDetailView.swift`·`AroundNearbyView.swift`. `KidsNearbyView`는 원문 분류를 그리지 않아 무변경. ✅
7. 실호출 게이트 `scripts/verify-kakao-category-en.mjs`(4투영 경로·7지역) → 96.8% PASS. ✅
8. 게이트: `npm run test:run`·`tsc`·`lint`·Kit `swift test`(646)·iOS 시뮬 빌드. 변이 주입(가드 제거 → 3건 검출). ✅
9. 리뷰(별도 컨텍스트): 코드 리뷰(spec-compliance + 정확성) + a11y-auditor → 반영.
10. 분배: CHANGELOG·BACKLOG(A28 종결, E28 후속 "분류 영문화" 종결)·CLAUDE.md 함정·AGENTS.md 재생성 → 통합(rebase → 생성물 재생성 → 게이트 → ff push) → 코디네이터 보고 → worktree 제거.
