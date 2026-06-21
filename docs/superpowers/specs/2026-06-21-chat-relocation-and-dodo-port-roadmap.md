# 채팅 재배치 + dodo 이식 로드맵

> 2026-06-21 · gildongmu. 채팅 UI를 장소별 컨텍스트 진입으로 재배치하고, 한국 여행 API를 dodo-planet에 이식하는 전체 순서. 두 개의 하위 spec을 잇는 overview.

## 동기 (위원장 실사용 피드백, 2026-06-21)

PWA 실사용 결과 두 가지 큰 결정:

1. **채팅을 메인 분기에서 떼어내 장소별 진입으로.** 메인 페이지의 검색⇄채팅 분기가 활용성을 떨어뜨리고 "검색창 중심 초미니멀 내비게이션" 콘셉트에서 멀어졌다. 채팅은 **특정 장소에 관해 묻는 맥락**일 때 가장 유용하다.
2. **검증된 한국 API를 dodo로 이식.** dodo는 이미 채팅 중심 + 다양한 API. 거기에 gildongmu가 성공적으로 연결한 한국 여행 API를 더한다.

## 하위 spec

| Spec | 내용 | 상태 |
|---|---|---|
| [A. 장소별 채팅](2026-06-21-place-scoped-chat-design.md) | 메인 분기·단축키 제거 + 거리추적 숨김 + 장소 상세에 채팅 오버레이 진입점 | **이번 사이클 구현** |
| [B. dodo 한국 API 이식](2026-06-21-dodo-korea-api-port-design.md) | ToolResult/카드 인프라 + 한국 provider·도구·키 이식 | **spec만 저장**(미래 구현) |

## 단계 (순서대로 진행)

```
Phase 1  Spec A 구현                                        ← 이번 사이클
  ├─ 분기 해체: ModeToggle·mode-state·keyboard-shortcuts 제거, PlaceSearch 순수 검색 환원
  ├─ 거리추적 숨김: PlaceDetail 마운트 제거(코드 보존)
  ├─ 장소별 채팅: 진입 버튼 + ChatOverlay + 예시 프롬프트 3개 + 장소 컨텍스트 주입
  └─ 리뷰 게이트 통과 → 자동 commit+push+배포(gildongmu 관례)
        ↓
Phase 2  Spec B 작성·저장                                   ← 이번 턴(문서만)
  └─ dodo 이식 설계 altitude 문서화(자체 plan은 미래)
        ↓
Phase 3  [미래] dodo 이식 구현                              ← 별도 사이클
  └─ Spec B를 입력으로 writing-plans → 4계층 구현(타입·provider·도구/카드·env)
        ↓
Phase 4  [미래] 거리추적 고도화                             ← 별도 브랜치
  └─ 보존된 beacon 코드를 별도 브랜치에서 수정·검증 후 재마운트
```

**이번 작업 범위 = Phase 1(구현) + Phase 2(문서).** Phase 3·4는 로드맵에 명시만.

## 게이트·원칙

- **Phase 1 → 2 연결**: Spec A 구현·리뷰 통과 후 Spec B 문서는 이미 이번 턴에 작성됨(병행). 구현과 미래 설계가 분리돼 컨텍스트 오염 없음.
- **자동 배포**: gildongmu는 리뷰 게이트 통과 후 묻지 않고 commit+push(자동배포). 파괴적·비용·아키텍처 하드 스톱은 유지.
- **거리추적 보존 불변식**: Phase 4까지 beacon 5개 파일·`beacon.*` i18n은 삭제 금지(Spec A §5).
- **이식 머지 게이트(Phase 3)**: 외부 API는 실호출을 머지 게이트로(fixture green ≠ 실계약).

## 다음 행동

Phase 1을 `writing-plans`로 전개해 단계별 구현 계획을 만든다. Spec B는 미래 참조로 저장 완료.
