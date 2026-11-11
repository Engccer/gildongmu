"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { JourneyRenderPayload } from "@/lib/chat/types";
import {
  journeyLineQualifiers,
  journeyMissingLines,
  journeyTotalsLine,
  journeyVariantHeading,
} from "@/lib/journey/journey-lines";

/**
 * 카드 버튼의 통로. `start`면 [안내 시작], 아니면 [길찾기에서 열기]. 받는 쪽(`PlaceSearch`)이 채팅을 닫고 길찾기 화면을 연다.
 * [안내 시작]은 위치를 새로 받는 동안 끝나지 않는 Promise를 돌려준다(그동안 카드가 버튼을 잠근다).
 */
export type JourneyActionHandler = (payload: JourneyRenderPayload, opts: { start: boolean }) => void | Promise<void>;

/**
 * 채팅 여정 카드(E70-b spec `2026-11-12-e70b-chat-journey-design.md` P1·D10·D11·D15).
 *
 * 읽기 순서: 제목 → (지정한 역으로 못 찾았으면) 그 사실 줄 → 합계 → [안내 시작] → [길찾기에서 열기]. 줄마다 한 접근성 객체다.
 * - 싣는 계획은 추천 순서의 첫 변형과 첫 출구다(길찾기 결과 화면의 기본 선택과 같다). 구간·다른 경로·출구는 [길찾기에서 열기]로 간다.
 * - 제목은 heading이 아니라 평문 한 줄이다 — 턴 점프는 질문 heading이 맡고, 답 안의 heading은 회전자를 오염시킨다.
 * - 수동 지정 위치에서 조회한 여정(`manualOrigin`)에도 [안내 시작]을 둔다(E70-b2 ③, D2 대체): 받는 쪽이 실제 위치를 받아
 *   카드의 결과로 시작하지 않고 길찾기에서 현재 위치 기준으로 다시 조회한다(막지 않고 알린다).
 * - `onAction`이 없으면(장소 상세에서 연 채팅 등, 능력을 신고하지 않는 자리) 버튼 없이 제목·합계만 그린다.
 * - 버튼은 `disabled`를 쓰지 않는다 — 측위를 기다리는 동안 포커스가 버튼에 남아야 한다(`aria-disabled` + in-flight ref 가드).
 */
export function JourneyChatCard({
  payload,
  onAction,
}: {
  payload: JourneyRenderPayload;
  onAction?: JourneyActionHandler;
}) {
  const t = useTranslations("journey");
  const tBeacon = useTranslations("beacon");
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const variant = payload.result.variants[0];
  // 변형이 없는 결과는 서버가 카드로 보내지 않는다(경로 없음은 답의 글이 말한다) — 깨진 payload는 빈 카드 대신 그리지 않는다.
  if (!variant) return null;
  const { board, alight } = payload;
  const lines = journeyLineQualifiers(payload.result, board, alight);

  async function act(start: boolean) {
    if (!onAction || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onAction(payload, { start });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-border p-3">
      <p className="font-semibold">{journeyVariantHeading(variant, board, alight, lines, t)}</p>
      {journeyMissingLines(payload.result, board, alight, t).map((line) => (
        <p key={line} className="mt-1 text-sm">
          {line}
        </p>
      ))}
      <p className="mt-1 text-sm">{journeyTotalsLine(variant, 0, t)}</p>
      {onAction && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void act(true)} aria-disabled={busy} className={CARD_BUTTON}>
            {tBeacon("start")}
          </button>
          <button type="button" onClick={() => void act(false)} aria-disabled={busy} className={CARD_BUTTON}>
            {t("openInDirections")}
          </button>
        </div>
      )}
    </div>
  );
}

const CARD_BUTTON =
  "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-disabled:opacity-50";
