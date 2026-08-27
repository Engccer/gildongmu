"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import { modelContext, type WebMcpTool } from "@/lib/webmcp/types";

type SupportState = "checking" | "supported" | "unsupported";

/**
 * 게이트 0 프로브(2026-08-27 통과 — 위원장 실사용: 인앱 브라우저에서 DOM 포커스를 옮기면
 * VoiceOver가 따라온다). 도구층 헬퍼(`useWebMcpTools`·`modelContext`)의 실사용 표면으로
 * 유지한다. 지원 여부를 화면에 내는 유일한 페이지다(제품 화면은 침묵).
 */

/** 프로브 표적(헤딩·버튼)의 접근 가능한 이름 — 이 페이지의 요소만 다루는 최소판. */
function activeElementLabel(): string | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
  return label || null;
}
export function WebMcpProbe() {
  const t = useTranslations("webmcpProbe");
  const [support, setSupport] = useState<SupportState>("checking");
  const [announcement, setAnnouncement] = useState("");
  const lastActionResultRef = useRef("");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const supported = modelContext() !== null;
    queueMicrotask(() => {
      if (mountedRef.current) setSupport(supported ? "supported" : "unsupported");
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const announce = (message: string, remember = true) => {
    if (remember) lastActionResultRef.current = message;
    if (mountedRef.current) setAnnouncement(message);
    return message;
  };

  useWebMcpTools(
    (): WebMcpTool[] => [
      {
        name: "read_current_probe_state",
        description: t("tool.readDescription"),
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async () =>
          announce(
            t("readStateResult", {
              support: t("support.supported"),
              focus: activeElementLabel() ?? t("noFocus"),
              lastResult: lastActionResultRef.current || t("noResult"),
            }),
            false,
          ),
      },
      {
        name: "focus_probe_item",
        description: t("tool.focusDescription"),
        inputSchema: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description: t("tool.indexDescription"),
            },
          },
          required: ["index"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          const index = input.index;
          if (!Number.isInteger(index) || Number(index) < 1 || Number(index) > 5) {
            return announce(t("invalidIndex"));
          }
          const numericIndex = Number(index);
          const target = document.querySelector<HTMLElement>(
            `[data-webmcp-probe-index="${numericIndex}"]`,
          );
          if (!target) return announce(t("focusFailed", { index: numericIndex }));
          target.focus();
          if (document.activeElement !== target) {
            return announce(t("focusFailed", { index: numericIndex }));
          }
          return announce(t("focusMoved", { label: activeElementLabel() ?? t("noFocus") }));
        },
      },
    ],
    { enabled: true, onRegisterError: () => announce(t("registrationFailed")) },
  );

  const activateButton = (index: number) => {
    const message = t("manualActivation", { index });
    lastActionResultRef.current = message;
    setAnnouncement(message);
  };

  const supportSummary = `${t("supportLabel")}: ${t(`support.${support}`)}.`;

  return (
    <>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-2">{t("intro")}</p>
      <p aria-live="polite" className="mt-4 font-medium">
        {supportSummary}
        {announcement ? ` ${announcement}` : ""}
      </p>

      <h3 className="mt-6 text-lg font-semibold">{t("targetsHeading")}</h3>
      <ol className="mt-3 space-y-3">
        <li>
          <h4 data-webmcp-probe-index="1" tabIndex={-1} className="font-semibold">
            {t("headingTarget", { index: 1 })}
          </h4>
        </li>
        <li>
          <button
            type="button"
            data-webmcp-probe-index="2"
            onClick={() => activateButton(2)}
            className="min-h-11 rounded border border-border px-3 py-2"
          >
            {t("buttonTarget", { index: 2 })}
          </button>
        </li>
        <li>
          <h4 data-webmcp-probe-index="3" tabIndex={-1} className="font-semibold">
            {t("headingTarget", { index: 3 })}
          </h4>
        </li>
        <li>
          <button
            type="button"
            data-webmcp-probe-index="4"
            onClick={() => activateButton(4)}
            className="min-h-11 rounded border border-border px-3 py-2"
          >
            {t("buttonTarget", { index: 4 })}
          </button>
        </li>
        <li>
          <h4 data-webmcp-probe-index="5" tabIndex={-1} className="font-semibold">
            {t("headingTarget", { index: 5 })}
          </h4>
        </li>
      </ol>
    </>
  );
}
