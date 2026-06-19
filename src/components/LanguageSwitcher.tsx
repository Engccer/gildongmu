"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { withQuery } from "@/lib/locale-href";

/**
 * 언어 선택기 — 버튼을 눌러 펼치는 disclosure 메뉴로 5개 언어(ko/en/es/fr/it)를
 * 전환한다. 현재 경로와 ?q= 쿼리를 보존하며, next-intl 미들웨어가 로케일 프리픽스
 * 네비게이션 시 NEXT_LOCALE 쿠키를 설정하므로 고른 언어는 재방문 시 유지된다.
 *
 * 접근성(미니멀): role="menu"의 화살표 키 모델 대신 disclosure 패턴 —
 * 트리거 버튼 aria-expanded + 일반 링크 목록(네이티브 Tab 순회). Esc로 닫고
 * 버튼으로 포커스 복귀, 포인터/포커스가 컨테이너를 벗어나면 자동으로 닫는다.
 * 각 옵션은 자국어로 표기하고 해당 lang 태그를 줘 SR이 올바른 음성 엔진으로 읽게 한다.
 */
const LABEL_KEY: Record<string, string> = {
  ko: "korean",
  en: "english",
  es: "spanish",
  fr: "french",
  it: "italian",
};

/**
 * location.search를 외부 스토어로 구독한다. 서버 스냅샷은 빈 문자열이라
 * SSG 프리렌더 href와 첫 클라이언트 페인트가 일치하고(hydration mismatch 방지),
 * 마운트 후 클라이언트 스냅샷이 실제 ?q= 쿼리를 반영한다.
 */
function subscribeSearch(callback: () => void) {
  // popstate(백/포워드)와 함께, PlaceSearch가 replaceState로 ?q=를 갱신할 때
  // 발화하는 커스텀 이벤트도 구독 — 검색 직후 언어 링크 href가 새 ?q=를 즉시
  // 반영한다(replaceState는 popstate를 발화하지 않으므로 필요).
  window.addEventListener("popstate", callback);
  window.addEventListener("gildongmu:locationchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("gildongmu:locationchange", callback);
  };
}
function getSearchSnapshot() {
  return window.location.search;
}
function getServerSearchSnapshot() {
  return "";
}

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const active = useLocale();
  const pathname = usePathname();
  const search = useSyncExternalStore(
    subscribeSearch,
    getSearchSnapshot,
    getServerSearchSnapshot,
  );
  const href = withQuery(pathname, search);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // 포인터/포커스가 컨테이너를 벗어나면 닫는다(외부 클릭·Tab 이탈 모두 처리).
  useEffect(() => {
    if (!open) return;
    function onOutside(e: Event) {
      const node = containerRef.current;
      if (node && !node.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  // Esc로 닫고 버튼으로 포커스 복귀(메뉴 항목에 포커스가 있을 때 맥락 유지).
  const closeAndFocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key === "Escape") closeAndFocus();
  }

  const activeLabel = t(LABEL_KEY[active] ?? "english");

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium"
      >
        <span lang={active}>{activeLabel}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>

      {open && (
        <ul
          id={menuId}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-20 mt-1 min-w-40 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {routing.locales.map((loc) => {
            const isActive = loc === active;
            return (
              <li key={loc}>
                <Link
                  href={href}
                  locale={loc}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center justify-between gap-3 rounded px-3 text-sm aria-[current]:font-semibold hover:bg-accent/10"
                >
                  <span lang={loc}>{t(LABEL_KEY[loc])}</span>
                  {isActive && (
                    <Check aria-hidden="true" className="h-4 w-4 text-accent" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
