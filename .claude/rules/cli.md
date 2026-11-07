---
paths:
  - "packages/**"
  - ".github/workflows/**"
---

# CLI/MCP 릴리스 규칙

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

## CLI/MCP 릴리스 (`packages/cli`=npm `gildongmu`, `packages/mcp`=npm `gildongmu-mcp`)

- 발행은 `cli-v*` 태그 push → `.github/workflows/cli-publish.yml`이 두 패키지를 npm Trusted Publishing(OIDC)으로 자동 발행. 토큰·환경변수 불필요.
- 릴리스 절차: **버전 4곳 + CHANGELOG 2곳 + 루트 lock 동조 갱신**(lock은 가드 밖) → 커밋 → `git tag cli-v<버전> && git push origin main --tags`. index.ts 버전은 하드코딩 — `version-drift.test.ts`가 강제. → PATTERNS
- ⚠ **CHANGELOG는 `files`에 적어야 tarball에 들어간다**(확인은 `npm pack --dry-run`). → PATTERNS
- **`--provenance`는 켜 둔다**(비공개로 돌리면 먼저 뺀다). 카탈로그(`endpoint-catalog-shared.ts`)는 cli·mcp 両미러 동일. → PATTERNS
- **카탈로그에 항목을 더하면 `FORMATTERS`(cli `lib/formatters.ts`)에도 등록한다** — 빠뜨리면 text 모드에서만 통짜 JSON이 나온다(`formatter-coverage.test.ts`). → PATTERNS
- **`lang` 같은 선택 파라미터는 카탈로그가 정본이고 인자 선언·전달 판정이 같은 술어(`catalogSupportsLang`)를 쓴다**(E26). `runEndpoint`의 `lang`은 필수 인자, `langArgs`는 받는 명령에만, `allSettled` 묶음은 400을 즉시 종료로. 포매터 라벨은 한국어 고정. → PATTERNS
