"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { useTranslations } from "next-intl";
import { useTransitGuide } from "@/hooks/useTransitGuide";
import { isApproxTransitLock, viaStopCurrentIndex } from "@/lib/transit-guide";
import type { TransitPrewalkTarget } from "@/lib/transit-guide";
import type { TransitRoute } from "@/lib/types";
import { joinText } from "@/lib/format";
import { quickExitText } from "@/lib/quick-exit-text";
import { DistanceBeacon } from "./DistanceBeacon";

/**
 * 대중교통 실시간 안내 패널(B2 §3.2·§5) — DistanceBeacon과 같은 disclosure
 * 패턴: 평소엔 시작 버튼 하나, 누르면 세션 시작 + 컨트롤 인라인 펼침.
 *
 * 접근성 계약:
 * - 통지는 단일 polite live region 하나(훅의 liveMessage). 최신이 이전을
 *   대체하므로 supersede가 구조적으로 성립(§6.1).
 * - 상시 표시(구간·잔여·최신 문장·신호 상태·마지막 갱신)는 live region 밖
 *   (묶음 A 계약 재사용) — 무통지 구간에도 "무엇을 기다리는지"를 답한다(§6.1).
 * - 대기 목록 항목 정체성은 차량·열차 식별자(폴링 갱신이 포커스를 흔들지
 *   않게, §5.1). 항목 라벨은 행위구("…에 탑승").
 * - arrived로 국면이 바뀌면 "다음 구간" 버튼으로 포커스 선점(사라지는 컨트롤
 *   대신 다음 행동이 있는 곳, 헌장 §5).
 */
