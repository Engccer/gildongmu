"use client";

import type { ReactNode, RefObject } from "react";

interface Props {
  triggerLabel: string;
  onTrigger: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  /** autoLoad(채팅 카드)는 트리거를 렌더하지 않는다(라이브·패널은 유지). */
  showTrigger?: boolean;
  /** 단일 polite live region — 셸이 유일 소유자(스펙 §2). 자식은 자체 live 금지. */
  live: string;
  open: boolean;
  heading: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** 헤딩과 닫기 버튼 사이 조건부 공지 슬롯(진료 기준·보완 실패 등 — NightClinics). */
  notice?: ReactNode;
  /** undefined면 닫기 버튼 미렌더(autoLoad). */
  onClose?: () => void;
  closeLabel?: string;
  /** undefined면 미렌더 — WalkInfra는 children이 조건부 footnote를 소유. */
  source?: string;
  children: ReactNode;
}

/** nearby 8종 렌더 골격의 정본 — 트리거·live·패널 껍데기(h3·닫기·source). */
export function NearbyPanelShell({
  triggerLabel,
  onTrigger,
  triggerRef,
  busy,
  showTrigger = true,
  live,
  open,
  heading,
  headingRef,
  notice,
  onClose,
  closeLabel,
  source,
  children,
}: Props) {
  return (
    <div className="mt-3">
      {showTrigger && (
        <button
          ref={triggerRef}
          type="button"
          onClick={onTrigger}
          aria-disabled={busy}
          aria-busy={busy}
          className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
        >
          {triggerLabel}
        </button>
      )}

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {open && (
        <div className="mt-2 rounded-md border border-border p-3">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {heading}
          </h3>
          {notice}
          {onClose && (
            <button
              type="button"
              onClick={() => onClose()}
              className="mt-1 min-h-11 text-sm text-accent underline"
            >
              {closeLabel}
            </button>
          )}
          {children}
          {source && <p className="mt-2 text-xs opacity-70">{source}</p>}
        </div>
      )}
    </div>
  );
}
