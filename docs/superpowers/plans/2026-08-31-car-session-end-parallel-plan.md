# 자동차 세션 종료 보강 (K2-a) — 병렬 세션 계획

> 코디네이터: 2026-08-31 접수 세션. 근거: `docs/BACKLOG.md` K2-a(실사고 2026-08-29 실주행, 로그 `~/gildongmu-private/field-logs/guide-diag-2026-08-29.log.gz` — 18:46 시작, 19:28:50 `finalApproachEnter`가 마지막 줄, 이후 새벽까지 세션 생존·로그 0줄). 단일 마일스톤이지만 위원장 지시로 병렬 세션 절차를 따른다(세션 1개).

## §1 마일스톤·확정 판정 (위원장 2026-08-31)

**M1. 자동차 세션이 목적지에서 스스로 끝나게 한다.**

1. **도착 판정 국면**: 자동차는 `finalApproach` 기하가 없어도 경로 종점 150m 안(`finalApproachEnter`)에서 **최종 접근 국면에 들어간다**(`inFinalApproach = true`). 기존 `carArrivalStep`(40m·정차·acc≤30, `handleFinalApproach` 안)이 그대로 산다. 종점→목적지 방향 서술(`finalApproachEnter` 문장)은 기하가 없으니 **내지 않는다**(차는 문 앞에 못 세우니 원래 불필요). 간략(직선) 인계 분기는 **도보의 기하 없음(구버전 응답)에만** 남긴다.
2. **안전망**: (a) 도보의 **도착 추정**(`maybePresumeArrival`)을 자동차 최종 접근에도 켠다 — 국면 안에서 usable fix 두절 또는 무이동 N분이면 "도착한 것으로 보고 종료". 상수는 도보 값을 출발점으로 쓰되 car 프로파일로 분리(주차장 진입 두절은 도보보다 짧아도 된다 — 구현 세션이 정하고 spec에 근거 기록). (b) 국면 무관 안전망(`maybeEndIdleSession`)은 자동차에 **usable fix 두절 10분 축만** 켠다. **무이동 축은 자동차에 켜지 않는다**(정체·휴게소 정차와 구분 불가 — 주석의 배제 근거 유지).
3. 디폴트(재론 없음): 추정 도착도 종료 화면·도보 인계 버튼·걸음 요약 없음(car)은 확정 도착과 같은 모양. 종은 전경에서만(도보 동형). 간략 모드 fix 경로에 `guideDiagLog`를 넣어 침묵을 없앤다(로그 부피 고려해 fix당 1줄 유지).
4. 웹 미러: 순수 함수(`car-arrival.ts`·`session-idle.ts`·`final-approach.ts`)와 공유 fixture만 동조. 웹 car 실시간 안내 UI 배선은 비범위(K2 spec §179와 같다).

## §2 파일 소유권 지도 (세션 1개 — 전부 M1 소유)

- iOS 앱: `ios/Gildongmu/Directions/BeaconModel.swift`(`beginFinalApproach`·`handleFinalApproach`·`maybePresumeArrival`·`maybeEndIdleSession`·간략 경로), `ios/Gildongmu/Directions/GuideTuning*.swift`(프로파일 상수).
- Kit: `FinalApproach.swift`·`CarArrival.swift`·`SessionIdle.swift` + `Tests/`.
- 웹 미러: `src/lib/final-approach.ts`·`src/lib/car-arrival.ts`·`src/lib/session-idle.ts` + `__tests__`·공유 fixture.
- 문서: 새 spec `docs/superpowers/specs/2026-08-31-car-session-end-design.md`, `docs/BACKLOG.md` K2-a 항목만, `CHANGELOG.md` 2026-08-31 항목만, `CLAUDE.md`의 "잊힌 도보 세션은 국면 무관 안전망이 끝낸다" 단락(자동차 절 추가), `docs/FIELD-TEST.md` B1 행 추가, `docs/superpowers/specs/logs/README.md`에 08-29 로그 행 추가.
- 금지: 그 밖의 파일. 특히 `guidance-gate-drift.test.ts`가 세는 시작 호출 수를 늘리지 말 것.

## §3 git 격리

```bash
git worktree add ~/gildongmu-wt/car-end -b feat/car-end main
cp .env.local ~/gildongmu-wt/car-end/ && (cd ~/gildongmu-wt/car-end && npm ci)
# 작업 → pathspec 커밋 → git fetch && git rebase origin/main → npm run test:run → git push origin feat/car-end:main (ff만)
git worktree remove ~/gildongmu-wt/car-end
```
`--force` 금지. 실기기 배포는 **Experimental 구성**(`CONFIGURATION=Experimental ./ios/deploy-device.sh`)만 — 자동차 안내는 실험판 봉인이라 Release 배포 불필요. 배포 직전 코디네이터 보고.

## §4 웨이브

W1: M1 단독. 설계 리뷰 게이트는 **적용**(④ 안전·정확성 축: 세션 자동 종료는 경로 중간 종료와 한 끗) — spec에 판정 한 줄 남길 것. 실주행 판정(B1)은 위원장 몫으로 BACKLOG에 남긴다.

## §5 착수 프롬프트

`~/.claude/parallel-sessions/gildongmu/car-end.prompt.md`(런치 시 생성).