export function TransitGuidePanel({
  route,
  triggerLabel,
  dest,
  walkAccessible,
  onActiveChange,
}: {
  route: TransitRoute;
  triggerLabel: string;
  /** 목적지 좌표·라벨 — 완료 후 도보 핸드오프(§14.2)의 대상. 없으면 핸드오프 미노출. */
  dest?: { lat: number; lng: number; name: string };
  /**
   * 계단 회피 — 마지막 도보 구간 인계에 그대로 싣는다. 사용자가 길찾기 화면에서
   * 켠 설정이므로 대중교통을 거쳐 도착한 도보 구간에도 적용되는 것이 기대에 맞고,
   * iOS 인계 경로(`DirectionsTabView.startWalkHandoff`)와 계약이 갈리면 안 된다.
   */
  walkAccessible: boolean;
  /** 세션 활성 전이 통지. 대안 disclosure 안에 마운트된 패널이 접힘으로
      unmount되면 세션이 조용히 죽으므로, 부모가 이 신호로 강제 펼침을 유지한다. */
  onActiveChange?: (active: boolean) => void;
}) {
  const t = useTranslations("transitGuide");
  const tBeacon = useTranslations("beacon");
  const tGuide = useTranslations("guide");
  // 빠른하차 문구는 경로 브리핑과 같은 카탈로그를 쓴다 — 두 화면이 같은 사실을
  // 다른 문장으로 말하면 같은 정보인지 알 수 없다.
  const tTransitRoute = useTranslations("route.transit");
  const guide = useTransitGuide(route);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const advanceRef = useRef<HTMLButtonElement>(null);
  const changeBoardingRef = useRef<HTMLButtonElement>(null);
  /** 역 재선택 프롬프트 착지(A16 L3) — 버튼이 사라지는 전이라 포커스를 선점한다. */
  const reboardPromptRef = useRef<HTMLHeadingElement>(null);
  const confirmBoardedRef = useRef<HTMLButtonElement>(null);
  const waitingLabelRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listHadFocusRef = useRef(false);

  const state = guide.state;
  // 펼침은 별도 상태가 아니라 세션 존재에서 파생한다(트리거=시작이므로 동치).
  // 세션이 밖에서 죽으면(단일성 강탈·완료) 자동으로 트리거로 복귀한다.
  const open = state !== null;
  const leg = state && guide.guideRoute ? guide.guideRoute.legs[state.legIndex] : null;
  /**
   * 승차 전 도보(A25 spec 2026-08-30 §6): 시작 버튼이 세션 대신 이 상태로 들어가 승차역까지의
   * 도보 안내(DistanceBeacon)를 마운트한다. 진입 순간의 대상을 스냅숏으로 든다(props 변경에
   * 흔들리지 않게). 도착·선언이면 세션을 잇고, 그 밖의 종료는 전체 종료(iOS와 같은 정책).
   */
  const [prewalk, setPrewalk] = useState<TransitPrewalkTarget | null>(null);
  /** 선언 버튼이 세운다 — 세션 claim이 도보 세션을 멈추며 내는 "ended"를 취소로 읽지 않게. */
  const declaredRef = useRef(false);
  const active = open || prewalk !== null;
  const beginPrewalk = (target: TransitPrewalkTarget) => {
    declaredRef.current = false;
    setPrewalk(target);
    guide.setLiveMessage(t("prewalkStart", { station: target.name, minutes: target.minutes }));
  };
  const finishPrewalk = () => {
    declaredRef.current = true;
    setPrewalk(null);
    guide.startAfterPrewalk(true);
  };
  const onPrewalkSessionEnd = (reason: "arrived" | "ended") => {
    if (reason === "arrived") {
      finishPrewalk();
      return;
    }
    if (declaredRef.current) return;
    setPrewalk(null);
    guide.setLiveMessage(t("prewalkCancelled"));
  };
  // 대기 국면에서만 쓰지만 훅 규칙과 무관한 순수 파생이라 여기서 만든다.
  const quickExit = quickExitText(tTransitRoute, leg?.alightName ?? "", leg?.quickExit);

  // 세션 활성 전이를 부모에 통지(식별자는 ref로 고정 — 부모 인라인 콜백이
  // 렌더마다 새 함수여도 effect가 재발화하지 않는다). unmount 시 false 정리.
  // ⚠ 대입은 렌더가 아니라 effect에서 한다(react-hooks/refs). 선언 순서대로 실행되므로
  //    아래 [open] effect는 항상 갱신된 값을 본다.
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  });
  useEffect(() => {
    onActiveChangeRef.current?.(active);
  }, [active]);
  useEffect(() => () => onActiveChangeRef.current?.(false), []);

  // 경유역 목록 disclosure(§14.1) — 정적 표시 1단계, leg가 바뀌면 접는다
  // (렌더 중 파생 상태 조정 — effect 내 동기 setState의 캐스케이드 회피).
  const [viaOpen, setViaOpen] = useState(false);
  const legIndex = state?.legIndex ?? null;
  const [prevLegIndex, setPrevLegIndex] = useState(legIndex);
  if (legIndex !== prevLegIndex) {
    setPrevLegIndex(legIndex);
    setViaOpen(false);
  }

  // arrived 진입 시 "다음 구간"으로 선점 이동(다음 행동이 있는 곳, 헌장 §5).
  // 세션 소멸로 컨트롤이 사라지며 포커스가 body로 떨어졌으면 트리거로 복귀.
  const prevPhaseRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const phase = state?.phase ?? null;
    // 세션 시작(B4): 트리거 버튼이 unmount되며 커서가 body로 떨어지는 전이다(헌장 §5
    // "포커스를 쥔 요소를 제거하는 상태 전이"). 세션 내내 존재하는 상태 텍스트로 선점
    // — 시작 통지는 live region이 이미 내므로 착지는 위치 보존만 맡는다.
    if (phase !== null && prevPhaseRef.current === null) {
      statusRef.current?.focus();
    }
    if (phase === "arrived" && prevPhaseRef.current !== "arrived") {
      advanceRef.current?.focus();
    }
    // 탑승 변경·다른 차량 선택(→waiting): 누른 버튼이 섹션째 사라진다 — 대기 목록
    // 라벨로 선점(독립 리뷰 WARNING — 종전부터 비어 있던 전이).
    if (phase === "waiting" && prevPhaseRef.current !== null && prevPhaseRef.current !== "waiting") {
      waitingLabelRef.current?.focus();
    }
    // 차량 선택(waiting→boarding, N3): 누른 후보 행이 사라진다 — 다음 행동인
    // "탑승했습니다"로 선점.
    if (phase === "boarding" && prevPhaseRef.current === "waiting") {
      confirmBoardedRef.current?.focus();
    }
    // 탑승 계열 전이(waiting·boarding→riding)는 포커스를 쥔 컨트롤(선택·이미 탑승·
    // 탑승했습니다 버튼)을 통째로 제거한다 — riding 컨트롤로 선점(헌장 §5, 감사 M2).
    // arrived→riding 자동 복귀(backOnTrack)는 사용자 행동이 아니라 제외.
    if (
      phase === "riding" &&
      (prevPhaseRef.current === "waiting" || prevPhaseRef.current === "boarding")
    ) {
      (advanceRef.current ?? changeBoardingRef.current)?.focus();
    }
    if (phase === null && prevPhaseRef.current !== null) {
      if (document.activeElement === document.body || document.activeElement === null) {
        triggerRef.current?.focus();
      }
    }
    prevPhaseRef.current = phase;
  }, [state?.phase]);

  // 역 재선택 진입(A16 L3): 누른 버튼이 사라지는 전이라 방치하면 커서가 body로
  // 떨어진다(헌장 §5). 프롬프트 heading으로 선점 — 목록 첫 항목이 아니라 heading인
  // 이유는 "무엇을 고르는지"가 먼저 와야 하기 때문이다.
  const prevReboardRef = useRef(false);
  useLayoutEffect(() => {
    if (guide.reboardPickerActive && !prevReboardRef.current) {
      reboardPromptRef.current?.focus();
    }
    prevReboardRef.current = guide.reboardPickerActive;
  }, [guide.reboardPickerActive]);

  // 목록 포커스 소실 복귀(§13.4, 헌장 §5): 폴링 갱신으로 포커스가 얹힌 항목이
  // 사라지면(브라우저는 제거된 요소의 blur를 내지 않아 body로 조용히 이탈)
  // 목록 라벨로 선점 복귀한다. 목록 밖 포커스는 건드리지 않는다(강탈 금지).
  const optionKeys = guide.waitingOptions.map((o) => o.key).join("|");
  useLayoutEffect(() => {
    if (!listHadFocusRef.current) return;
    if (document.activeElement === document.body || document.activeElement === null) {
      listHadFocusRef.current = false;
      waitingLabelRef.current?.focus();
    }
  }, [optionKeys]);

  if (!guide.startable) return null;

  return (
    <div className="mt-1">
      {!active && (
        <button
          type="button"
          ref={triggerRef}
          onClick={() => (guide.prewalkTarget ? beginPrewalk(guide.prewalkTarget) : guide.start())}
          className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
        >
          {triggerLabel}
        </button>
      )}

      {/* 이 패널의 유일한 live region — 훅 liveMessage 단일 채널. 상시 마운트
          (내용과 함께 삽입되면 무발화 — B1 교훈)이고, 닫힌 뒤에도 중지·완료
          통지가 이 채널로 나가야 하므로 open 조건 밖이다. */}
      <p aria-live="polite" role="status" className="min-h-5 text-sm">
        {guide.liveMessage}
      </p>

      {/* 승차 전 도보(A25): 승차역까지의 도보 안내 + 도착 판정이 닿지 않을 때의 선언 버튼
          (라벨에 역명 — 무엇을 선언하는지 말한다). 세션 단일성은 guide-session-store가 그대로. */}
      {prewalk && !open && (
        <div className="mt-1">
          <DistanceBeacon
            dest={{ lat: prewalk.lat, lng: prewalk.lng, name: prewalk.name }}
            kind="walk"
            accessible={walkAccessible}
            startOnOpen
            focusTriggerOnMount
            onSessionEnd={onPrewalkSessionEnd}
          />
          <button
            type="button"
            onClick={finishPrewalk}
            className="mt-2 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
          >
            {t("prewalkArrivedButton", { station: prewalk.name })}
          </button>
        </div>
      )}

      {open && state && leg && (
        <div className="rounded-md border border-gray-300 p-3">
          {/* 상시 표시(live region 밖, 묶음 A 계약) — 통지와 같은 조립기를
              공유한다(§12.3: 완성 문장 공백 연결, 쉼표 조립(joinText) 폐기 —
              문장 키와 쉼표 조립이 섞이며 "기준., " 이중 구두점이 났었다). */}
          <p ref={statusRef} tabIndex={-1} className="text-sm">
            {guide.statusText}
          </p>

          {/* 경유역 목록 1단계(§14.1, 피드백 #3): 기보유 viaStops의 정적 표시 —
              추가 upstream 0회. 항목 무헤딩(도착편 관례)·단일 텍스트, 승차·하차
              라벨과 현재 위치(arvlMsg3 매칭, 지하철 잠금 추적에서만)를 쉼표로
              흡수한다. 단계 공개(더 보기)는 비적용 — 정적 텍스트라 절단 너머가
              행동을 바꾸지 않고(교통 목록 비적용 판정 동형) 펼침 자체가 명시 행동. */}
          {leg.viaStops.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setViaOpen((v) => !v)}
                aria-expanded={viaOpen}
                className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
              >
                {leg.mode === "subway"
                  ? t("viaStopsTrain", { count: leg.viaStops.length })
                  : t("viaStopsBus", { count: leg.viaStops.length })}
              </button>
              {viaOpen &&
                (() => {
                  const currentIndex = viaStopCurrentIndex(leg, state.currentLocation);
                  return (
                    <ul className="mt-1">
                      {leg.viaStops.map((stop, index) => (
                        <li key={`${index}-${stop.name}`} className="text-sm">
                          {joinText(
                            stop.name,
                            index === 0
                              ? t("viaBoard")
                              : index === leg.viaStops.length - 1
                                ? t("viaAlight")
                                : "",
                            index === currentIndex ? t("viaCurrent") : "",
                          )}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
            </div>
          )}

          {state.signal === "untrackable" && (
            <>
              <p className="mt-1 text-sm">{t("untrackable")}</p>
              <button
                type="button"
                onClick={guide.advance}
                className="mt-1 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
              >
                {t("advanceUntrackable")}
              </button>
            </>
          )}

          {state.phase === "waiting" && state.signal !== "untrackable" && (
            <div className="mt-1">
              {leg.trackMode === "tagoBus" ? (
                <button
                  type="button"
                  onClick={guide.boardApprox}
                  className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
                >
                  {t("boardApprox")}
                </button>
              ) : (
                <>
                  {/* 포커스 소실 복귀 착지점(§13.4) — tabIndex -1로 프로그래매틱 전용. */}
                  <p ref={waitingLabelRef} tabIndex={-1} className="text-sm font-medium">
                    {t("waitingLabel")}
                  </p>
                  {guide.directionUncertain && guide.waitingOptions.length > 0 && (
                    <p className="text-sm">{t("directionCheck")}</p>
                  )}
                  {/* 빠른하차(E5) — 목록 **앞**에 둔다. 국면 전환으로 조용히 나타나는
                      문장이라 목록으로 내려가는 길목에 놓아야 순차 탐색으로 만난다.
                      세션 시작 착지점은 상태 텍스트(B4, 2026-08-17)이고 그 다음 순차
                      탐색이 여기를 지나 목록으로 내려간다 — 자리의 근거는 "목록 앞"이다.
                      통지는 만들지 않는다(정적 정보라 상태 변화가 없다). */}
                  {quickExit && <p className="text-sm">{quickExit}</p>}
                  {guide.waitingOptions.length === 0 && (
                    // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패.
                    <p className="text-sm">
                      {guide.waitingReason === "filtered"
                        ? t("noCandidatesFiltered")
                        : guide.waitingReason === "unavailable"
                          ? t("noCandidatesUnavailable")
                          : t("noCandidates")}
                    </p>
                  )}
                  <ul
                    className="mt-1"
                    onFocusCapture={() => {
                      listHadFocusRef.current = true;
                    }}
                    onBlurCapture={(e: FocusEvent<HTMLUListElement>) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        listHadFocusRef.current = false;
                      }
                    }}
                  >
                    {guide.waitingOptions.map((option) => {
                      const item = option.candidate.item;
                      const desc = joinText(
                        item.destinationName ? t("bound", { dest: item.destinationName }) : "",
                        item.direction,
                        item.message,
                        option.candidate.express
                          ? t("expressCheck", { stop: leg.alightName })
                          : "",
                        option.departedMinutes != null
                          ? t("departed", { minutes: option.departedMinutes })
                          : "",
                      );
                      if (option.candidate.terminatesEarly) {
                        return (
                          <li key={option.key} className="mt-1 text-sm opacity-80">
                            {joinText(
                              desc,
                              t("terminatesEarly", {
                                dest: item.destinationName ?? "",
                                stop: leg.alightName,
                              }),
                            )}
                          </li>
                        );
                      }
                      return (
                        <li key={option.key} className="mt-1">
                          <button
                            type="button"
                            // aria-disabled는 활성화를 실제로 막지 못한다 — 핸들러
                            // 가드 병행(repo 관례). vehId 없는 잠금은 어떤 항목과도
                            // 매칭되지 않는 조용한 고장이 된다(독립 리뷰 BLOCKER).
                            onClick={() => {
                              if (!item.vehicleId) return;
                              // 설명은 안정 조각(행선·방향)만 — 완성 문장은 폴마다 바뀐다.
                              guide.boardCandidate(
                                option.candidate,
                                joinText(
                                  item.destinationName ? t("bound", { dest: item.destinationName }) : "",
                                  item.direction,
                                ),
                              );
                            }}
                            aria-disabled={!item.vehicleId}
                            className="min-h-11 w-full rounded-md border border-gray-400 px-3 text-left text-sm aria-disabled:opacity-50"
                          >
                            {/* 라벨은 "선택"이다(N3) — 탑승 여부는 앱이 승차 정류소 도착으로 판정한다. */}
                            {leg.mode === "subway"
                              ? t("selectTrain", { desc })
                              : t("selectBus", { desc })}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {/* 대기 국면 탈출구(§13.2) + 탑승 변경 취소(§13.1). */}
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={guide.refreshWaiting}
                      className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                    >
                      {t("refresh")}
                    </button>
                    <button
                      type="button"
                      onClick={guide.boardAlready}
                      className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                    >
                      {t("boardAlready")}
                    </button>
                    {state.previousLock && (
                      <button
                        type="button"
                        onClick={guide.cancelChangeBoarding}
                        className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                      >
                        {t("cancelChangeBoarding")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/*
            boarding(N3): 차량을 골랐고 승차 정류소 도착을 기다린다. 탈출은 사용자
            선언("탑승했습니다")과 재선택("다른 차량 선택") 둘 — 목록은 보이지 않는다.
          */}
          {state.phase === "boarding" && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                ref={confirmBoardedRef}
                onClick={guide.confirmBoarded}
                className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
              >
                {t("confirmBoarded")}
              </button>
              <button
                type="button"
                onClick={guide.changeBoarding}
                className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
              >
                {t("reselectVehicle")}
              </button>
            </div>
          )}

          {(state.phase === "riding" || state.phase === "arrived") && (
            <div className="mt-1 flex flex-wrap gap-2">
              {/* 근사 잠금은 advance 상시(§13.2 소비 한계 — arrived 전이가 없다). */}
              {(state.phase === "arrived" ||
                (state.lock != null && isApproxTransitLock(state.lock))) && (
                <button
                  type="button"
                  ref={advanceRef}
                  onClick={guide.advance}
                  className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
                >
                  {t("advance")}
                </button>
              )}
              {state.phase === "riding" &&
                leg.trackMode !== "tagoBus" &&
                !guide.reboardPickerActive && (
                  <button
                    type="button"
                    ref={changeBoardingRef}
                    onClick={guide.beginReboard}
                    className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                  >
                    {t("changeBoarding")}
                  </button>
                )}
            </div>
          )}

          {/*
            역 재선택(A16 L3) — 갈아탄 뒤 지금 있는 역을 묻는다. 위치가 아니라
            목록인 근거(위원장 판정): 지하철 안에서는 GPS가 잡히지 않는다.
            ⚠ 조용히 나타나는 섹션이 아니라 버튼으로 펼친 것이라 region이 아니라
            heading이 발견 경로다(헌장 §3 판단 규칙).
          */}
          {state.phase === "riding" && guide.reboardPickerActive && (
            <div className="mt-2">
              <h4 ref={reboardPromptRef} tabIndex={-1} className="text-sm font-medium">
                {t("reboardStationPrompt")}
              </h4>
              <ul className="mt-1 flex flex-wrap gap-2">
                {leg.viaStops.map((stop, index) => (
                  <li key={`${index}-${stop.name}`}>
                    <button
                      type="button"
                      onClick={() => guide.changeBoardingAt(index)}
                      className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                      // 역명은 ODsay 한국어 원문 — en 페이지에서도 한국어 엔진으로(A26). 버튼 하나가
                      // 한 객체라 새 분절은 없다.
                      lang="ko"
                    >
                      {stop.name}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  guide.cancelReboard();
                  // 취소는 아무것도 바꾸지 않으므로 눌렀던 자리로 돌려보낸다.
                  requestAnimationFrame(() => changeBoardingRef.current?.focus());
                }}
                className="mt-2 min-h-11 rounded-md border border-gray-400 px-3 text-sm"
              >
                {t("reboardCancel")}
              </button>
            </div>
          )}

          {/* 진행 상황(§3.2 공통 컨트롤): 자동 통지를 기다리지 않는 임의 시점 조회. */}
          <button
            type="button"
            onClick={guide.announceProgress}
            className="mt-2 mr-2 min-h-11 rounded-md border border-gray-400 px-3 text-sm"
          >
            {tGuide("progressButton")}
          </button>
          <button
            type="button"
            onClick={() => {
              guide.stop();
              guide.setLiveMessage(tBeacon("stopped"));
            }}
            className="mt-2 min-h-11 rounded-md border border-gray-400 px-3 text-sm"
          >
            {tBeacon("stop")}
          </button>
        </div>
      )}

      {/* 완료 후 도보 핸드오프 A안(§14.2, 피드백 #6): 말미 도보가 있으면 도보
          안내로의 제안형 연결 — 자동 연결(B안)은 지하 역사 GPS 공백으로 기각.
          세션 자체가 ko 게이트 안이라 추가 게이트 없음. 트리거=시작(startOnOpen),
          마운트 포커스로 사라진 "다음 구간" 버튼의 커서를 다음 행동으로 옮긴다. */}
      {guide.doneHandoff && dest && (
        <DistanceBeacon
          dest={dest}
          kind="walk"
          accessible={walkAccessible}
          startOnOpen
          focusTriggerOnMount
          triggerLabel={t("walkHandoffStart")}
        />
      )}
    </div>
  );
}
