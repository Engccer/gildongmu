"use client";

import type { Place } from "@/lib/types";
import type { ChatMessage, RenderPayload } from "@/lib/chat/types";
import { ResultList } from "@/components/ResultList";
import { groupByCategory } from "@/lib/category";

/**
 * 채팅 메시지 1건 렌더.
 * - 사용자 메시지: 오른쪽 정렬 텍스트.
 * - 어시스턴트 메시지: 텍스트 + 선택적 RenderBlock(render payload 디스패치).
 *
 * @param onOpenPlace - 장소 카드 클릭 시 상세 진입 콜백. V1 채팅은 비목표 → 미주입 시 no-op.
 *   후속 Task에서 PlaceSearch openDetail과 연결 예정.
 */
export function MessageBubble({
  message,
  onOpenPlace,
}: {
  message: ChatMessage;
  onOpenPlace?: (place: Place) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "text-right" : "text-left"}>
      {message.text && (
        <p className="whitespace-pre-wrap">{message.text}</p>
      )}
      {message.render && (
        <RenderBlock render={message.render} onOpenPlace={onOpenPlace} />
      )}
    </div>
  );
}

/**
 * render payload 타입에 따라 적절한 컴포넌트로 디스패치.
 * Phase 3에서 도구별 case가 추가된다.
 */
function RenderBlock({
  render,
  onOpenPlace,
}: {
  render: RenderPayload;
  onOpenPlace?: (place: Place) => void;
}) {
  switch (render.type) {
    case "places":
      return (
        <ResultList
          groups={groupByCategory(render.places)}
          // onOpenPlace 미주입 시 no-op: ResultList는 필수 콜백 요구,
          // 상세 진입 와이어링은 후속 Task에서 처리.
          onOpen={onOpenPlace ?? (() => {})}
        />
      );
    default:
      // Phase 3에서 addresses, car-route, transit-route 등 case 추가
      return null;
  }
}
