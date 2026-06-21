"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { ChatInterface } from "./ChatInterface";
import { placeChatPrompts } from "@/lib/chat/place-prompts";

/**
 * 장소별 채팅 오버레이 — role="dialog" aria-modal 풀스크린 셸.
 *
 * 접근성:
 * - 열릴 때 제목(h2, tabIndex=-1)으로 포커스 이동.
 * - Esc·닫기 버튼 두 경로로 닫고, 닫힘은 부모 onClose가 트리거 버튼으로 포커스 복귀.
 * - 포커스 트랩: Tab이 오버레이 밖(뒤의 상세)으로 새지 않게 첫/마지막 포커서블을 순환.
 * - aria-modal="true"로 스크린 리더 가상 커서를 dialog에 제한(미니멀 ARIA — inert 미사용).
 *
 * 채팅 내용은 기존 ChatInterface를 장소마다 새로 마운트한다(언마운트로 대화 초기화 =
 * "장소마다 새 대화"). placeContext로 좌표 도구가 이 장소를 앵커로 동작한다(I-1).
 *
 * 뒤로가기(History) 닫기는 V1 비포함 — PlaceSearch의 기존 popstate 상세 트랩과
 * 충돌(어느 것을 닫을지 모호)하므로 Esc/버튼으로 한정한다.
 */
export function ChatOverlay({ place, onClose }: { place: Place; onClose: () => void }) {
  const tp = useTranslations("placeChat");
  const t = useTranslations();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const placeContext = {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    isStation: isStation(place),
  };
  const examplePrompts = placeChatPrompts(place).map((key) => t(key));

  // 열릴 때 제목으로 포커스 이동(맥락 안내).
  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc 닫기 + 포커스 트랩(Tab 순환).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {tp("title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tp("close")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border hover:bg-accent/10"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <ChatInterface
        inputRef={chatInputRef}
        placeContext={placeContext}
        examplePrompts={examplePrompts}
      />
    </div>
  );
}
