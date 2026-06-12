# 길동무 (Gildongmu)

**국내 서비스 연동 실험실.** 네이버·카카오 등 대한민국 로컬 서비스 API(지도, 내비게이션, 장소, 예약 등)를 발굴해 접근성 우선 미니멀 UI로 실험하는 프로젝트다. 시각장애인(스크린 리더)과 한국 방문 외국인을 1급 사용자로 둔다.

검증된 기능은 [dodo-planet](https://www.dodoplanet.space)(가족 여행 가이드 PWA)에 통합하는 것이 최종 목표 — 이 저장소는 그 전 단계의 인큐베이터다.

## 핵심 설계

- **정보의 정본은 리스트/텍스트 UI** — 지도는 나중에 얹는 시각 보조 레이어 (네이버·카카오 지도 캔버스는 스크린 리더 비접근)
- **내비게이션은 딥링크로 네이티브 앱에 위임** — `nmap://`(네이버지도), `kakaomap://`(카카오맵)
- **Provider 추상화 + 키 없이도 동작** — 키 미설정 시 mock 자동 폴백. 장소 검색은 카카오 로컬(15건) > 네이버 지역(5건) > mock 순 자동 선택, `PLACES_PROVIDER`로 강제 지정해 A/B 비교 가능
- **ko/en 다국어** (next-intl)

## 시작하기

```bash
npm install
npm run dev          # localhost:3000 — 키 없이 mock 모드로 바로 동작
npm run test:run     # 단위 테스트
```

실데이터 연동은 `.env.example`을 `.env.local`로 복사한 뒤 키를 채운다.

## 문서

| 문서 | 내용 |
|------|------|
| `docs/SPEC.md` | 설계 결정, 성과 지표, dodo-planet 통합 경로 |
| `docs/RESEARCH-2026-06-naver-api-ecosystem.md` | 네이버/NCP 생태계 조사 (2025 개편, 쿼터, 딥링크) |
| `docs/RESEARCH-2026-06-kakao-api-ecosystem.md` | 카카오 생태계 조사 (로컬, 모빌리티, 딥링크, 메시지) |

## 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · next-intl 4 · zod 4 · Vitest 4
