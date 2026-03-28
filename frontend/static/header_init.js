// /static/header_init.js
(function () {
  "use strict";

  const HEADER_MOUNT = "#headerMount";
  const HEADER_URL = "/view/header.html";

  const $ = (sel, el = document) => el.querySelector(sel);

  async function fetchSession() {
    try {
      const r = await fetch("/api/session", { credentials: "include", cache: "no-store" });
      if (!r.ok) return { loggedIn: false, admin: false, roleId: null };
      const body = await r.json();
      return {
        loggedIn: !!body.logged_in,
        admin: !!body.admin_in,
        roleId: body.role_id ?? null, // 없어도 무해
      };
    } catch (_) {
      return { loggedIn: false, admin: false, roleId: null };
    }
  }

  function backupDisplayOnce(els) {
    els.forEach((el) => {
      if (!el || !el.dataset) return;
      if (!el.dataset.tsDisplayBackup) {
        const d = getComputedStyle(el).display;
        el.dataset.tsDisplayBackup = d === "none" ? "" : d;
      }
    });
  }

  function setVisible(els, visible) {
    els.forEach((el) => {
      if (!el) return;
      if (visible) {
        el.style.display = el.dataset.tsDisplayBackup || "";
        el.removeAttribute("hidden");
      } else {
        el.style.display = "none";
        el.setAttribute("hidden", "true");
      }
    });
  }

  async function syncAuthArea() {
    const s = await fetchSession();

    const authIn = Array.from(document.querySelectorAll(".js-auth-in"));
    const authOut = Array.from(document.querySelectorAll(".js-auth-out"));

    // ✅ 문법 오류 수정 (변수 배열 전달)
    backupDisplayOnce([...authIn, ...authOut]);

    setVisible(authIn, s.loggedIn);
    setVisible(authOut, !s.loggedIn);

    // (선택) 사이드바 브릿지
    window.SidebarRoleBridge?.setAuth?.({ loggedIn: s.loggedIn, roleId: s.roleId });
    window.dispatchEvent(new CustomEvent("app:auth", { detail: { loggedIn: s.loggedIn, roleId: s.roleId } }));
  }

  function bindLogout() {
    const btn = $("#btnLogout");
    if (!btn) return;

    btn.addEventListener(
      "click",
      () => {
        try {
          localStorage.removeItem("access_token");
          localStorage.removeItem("user_id");
        } catch (_) {}

        // UI 즉시 비로그인 처리(깜빡임 방지)
        const authIn = Array.from(document.querySelectorAll(".js-auth-in"));
        const authOut = Array.from(document.querySelectorAll(".js-auth-out"));
        backupDisplayOnce([...authIn, ...authOut]);
        setVisible(authIn, false);
        setVisible(authOut, true);
        // 실제 이동(/logout)은 a href가 처리
      },
      { capture: true }
    );
  }

  function setAuthPending(on) {
    const area = $("#authArea");
    if (!area) return;
    area.setAttribute("data-auth-pending", on ? "1" : "0");
  }

  async function mountHeader() {
    const mount = $(HEADER_MOUNT);
    if (!mount) return;

    try {
      const res = await fetch(HEADER_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      mount.innerHTML = await res.text();

      // pending 숨김 → 토글 후 노출
      setAuthPending(true);
      await syncAuthArea();
      bindLogout();
      setAuthPending(false);

      document.dispatchEvent(new CustomEvent("header:loaded"));
    } catch (err) {
      console.error("header mount failed:", err);
      setAuthPending(false);
    }
  }

  // 외부에서 강제 동기화 가능
  window.syncAuthArea = syncAuthArea;

  // DOMContentLoaded 이후 마운트
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountHeader);
  } else {
    mountHeader();
  }
})();
