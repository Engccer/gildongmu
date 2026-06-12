# 길동무 (Gildongmu)

**누구나 쓸 수 있는 대한민국 길찾기.** 네이버 계열 API를 연동한 장소 검색·내비게이션 연결 UI로, 시각장애인(스크린 리더)과 한국 방문 외국인을 1급 사용자로 둔 접근성 우선 미니멀 앱이다.

장기적으로 [dodo-planet](https://www.dodoplanet.space)(가족 여행 가이드 PWA)에 통합하는 것이 목표.

## 핵심 설계

- **정보의 정본은 리스트/텍스트 UI** — 지도는 나중에 얹는 시각 보조 레이어 (네이버 지도 캔버스는 스크린 리더 비접근이 확정이므로)
- **도보/대중교통 내비는 `nmap://` 딥링크**로 네이버 지도 앱에 위임 (NCP Directions는 자동차 전용)
- **API 키 없이도 동작** — 키 미설정 시 mock 데이터로 자동 폴백, UI 개발이 키 발급에 막히지 않음
- **ko/en 다국어** (next-intl) — ja/zh는 UI 안정화 후 확장

## 시작하기

```bash
npm install
npm run dev          # localhost:3000 — 키 없이 mock 모드로 바로 동작
npm run test:run     # 단위 테스트
```

실데이터 연동은 `.env.example`을 `.env.local`로 복사한 뒤 키를 채운다. 키 발급 경로와 제약은 `docs/RESEARCH-2026-06-naver-api-ecosystem.md`, 설계 결정은 `docs/SPEC.md` 참고.

## 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · next-intl 4 · zod 4 · Vitest 4
