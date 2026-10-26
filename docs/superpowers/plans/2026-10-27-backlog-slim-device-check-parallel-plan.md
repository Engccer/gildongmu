# 백로그 감량 + 미러링 실기기 점검 병렬 세션 계획

기준 SHA: 이 문서 커밋(`git log -1 -- <이 파일>`) · 코디네이터: `gildongmu-8f [a28767]` · 세션 2개(`backlog-slim`, `device-check-2`) · 웨이브 1개

## §1 마일스톤·확정 판정·모델 배정

### backlog-slim: 코드가 끝난 항목의 본문을 BACKLOG에서 뺀다

위원장 판정(2026-10-27, 코디네이터 세션): 코드는 끝났고 실사용·실기기·실보행·실승차 판정만 남은 열린 항목은 본문을 지우고, 판정은 §2 표 행 하나로만 남긴다.

1. 대상: §1~§8의 체크박스 항목 가운데 머리에 "코드 종결"(또는 같은 뜻의 "구현 종결"·"✅ 종결")이 있고 남은 것이 판정뿐인 항목. 남은 코드 일(축 일부 미구현, 후속 후보)이 있으면 대상이 아니다. 일부 축만 끝난 항목은 끝난 축의 서술만 줄이고 항목은 남긴다.
2. 지우기 전에 본문에서 **다른 곳에 없는 내용**을 옮긴다. 판정 기준·축 → §2 행(spec이 있으면 spec을 가리킨다), 재발 방지 규칙·함정 → `docs/PATTERNS.md`/`docs/INTEGRATIONS.md` 같은 제목 절(CLAUDE.md는 고치지 않고 보고의 반영 요청으로), 경위·서사 → CHANGELOG에 그날 항목이 없을 때만 추가. "다른 곳에 있다"는 grep으로 확인한 경우에만 인정한다.
3. 지운 항목은 `## 종결된 식별자` 표에 한 줄(무엇이었나 · 코드 종결 날짜·세션 · 판정 행 위치). 그 판정 행이 §2에 없으면 먼저 §2에 만든다.
4. `## 종결된 식별자` 머리의 "§2에 열린 판정 행이 있는 항목은 본문도 함께 남는다" 규칙을 새 규칙으로 바꾼다: 코드가 끝나면 본문을 지우고 판정은 §2 행 하나로 남는다.
5. 앞 세션 미결 5건(보고 `~/gildongmu-wt/backlog-format-reports/done-202610270330.md` 끝)도 이 세션이 처리한다. A56 재발 방지 두 문장은 `docs/PATTERNS.md` 공개 저장소 규율 절로 옮기고 A56을 닫는다. E48 ②③·E16 잔여·§8 식별자 없는 불릿·"다음에 할 일 3" 중복은 2번 규칙대로 정리한다(식별자를 새로 줄 때는 BACKLOG에서 안 쓰인 다음 번호, `## 종결된 식별자`까지 확인).
6. 착수 순서 표는 마지막에 다시 맞춘다.

### device-check-2: 아이폰 미러링으로 닫을 수 있는 실기기 판정을 닫는다

위원장 지시(2026-10-27): "실기기 판정 중 아이폰 미러링으로 닫을 수 있는 건 닫자." 2026-10-04 같은 점검은 0행을 닫았다(미러링은 화면 영상만, 낭독·초점·소리 관측 불가. 분류 `~/gildongmu-wt/device-check-reports/classification.md`). 그 뒤 생긴 §2 행과 FIELD-TEST 행이 주 대상이고, 10-04 "부분 관측" 행은 남은 축이 화면 술어인 것만 다시 본다.

코디네이터가 착수 전에 main(`d2fd0ca4`, iOS 최종 변경 `4649c02e`)으로 공식판·실험판을 둘 다 설치한다.

### 모델·노력

| 일 | 주체 | 모델·노력 |
|---|---|---|
| backlog-slim 본체 | 세션 | `opus[1m]` · medium |
| 항목별 증거 수집(CHANGELOG 그날 항목·§2 행·FIELD-TEST 행·spec 존재) | 절별 서브에이전트 | `model: sonnet` · medium |
| 지울 본문의 "다른 곳에 없는 내용" 감사 | 서브에이전트 | `model: opus` · medium |
| backlog-slim 최종 리뷰 | 서브에이전트 | `model: opus` · medium |
| device-check-2 본체 | 세션 | `sonnet` · medium (실기기 점검 세션 규칙: 판정표가 행별로 있다) |

## §2 파일 소유권

- backlog-slim: `docs/BACKLOG.md`, `CHANGELOG.md`, `docs/PATTERNS.md`, `docs/INTEGRATIONS.md`, BACKLOG 링크 조각을 가진 다른 문서의 그 링크 줄.
- device-check-2: `docs/FIELD-TEST.md`만(미러링 관측 덧붙임, 닫은 행 삭제). BACKLOG·CHANGELOG는 고치지 않고, 닫을 §2 행 목록과 증거를 완료 보고에 적는다. 코디네이터가 backlog-slim 통합 뒤 그 목록을 BACKLOG·CHANGELOG에 반영한다.
- 겹침: 없음(FIELD-TEST는 device-check-2 단독). backlog-slim이 FIELD-TEST를 고칠 일이 생기면 보고에 적는다.
- 경계 인터페이스: device-check-2 보고의 닫음 목록 형식 `| §2 식별자(축 번호) | 관측 원문 | 구성(공식판/실험판) | 캡처 경로 |`.

## §3 git 격리

저장소 정책 main 직접 push(리뷰 통과 뒤). worktree `~/gildongmu-wt/backlog-slim`, `~/gildongmu-wt/device-check-2`(각 `feat/<이름>`, origin/main 기준). 통합은 `parallel-sessions` 스킬 Claude 지침 §3 순서. `--force` 금지. 문서 작업이라 npm 설치·기준선 없음. push 전 커밋 훅(privacy guard)이 `node_modules`를 요구하면 앞 세션처럼 메인 체크아웃 `node_modules`를 임시 심볼릭 링크로 걸고 통합 뒤 지운다.

## §4 웨이브

웨이브 1개, 두 세션 동시. 통합 순서: 먼저 끝난 쪽부터(파일 겹침 없음). 둘 다 끝나면 코디네이터가 device-check-2 닫음 목록을 BACKLOG에 반영한다.

## §5 착수 프롬프트·보고

- `~/.claude/parallel-sessions/gildongmu/backlog-slim.prompt.txt`, 보고 `~/gildongmu-wt/backlog-slim-reports/`
- `~/.claude/parallel-sessions/gildongmu/device-check-2.prompt.txt`, 보고 `~/gildongmu-wt/device-check-2-reports/`
