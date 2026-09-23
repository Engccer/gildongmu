"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { useTranslations } from "next-intl";
import { useTransitGuide } from "@/hooks/useTransitGuide";
import { isApproxTransitLock, needsExpressPrompt, viaStopCurrentIndex } from "@/lib/transit-guide";
import type { TransitGuideLeg, TransitPrewalkTarget } from "@/lib/transit-guide";
import type { TransitRoute } from "@/lib/types";
import { joinText } from "@/lib/format";
import { transitDisplayItem, transitDisplayLeg, type TransitLabel } from "@/lib/transit-display";
import {
  candidateDescLine,
  expressSkipsAlightLine,
  prewalkArrivedButtonLine,
  prewalkStartLine,
  terminatesEarlyLine,
  vehicleDescLine,
  viaStopLine,
  type TransitTextLine,
} from "@/lib/transit-guide-text";
import { namedArgs } from "@/lib/transit-text-args";
import { prefersEnglish } from "@/lib/data-locale";
import { useLocale } from "next-intl";
import { quickExitText } from "@/lib/quick-exit-text";
import { DistanceBeacon } from "./DistanceBeacon";

/**
 * 대중교통 실시간 안내 패널(B2 §3.2·§5) — DistanceBeacon과 같은 disclosure
 * 패턴: 평소엔 시작 버튼 하나, 누르면 세션 시작 + 컨트롤 인라인 펼침.
 *
 * 접근성 계약:
 * - 통지는 화면의 단일 polite 창구 하나(`announce` prop — 훅의 liveMessage를 올린다).
 *   최신이 이전을 대체하므로 supersede가 구조적으로 성립(§6.1). ⚠ 이 패널은 자기
 *   live region을 두지 않는다(A40) — 폴 타이머가 돌리는 채널과 사용자 조작이 돌리는
 *   채널이 따로 있으면 겹치는 순간 한쪽이 잘린다.
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
  announce,
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
  /**
   * 이 화면의 **단일 polite 창구**(A40). 기본값 없음 — 생략이 컴파일을 통과하면
   * 통지가 조용히 사라진다(안전 인자에 기본값 금지). 아래 도보 비콘에도 그대로 내린다.
   */
  announce: (text: string, lang?: "ko") => void;
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
  const guide = useTransitGuide(route, {
    walkHandoffAvailable: dest != null,
    ...(dest?.name ? { destinationLabel: dest.name } : {}),
  });

  // 안내 문장을 화면의 단일 창구로 올린다(A40). ⚠ **빈 값은 게시하지 않는다** — 훅은
  // 같은 문장을 다시 말하려고 `"" → 같은 문장`으로 되돌리는데, 그 빈 값을 그대로
  // 올리면 창구에 떠 있던 다른 게시자의 문장을 지운다(대안 경로마다 이 패널이 하나씩
  // 마운트되므로 세션 없는 패널의 빈 값도 같은 방식으로 새어 나간다). 재발화는 창구의
  // seq 키가 맡는다. 닫힌 뒤의 중지·완료 통지도 이 경로로 나가므로 open 조건 밖이다.
  useEffect(() => {
    if (!guide.liveMessage) return;
    announce(guide.liveMessage, guide.liveLang);
  }, [guide.liveMessage, guide.liveLang, announce]);

  const locale = useLocale();
  /** 데이터 언어 축 — 비-ko 로케일은 전부 영문 데이터를 공유한다(E27 잔여 ① §3.1). */
  const isEn = prefersEnglish(locale);

  /** descriptor → 화면 문자열(조각을 각자 조회해 쉼표로 잇는다, 빈 조각 제거). */
  const render = (d: TransitTextLine): string =>
    joinText(...d.parts.map((p) => ("key" in p ? t(p.key, namedArgs(p.key, p.args)) : p.text)));

  /**
   * 그 줄의 `lang` — 한국어 폴백일 때만 `"ko"`(영어 줄은 UI 문장 틀이 섞여 태그하지 않는다,
   * E27 §3.6). 영어 엔진이 한글을 만나면 그 이름이 통째로 침묵하므로 이 태그가 필요하다.
   */
  const langOf = (d: TransitTextLine): "ko" | undefined =>
    isEn && d.parts.length > 0 && d.lang === "ko" ? "ko" : undefined;

  /**
   * 선택 차량 설명을 **ko·en 쌍**으로 얼린다 — 렌더 문자열을 저장하면 세션 도중 언어를 바꿨을 때
   * 그 조각만 옛 언어로 남는다(안정 조각인 행선·방향만, 완성 문장은 폴마다 바뀐다).
   */
  const descLabelOf = (item: ReturnType<typeof transitDisplayItem>): TransitLabel | null => {
    const en = vehicleDescLine(true, item);
    const ko = render(vehicleDescLine(false, item));
    // ⚠ **비면 null이다.** 서울버스는 행선·방향이 둘 다 없어 설명이 빈 문자열인데, 빈 라벨
    // 객체는 truthy라 상시 표시에 "선택한 차량: ." 같은 빈 슬롯이 뜬다(종전엔 `""`가 falsy라
    // 줄이 통째로 생략됐다). null이면 `vehicleSelectedLine`의 노선명 폴백도 주석대로 산다.
    if (!ko) return null;
    return { ko, ...(en.lang === "en" ? { en: render(en) } : {}) };
  };

  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 역 재선택 프롬프트 착지(A16 L3) — 화면 자체가 질문이라 헤딩이 착지점이다(E38 예외). */
  const reboardPromptRef = useRef<HTMLHeadingElement>(null);
  /**
   * 급행 확인 프롬프트(spec 2026-09-02 §6) — 버튼으로 펼친 것이라 heading이 발견 경로(헌장 §3).
   * 연 시점의 국면 세대에 결박해 파생한다(iOS `onChange(of: phase)` 동형): 후보 선택·탑승 변경·구간
   * 전진·세션 종료가 세대를 올리면 누르지 않은 프롬프트가 다음 대기 국면에 되살아나지 않는다(spec 리뷰).
   */
  const [expressPromptGen, setExpressPromptGen] = useState<number | null>(null);
  const expressPromptRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (expressPromptGen !== null) expressPromptRef.current?.focus();
  }, [expressPromptGen]);
  // 급행 거절(§6): 답 버튼이 사라지는 전이라 거절 문장 행에 선점(헌장 §5) — 착지 낭독이 곧 답이라 별도 통지 없음.
  const expressNoteRef = useRef<HTMLParagraphElement>(null);
  const prevExpressNoteRef = useRef(false);
  const hasExpressNote = guide.expressBlockedNote !== null;
  useLayoutEffect(() => {
    if (hasExpressNote && !prevExpressNoteRef.current) expressNoteRef.current?.focus();
    prevExpressNoteRef.current = hasExpressNote;
  }, [hasExpressNote]);
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
  /** 도보 안내에 넘길 목적지 표시 이름 — 프리워크 통지·버튼과 **같은 이름**이어야 한다. */
  const prewalkWalkLabel = isEn ? (prewalk?.nameEn ?? prewalk?.name ?? "") : (prewalk?.name ?? "");
  /** 승차 전 도보 "도착" 버튼 라벨 — 줄과 lang을 함께 쓰므로 한 번만 만든다. */
  const prewalkArrivedButtonLabel = prewalkArrivedButtonLine(isEn, {
    ko: prewalk?.name ?? "",
    ...(prewalk?.nameEn ? { en: prewalk.nameEn } : {}),
  });
  const beginPrewalk = (target: TransitPrewalkTarget) => {
    declaredRef.current = false;
    setPrewalk(target);
    const line = prewalkStartLine(
      isEn,
      { ko: target.name, ...(target.nameEn ? { en: target.nameEn } : {}) },
      target.minutes,
    );
    guide.setLiveMessage(render(line), langOf(line));
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
  // 하차역명은 **표시 라벨**이다(E27 잔여 ①) — 영문이 없으면 그 줄만 ko로 태그한다.
  const alightLabel = leg ? transitDisplayLeg(leg, null).alight : null;
  const quickExit = quickExitText(
    tTransitRoute,
    alightLabel ? (isEn ? (alightLabel.en ?? alightLabel.ko) : alightLabel.ko) : "",
    leg?.quickExit,
  );
  const quickExitLang = isEn && alightLabel && !alightLabel.en ? "ko" : undefined;

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
  /** E34 조건 — 훅과 같은 축(도착 문장·버튼 라벨이 갈리지 않게). */
  const handoffNow = guide.handoffNow;
  const [prevLegIndex, setPrevLegIndex] = useState(legIndex);
  if (legIndex !== prevLegIndex) {
    setPrevLegIndex(legIndex);
    setViaOpen(false);
  }

  /**
   * 국면 전이 착지(E38 위원장 판정 2026-09-12, iOS `phaseTransitionLanding` 미러) — **기본 대상은
   * 상태 문장 행**이고 예외는 차량 선택 목록으로 가는 →waiting 전이 하나다. 종전엔 전이마다 다음 행동
   * 버튼을 골랐지만(arrived→[다음 구간], →riding→[탑승 변경]), 액션마다 커서가 컨트롤로 튀어 확인하고
   * 싶은 정보 행까지 다시 내려가야 했다. 참인 전이는 전부 사용자 행동이 만든 것이다.
   *
   * ⚠ **boarding→riding은 제외한다**(N3 ① 구현 리뷰 M1): 그 승격은 폴이 일으키고 커서는 이미 상태
   * 문장에 앉아 있으므로, 착지시키면 듣던 문장을 끊는 포커스 강탈이 된다. 승격 사실은 통지가 말한다
   * (arrived→riding 자동 복귀도 같은 이유로 제외).
   */
  const prevPhaseRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const phase = state?.phase ?? null;
    const previous = prevPhaseRef.current;
    // 탑승 변경·다른 차량 선택(→waiting): 누른 버튼이 섹션째 사라지고 도착하는 곳은 차량 선택 목록이다 —
    // **그 화면의 질문 라벨**에 앉는다(위원장 판정 2026-09-12: "이미 탑승" 흐름이 같은 목록에 다른 문으로
    // 들어가면서 라벨에 착지하므로 두 문을 맞춘다). 목록이 서지 않는 갈래(지방버스)엔 라벨이 없어 상태 문장으로.
    const landsOnLabel = phase === "waiting" && previous !== null && previous !== "waiting";
    const lands =
      // 세션 시작(B4): 트리거 버튼이 unmount되며 커서가 body로 떨어지는 전이다(헌장 §5
      // "포커스를 쥔 요소를 제거하는 상태 전이"). 시작 통지는 live region이 이미 낸다.
      (phase !== null && previous === null) ||
      // 하차 지점 도착 — [다음 구간]이 아니라 도착을 말하는 문장이 착지점이다(E38 판정 문언).
      (phase === "arrived" && previous !== "arrived") ||
      // 차량 선택(waiting→boarding, N3 ①): 누른 후보 행이 사라진다.
      (phase === "boarding" && previous === "waiting") ||
      // 고른 열차로 직행(waiting→riding, A34 `boardAboard`): 선택 행·[이미 탔어요]가 통째로 사라진다.
      (phase === "riding" && previous === "waiting");
    if (landsOnLabel) {
      (waitingLabelRef.current ?? statusRef.current)?.focus();
    } else if (lands) {
      statusRef.current?.focus();
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
  // "이미 탑승" 흐름(A34 ②): pickStation 진입은 같은 헤딩으로, pickVehicle 진입은 목록 라벨(라벨이 곧 질문)로
  // 선점. 프롬프트가 펼쳐진 채 역을 바꾸면 답이 그 역에 대한 답이 아니다 — 단계가 바뀌면 급행 확인을 접는다.
  const prevAboardRef = useRef<typeof guide.aboardStep>(null);
  useLayoutEffect(() => {
    if (guide.aboardStep !== prevAboardRef.current) {
      setExpressPromptGen(null);
      if (guide.aboardStep === "pickStation") reboardPromptRef.current?.focus();
      if (guide.aboardStep === "pickVehicle") waitingLabelRef.current?.focus();
      if (guide.aboardStep === null && prevAboardRef.current === "pickStation") {
        // 역 선택 취소 복귀(E38) — 하차역 선언·잠금이 만드는 국면 전이 착지도 같은 상태 문장이라
        // 종전의 "취소만 여기로 온다" 판별(`isConnected` 가드)은 더 이상 필요 없다.
        statusRef.current?.focus();
      }
    }
    prevAboardRef.current = guide.aboardStep;
  }, [guide.aboardStep]);

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

      {/* 승차 전 도보(A25): 승차역까지의 도보 안내 + 도착 판정이 닿지 않을 때의 선언 버튼
          (라벨에 역명 — 무엇을 선언하는지 말한다). 세션 단일성은 guide-session-store가 그대로. */}
      {prewalk && !open && (
        <div className="mt-1">
          <DistanceBeacon
            // ⚠ 도보 안내의 목적지 라벨도 **같은 표시 이름**을 쓴다 — 한국어로 두면 한 세션
            // 안에서 같은 역이 두 이름("Walk to Cheonho" → "천호까지 …")으로 불려, 화면을 못
            // 보는 사용자에게 둘이 같은 곳이라는 근거가 없다(a11y 감사 검출). 이 라벨은
            // 안내 문장에만 쓰이는 표시 전용이라 조인이 걸리지 않는다.
            dest={{ lat: prewalk.lat, lng: prewalk.lng, name: prewalkWalkLabel }}
            kind="walk"
            accessible={walkAccessible}
            announce={announce}
            startOnOpen
            focusTriggerOnMount
            onSessionEnd={onPrewalkSessionEnd}
          />
          <button
            type="button"
            onClick={finishPrewalk}
            className="mt-2 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
            // ⚠ 역명이 한국어 폴백이면 이 줄도 ko로 태그한다 — 지하 진입으로 도착 판정이 닿지
            // 않을 때의 유일한 탈출구라, 영어 엔진이 역명을 삼키면 라벨의 존재 이유가 없어진다.
            lang={langOf(prewalkArrivedButtonLabel)}
          >
            {render(prewalkArrivedButtonLabel)}
          </button>
        </div>
      )}

      {open && state && leg && (
        <div className="rounded-md border border-gray-300 p-3">
          {/* 상시 표시(live region 밖, 묶음 A 계약) — 통지와 같은 조립기를
              공유한다(§12.3: 완성 문장 공백 연결, 쉼표 조립(joinText) 폐기 —
              문장 키와 쉼표 조립이 섞이며 "기준., " 이중 구두점이 났었다). */}
          <p ref={statusRef} tabIndex={-1} className="text-sm" lang={guide.statusLang}>
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
                  // ⚠ 현재역 인덱스 판정은 **조인**이라 한국어 원문(`state.currentLocation`)으로 한다.
                  const currentIndex = viaStopCurrentIndex(leg, state.currentLocation);
                  const display = transitDisplayLeg(leg, null);
                  return (
                    <ul className="mt-1">
                      {display.stops.map((stop, index) => {
                        const isAlight = index === display.stops.length - 1;
                        const line = viaStopLine(
                          isEn,
                          stop,
                          index === 0 ? "board" : isAlight ? "alight" : "via",
                          index === currentIndex,
                          // 하차역 행에 출구 번호 병기(E25) — 정적 표시.
                          isAlight ? (display.exitAlight ?? null) : null,
                        );
                        return (
                          <li key={`${index}-${stop.ko}`} className="text-sm" lang={langOf(line)}>
                            {render(line)}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
            </div>
          )}

          {state.signal === "untrackable" && (
            <>
              <p className="mt-1 text-sm">{t("untrackable")}</p>
              {/* 마지막 leg면 라벨이 인계 자체(E34). */}
              <button
                type="button"
                onClick={handoffNow ? () => guide.advanceIntoWalkHandoff() : guide.advance}
                className="mt-1 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
              >
                {handoffNow ? t("walkHandoffStart") : t("advanceUntrackable")}
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
              ) : guide.aboardStep === "pickStation" ? (
                // "이미 탑승" 흐름 1단(A34 ②): 지나는 역을 묻는다 — 역 선택 화면 재사용, 질문만 전용 키.
                <StationPicker
                  prompt={t("aboardStationPrompt")}
                  promptRef={reboardPromptRef}
                  leg={leg}
                  isEn={isEn}
                  onPick={guide.pickAboardStation}
                  onCancel={guide.cancelAboard}
                  cancelLabel={t("reboardCancel")}
                />
              ) : (
                <>
                  {/* 포커스 소실 복귀 착지점(§13.4) — tabIndex -1로 프로그래매틱 전용.
                      pickVehicle 단계(A34 ②)는 라벨이 곧 질문("타고 계신 차량을 선택하세요"). */}
                  <p ref={waitingLabelRef} tabIndex={-1} className="text-sm font-medium">
                    {guide.aboardStep === "pickVehicle" ? t("waitingLabelAboard") : t("waitingLabel")}
                  </p>
                  {guide.directionUncertain && guide.waitingOptions.length > 0 && (
                    <p className="text-sm">{t("directionCheck")}</p>
                  )}
                  {/* 빠른하차(E5) — 목록 **앞**에 둔다. 국면 전환으로 조용히 나타나는
                      문장이라 목록으로 내려가는 길목에 놓아야 순차 탐색으로 만난다.
                      세션 시작 착지점은 상태 텍스트(B4, 2026-08-17)이고 그 다음 순차
                      탐색이 여기를 지나 목록으로 내려간다 — 자리의 근거는 "목록 앞"이다.
                      통지는 만들지 않는다(정적 정보라 상태 변화가 없다). */}
                  {quickExit && (
                    <p className="text-sm" lang={quickExitLang}>
                      {quickExit}
                    </p>
                  )}
                  {guide.waitingOptions.length === 0 && (
                    // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패.
                    <p className="text-sm">
                      {guide.aboardFilteredOut
                        ? t("noCandidatesAboard")
                        : guide.waitingReason === "filtered"
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
                      const displayLeg = transitDisplayLeg(leg, null);
                      const displayItem = transitDisplayItem(item);
                      // 차단 행은 급행 조각을 빼고 사유 줄만 결정 문장으로 둔다(a11y 감사 2026-09-02).
                      const descLine = candidateDescLine(isEn, displayLeg, displayItem, {
                        express: option.candidate.unreachable ? null : option.candidate.express,
                        departedMinutes: option.departedMinutes,
                      });
                      const desc = render(descLine);
                      if (option.candidate.unreachable) {
                        // 결정적 미도달(§5.1·A16 L1) — 활성화 차단의 단일 술어, 사유별 문장.
                        const note =
                          option.candidate.unreachable === "terminatesEarly"
                            ? terminatesEarlyLine(isEn, displayLeg, displayItem)
                            : expressSkipsAlightLine(isEn, displayLeg);
                        // 두 줄이 한 항목이라 언어가 갈리면 그 항목은 통째로 ko로 태그한다.
                        const lang = langOf(descLine) ?? langOf(note);
                        return (
                          <li key={option.key} className="mt-1 text-sm opacity-80" lang={lang}>
                            {joinText(desc, render(note))}
                          </li>
                        );
                      }
                      return (
                        <li key={option.key} className="mt-1" lang={langOf(descLine)}>
                          <button
                            type="button"
                            // aria-disabled는 활성화를 실제로 막지 못한다 — 핸들러
                            // 가드 병행(repo 관례). vehId 없는 잠금은 어떤 항목과도
                            // 매칭되지 않는 조용한 고장이 된다(독립 리뷰 BLOCKER).
                            onClick={() => {
                              if (!item.vehicleId) return;
                              // 설명은 안정 조각(행선·방향)만 — 완성 문장은 폴마다 바뀐다.
                              // 설명이 비면 null — 훅이 노선명 폴백으로 문장을 만든다.
                              if (guide.aboardStep === "pickVehicle") {
                                guide.boardAboardCandidate(option.candidate, descLabelOf(displayItem));
                              } else {
                                guide.boardCandidate(option.candidate, descLabelOf(displayItem));
                              }
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
                    {guide.aboardStep === "pickVehicle" ? (
                      <>
                        {/* 목록이 빌 때만 근사(비관측) 잠금으로(A34 판정) — 급행 집합 노선이면 급행 확인이 먼저. */}
                        {guide.waitingOptions.length === 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              needsExpressPrompt(leg)
                                ? setExpressPromptGen(state.phaseGen)
                                : guide.boardAlready()
                            }
                            className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                          >
                            {t("continueWithoutTrain")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={guide.pickAnotherAboardStation}
                          className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                        >
                          {t("pickAnotherStation")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        // 지하철은 역부터 묻고(A34 ②), 그 밖(서울버스)은 종전대로 — 급행 집합이 있는
                        // 노선만 급행 확인을 묻는다(§6), 없으면 즉시(비관측) 잠금.
                        onClick={() =>
                          leg.trackMode === "subway" && leg.viaStops.length > 0
                            ? guide.beginAboard()
                            : needsExpressPrompt(leg)
                              ? setExpressPromptGen(state.phaseGen)
                              : guide.boardAlready()
                        }
                        className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                      >
                        {t("boardAlready")}
                      </button>
                    )}
                    {state.previousLock && guide.aboardStep === null && (
                      <button
                        type="button"
                        onClick={guide.cancelChangeBoarding}
                        className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                      >
                        {t("cancelChangeBoarding")}
                      </button>
                    )}
                  </div>
                  {expressPromptGen === state.phaseGen && needsExpressPrompt(leg) && (
                    <div className="mt-2">
                      <h4 ref={expressPromptRef} tabIndex={-1} className="text-sm font-medium">
                        {t("expressPrompt")}
                      </h4>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExpressPromptGen(null);
                            guide.boardAlready(true);
                          }}
                          className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                        >
                          {t("expressYes")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExpressPromptGen(null);
                            guide.boardAlready(false);
                          }}
                          className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                        >
                          {t("expressNo")}
                        </button>
                      </div>
                    </div>
                  )}
                  {guide.expressBlockedNote && (
                    // 잠금 거절의 상시 문장(통지는 훅 live region이 이미 냈다) — 사유가 화면에 남는다.
                    <p
                      ref={expressNoteRef}
                      tabIndex={-1}
                      className="mt-1 text-sm"
                      lang={guide.expressBlockedNote.lang}
                    >
                      {guide.expressBlockedNote.text}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/*
            boarding(N3): 차량을 골랐고 승차 정류소 도착을 기다린다. 도착 관측이 riding 승격을
            **자동으로** 하므로 선언 버튼은 서지 않는다(위원장 판정 2026-09-10, spec
            `2026-09-11-boarding-manual-advance-design.md`) — 관측이 끝난 뒤에만 수동 진행 수단.
            그 사이 실제로 타 버렸으면 [다른 차량 선택] → 대기 국면 [이미 탔어요]가 탈출구다.
          */}
          {state.phase === "boarding" && (
            <div className="mt-1 flex flex-wrap gap-2">
              {guide.boardingManualAvailable && (
                <button
                  type="button"
                  onClick={guide.confirmBoarded}
                  className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
                >
                  {leg.mode === "subway" ? t("boardSelected") : t("boardSelectedBus")}
                </button>
              )}
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
                // 마지막 leg + 말미 도보(E34): 버튼 하나, 라벨이 처음부터 "남은 도보 안내 시작" — 한 번 누르면
                // leg 종료와 도보 시작(아래 DistanceBeacon autoStart)이 함께. 그 밖은 종전 [다음 구간].
                <button
                  type="button"
                  onClick={handoffNow ? () => guide.advanceIntoWalkHandoff() : guide.advance}
                  className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
                >
                  {handoffNow ? t("walkHandoffStart") : t("advance")}
                </button>
              )}
              {state.phase === "riding" &&
                leg.trackMode !== "tagoBus" &&
                !guide.reboardPickerActive && (
                  <button
                    type="button"
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
            // 승차 중 탑승 변경(A16 L3): 하차역이면 도착 선언(A37 ②), 그 밖은 그 역 기준 재선택.
            <StationPicker
              prompt={t("reboardStationPrompt")}
              promptRef={reboardPromptRef}
              leg={leg}
              isEn={isEn}
              onPick={(index) =>
                index === leg.viaStops.length - 1 ? guide.declareArrived() : guide.changeBoardingAt(index)
              }
              onCancel={() => {
                guide.cancelReboard();
                // 취소도 착지는 상태 문장이다(E38). 픽커 언마운트로 커서가 body로 떨어진 뒤에
                // 대입해야 하므로 리렌더 다음 프레임에서 잡는다.
                requestAnimationFrame(() => statusRef.current?.focus());
              }}
              cancelLabel={t("reboardCancel")}
            />
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
        // E34: 마지막 leg의 버튼을 이미 눌렀으므로 도보 세션은 마운트 즉시 시작(autoStart). 트리거는 시작 뒤
        // "중지"가 되고 마운트 착지는 그 버튼(사라진 컨트롤 대신 다음 행동, 헌장 §5).
        <DistanceBeacon
          dest={dest}
          kind="walk"
          accessible={walkAccessible}
          announce={announce}
          autoStart
          focusTriggerOnMount
          triggerLabel={t("walkHandoffStart")}
        />
      )}
    </div>
  );
}

/**
 * 역 선택 화면 — 두 흐름이 재사용한다: 승차 중 탑승 변경(A16 L3, "지금 어느 역에 계신가요?")과 "이미 탑승"
 * (A34 ②, "지금 어느 역을 지나고 계신가요?"). 질문·선택 응답만 다르고 행·취소·착지(heading)는 같다. 위치가
 * 아니라 목록인 근거(위원장 판정): 지하철 안에서는 GPS가 잡히지 않는다. ⚠ 버튼으로 펼친 것이라 region이
 * 아니라 heading이 발견 경로다(헌장 §3).
 */
function StationPicker({
  prompt,
  promptRef,
  leg,
  isEn,
  onPick,
  onCancel,
  cancelLabel,
}: {
  prompt: string;
  promptRef: React.RefObject<HTMLHeadingElement | null>;
  leg: TransitGuideLeg;
  isEn: boolean;
  onPick: (index: number) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  return (
    <div className="mt-2">
      <h4 ref={promptRef} tabIndex={-1} className="text-sm font-medium">
        {prompt}
      </h4>
      <ul className="mt-1 flex flex-wrap gap-2">
        {transitDisplayLeg(leg, null).stops.map((stop, index) => {
          // ⚠ **라벨은 표시(en 가능)이고 값은 인덱스**다 — 조회 쿼리는 훅이 인덱스로
          // viaStops의 한국어 원문을 되찾는다(조인/표시 분리, spec §3.5·§3.6).
          const label = stop.en ?? stop.ko;
          return (
            <li key={`${index}-${stop.ko}`}>
              <button
                type="button"
                onClick={() => onPick(index)}
                className="min-h-11 rounded-md border border-gray-400 px-3 text-sm"
                // 한국어 라벨일 때만 ko 태그 — 영문 라벨에 붙이면 영어를 한국어 엔진이 읽는다.
                lang={isEn && !stop.en ? "ko" : undefined}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 min-h-11 rounded-md border border-gray-400 px-3 text-sm"
      >
        {cancelLabel}
      </button>
    </div>
  );
}
