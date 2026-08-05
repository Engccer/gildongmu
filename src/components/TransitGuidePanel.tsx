"use client";

import { useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useTransitGuide } from "@/hooks/useTransitGuide";
import type { TransitRoute } from "@/lib/types";
import { joinText } from "@/lib/format";

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
}: {
  route: TransitRoute;
  triggerLabel: string;
}) {
  const t = useTranslations("transitGuide");
  const tBeacon = useTranslations("beacon");
  const tGuide = useTranslations("guide");
  const guide = useTransitGuide(route);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const advanceRef = useRef<HTMLButtonElement>(null);

  const state = guide.state;
  // 펼침은 별도 상태가 아니라 세션 존재에서 파생한다(트리거=시작이므로 동치).
  // 세션이 밖에서 죽으면(단일성 강탈·완료) 자동으로 트리거로 복귀한다.
  const open = state !== null;
  const leg = state && guide.guideRoute ? guide.guideRoute.legs[state.legIndex] : null;

  // arrived 진입 시 "다음 구간"으로 선점 이동(다음 행동이 있는 곳, 헌장 §5).
  // 세션 소멸로 컨트롤이 사라지며 포커스가 body로 떨어졌으면 트리거로 복귀.
  const prevPhaseRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const phase = state?.phase ?? null;
    if (phase === "arrived" && prevPhaseRef.current !== "arrived") {
      advanceRef.current?.focus();
    }
    if (phase === null && prevPhaseRef.current !== null) {
      if (document.activeElement === document.body || document.activeElement === null) {
        triggerRef.current?.focus();
      }
    }
    prevPhaseRef.current = phase;
  }, [state?.phase]);

  if (!guide.startable) return null;

  return (
    <div className="mt-1">
      {!open && (
        <button
          type="button"
          ref={triggerRef}
          onClick={guide.start}
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

      {open && state && leg && (
        <div className="rounded-md border border-gray-300 p-3">
          {/* 상시 표시(live region 밖, 묶음 A 계약) — 통지와 같은 조립기를
              공유한다(§12.3: 완성 문장 공백 연결, 쉼표 조립(joinText) 폐기 —
              문장 키와 쉼표 조립이 섞이며 "기준., " 이중 구두점이 났었다). */}
          <p className="text-sm">{guide.statusText}</p>

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
                  <p className="text-sm font-medium">{t("waitingLabel")}</p>
                  {guide.directionUncertain && guide.waitingOptions.length > 0 && (
                    <p className="text-sm">{t("directionCheck")}</p>
                  )}
                  {guide.waitingOptions.length === 0 && (
                    <p className="text-sm">{t("noCandidates")}</p>
                  )}
                  <ul className="mt-1">
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
                              guide.boardCandidate(option.candidate);
                            }}
                            aria-disabled={!item.vehicleId}
                            className="min-h-11 w-full rounded-md border border-gray-400 px-3 text-left text-sm aria-disabled:opacity-50"
                          >
                            {leg.mode === "subway"
                              ? t("boardTrain", { desc })
                              : t("boardBus", { desc })}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          {(state.phase === "riding" || state.phase === "arrived") && (
            <div className="mt-1 flex flex-wrap gap-2">
              {(state.phase === "arrived" || leg.trackMode === "tagoBus") && (
                <button
                  type="button"
                  ref={advanceRef}
                  onClick={guide.advance}
                  className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
                >
                  {t("advance")}
                </button>
              )}
              {state.phase === "riding" && leg.trackMode !== "tagoBus" && (
                <button
                  type="button"
                  onClick={guide.changeBoarding}
                  className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                >
                  {t("changeBoarding")}
                </button>
              )}
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
    </div>
  );
}
