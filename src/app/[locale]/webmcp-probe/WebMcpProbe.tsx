"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type SupportState = "checking" | "supported" | "unsupported";

type ProbeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<string> | string;
};

type ModelContext = {
  registerTool: (
    tool: ProbeTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
};

function modelContext(): ModelContext | null {
  const candidate = (document as Document & { modelContext?: unknown }).modelContext;
  if (
    !candidate ||
    typeof (candidate as { registerTool?: unknown }).registerTool !== "function"
  ) {
    return null;
  }
  return candidate as ModelContext;
}

function activeElementLabel(fallback: string): string {
  if (
    document.activeElement === document.body ||
    document.activeElement === document.documentElement
  ) {
    return fallback;
  }
  const text = document.activeElement?.textContent?.trim();
  return text || fallback;
}

export function WebMcpProbe() {
  const t = useTranslations("webmcpProbe");
  const [support, setSupport] = useState<SupportState>("checking");
  const [announcement, setAnnouncement] = useState("");
  const lastActionResultRef = useRef("");

  useEffect(() => {
    let mounted = true;
    const context = modelContext();
    if (!context) {
      queueMicrotask(() => {
        if (mounted) setSupport("unsupported");
      });
      return () => {
        mounted = false;
      };
    }

    queueMicrotask(() => {
      if (mounted) setSupport("supported");
    });
    const controller = new AbortController();
    const announce = (message: string, remember = true) => {
      if (remember) lastActionResultRef.current = message;
      if (mounted) setAnnouncement(message);
      return message;
    };

    const readState: ProbeTool = {
      name: "read_current_probe_state",
      description: t("tool.readDescription"),
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: false,
      },
      execute: async () => {
        const result = t("readStateResult", {
          support: t("support.supported"),
          focus: activeElementLabel(t("noFocus")),
          lastResult: lastActionResultRef.current || t("noResult"),
        });
        return announce(result, false);
      },
    };

    const focusItem: ProbeTool = {
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
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
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

        return announce(
          t("focusMoved", {
            label: activeElementLabel(t("noFocus")),
          }),
        );
      },
    };

    const register = async () => {
      try {
        await context.registerTool(readState, { signal: controller.signal });
        await context.registerTool(focusItem, { signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) {
          announce(t("registrationFailed"));
          controller.abort();
        }
      }
    };
    void register();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [t]);

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
