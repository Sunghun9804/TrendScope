// /static/sidebar_init.js
// (최종 안정 버전: active 동기화 + main 해시 스크롤 + 로그인 필요 모달을 body로 이동)

(function () {
  const SIDEBAR = "#sidebarMount";
  const LINK_SEL = `${SIDEBAR} .menu a`;
  const LI_SEL = `${SIDEBAR} .menu li`;

  function fileName(pathname) {
    return (pathname.split("/").pop() || "").split("?")[0];
  }

  function clearActive() {
    document.querySelectorAll(LI_SEL).forEach(li => li.classList.remove("active"));
  }

  function setActiveByLink(a) {
    clearActive();
    a?.closest("li")?.classList.add("active");
  }

  function getLinks() {
    return Array.from(document.querySelectorAll(LINK_SEL));
  }

  function findMainTopLink(links) {
    return links.find(a => {
      const href = (a.getAttribute("href") || "").trim();
      if (!href) return false;
      const u = new URL(href, location.href);
      return fileName(u.pathname) === "main.html" && !u.hash;
    });
  }

  function findHashLink(links, hash) {
    return links.find(a => {
      const href = (a.getAttribute("href") || "").trim();
      if (!href) return false;
      const u = new URL(href, location.href);
      return u.hash === hash;
    });
  }

  function findFileLink(links, file) {
    return links.find(a => {
      const href = (a.getAttribute("href") || "").trim();
      if (!href) return false;
      const u = new URL(href, location.href);
      return fileName(u.pathname) === file;
    });
  }

  function getScroller() {
    return document.querySelector(".main-scroll");
  }

  function getOffset() {
    const toolbar = document.querySelector(".main-toolbar");
    return (toolbar?.offsetHeight || 0) + 12;
  }

  function scrollToId(id, smooth) {
    const scroller = getScroller();
    const target = id ? document.getElementById(id) : null;
    if (!scroller || !target) return false;

    const top =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;

    scroller.scrollTo({
      top: Math.max(0, top - getOffset()),
      behavior: smooth ? "smooth" : "auto",
    });
    return true;
  }

  function scrollToTop(smooth) {
    const scroller = getScroller();
    if (!scroller) return false;
    scroller.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    return true;
  }

  // ✅ 라우트(URL) 이름을 메뉴 파일명으로 매핑
  const FILE_ALIAS = {
    "main": "main.html",
    "my_page": "my_page.html",
    "info_edit": "my_page.html",
    "info_edit.html": "my_page.html",
  };

  function setActiveFromLocation() {
    const links = getLinks();
    if (!links.length) return;

    let file = fileName(location.pathname);          // ✅ let 이어야 재할당 가능
    const hash = (location.hash || "").trim();

    file = FILE_ALIAS[file] || file;

    // 확장자 없는 라우트면 .html도 한 번 붙여서 시도
    const fileTry = file.includes(".") ? file : (file + ".html");

    if (file === "main.html" || fileTry === "main.html") {
      if (hash) {
        const a = findHashLink(links, hash);
        if (a) return setActiveByLink(a);
      }
      const top = findMainTopLink(links);
      if (top) return setActiveByLink(top);
      return setActiveByLink(links[0]);
    }

    let a = findFileLink(links, file);
    if (!a) a = findFileLink(links, fileTry);

    if (a) return setActiveByLink(a);
    setActiveByLink(links[0]);
  }

  function syncContainerToHash(smooth) {
    const cur = fileName(location.pathname);
    const cur2 = FILE_ALIAS[cur] || cur;
    if (cur2 !== "main.html") return;

    const hash = (location.hash || "").trim();
    if (!hash) return scrollToTop(false);

    const id = hash.slice(1);
    scrollToId(id, smooth);
  }

  function bindClicks() {
    const links = getLinks();
    if (!links.length) return;

    links.forEach(a => {
      a.addEventListener("click", (e) => {
        const href = (a.getAttribute("href") || "").trim();
        if (!href) return;

        const url = new URL(href, location.href);
        const samePage = url.pathname === location.pathname;
        const file = fileName(url.pathname);
        const hash = (url.hash || "").trim();

        // 같은 main.html 안에서만 “컨테이너 스크롤”로 가로채기
        if (samePage && file === "main.html") {
          const scroller = getScroller();
          if (!scroller) return;

          // main.html(해시 없음) -> top
          if (!hash) {
            e.preventDefault();
            setActiveByLink(a);
            scrollToTop(true);
            history.pushState(null, "", location.pathname);
            return;
          }

          // main.html#main2/#main3 -> 해당 섹션
          const id = hash.slice(1);
          if (document.getElementById(id)) {
            e.preventDefault();
            setActiveByLink(a);
            scrollToId(id, true);
            history.pushState(null, "", location.pathname + hash);
            return;
          }
        }
      });
    });
  }

  function bindObserver() {
    const scroller = getScroller();
    if (!scroller) return;

    const cur = fileName(location.pathname);
    const cur2 = FILE_ALIAS[cur] || cur;
    if (cur2 !== "main.html") return;

    const links = getLinks();
    const sections = ["main1", "main2", "main3"]
      .map(id => document.getElementById(id))
      .filter(Boolean);

    if (!sections.length) return;

    const linkFor = (id) => {
      if (id === "main1") return findMainTopLink(links);
      return findHashLink(links, `#${id}`);
    };

    const io = new IntersectionObserver((entries) => {
      const v = entries
        .filter(en => en.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!v) return;

      const id = v.target.id || "main1";
      const a = linkFor(id);
      if (a) setActiveByLink(a);
    }, {
      root: scroller,
      threshold: [0.2, 0.4, 0.6],
      rootMargin: `-${getOffset()}px 0px -60% 0px`,
    });

    sections.forEach(s => io.observe(s));
  }

  // sidebar.js가 mount 후 호출
  window.__initSidebarAndAnchors = function () {
    const root = document.querySelector(SIDEBAR);
    if (!root) return;

    if (root.dataset.sidebarInited === "1") return;
    root.dataset.sidebarInited = "1";

    setActiveFromLocation();
    bindClicks();
    bindObserver();

    // “처음 진입 해시” 처리(레이아웃 안정화 후)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncContainerToHash(false);
      });
    });

    window.addEventListener("popstate", () => {
      setActiveFromLocation();
      syncContainerToHash(true);
    });

    window.addEventListener("hashchange", () => {
      setActiveFromLocation();
      syncContainerToHash(true);
    });
  };
})();


// ✅ 로그인 필요 링크(단어사전/마이페이지) 클릭 시 모달
window.__initRequireLoginModal = function () {
  const SIDEBAR = "#sidebarMount";
  const root = document.querySelector(SIDEBAR);
  if (!root) return;

  const layer = document.getElementById("tsNeedLoginLayer");
  if (!layer) return;

  // ✅ 반드시 body로 이동(헤더 포함 전체를 덮기 위해)
  if (layer.parentElement !== document.body) {
    document.body.appendChild(layer);
  }
  // 헤더보다 위로
  layer.style.zIndex = "99999";

  if (root.dataset.requireLoginInited === "1") return;
  root.dataset.requireLoginInited = "1";

  const AUTH_CHECK_URL = "/my_page_load/data";

  async function isLoggedInAsync() {
    try {
      const res = await fetch(AUTH_CHECK_URL, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Accept": "application/json" },
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) return false;

      const json = await res.json().catch(() => ({}));

      if (json.success === true) return true;

      // success=false여도 메시지가 "로그인"이 아니면(예: 비번확인 필요) 로그인으로 취급
      const msg = String(json.message || json.msg || "");
      if (msg.includes("로그인")) return false;

      return true;
    } catch {
      return false;
    }
  }

  const btnCancel = document.getElementById("tsNeedLoginCancel");
  const btnGo = document.getElementById("tsNeedLoginGo");

  const guardedLinks = Array.from(
    root.querySelectorAll('a[data-require-login="true"], a[data-require-login]')
  );

  let pendingHref = "";
  const prevOverflow = { html: "", body: "" };

  function openModal(nextHref) {
    pendingHref = nextHref || "";
    layer.setAttribute("aria-hidden", "false");

    prevOverflow.html = document.documentElement.style.overflow || "";
    prevOverflow.body = document.body.style.overflow || "";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeydown);
    setTimeout(() => (btnGo || btnCancel)?.focus?.(), 0);
  }

  function closeModal() {
    layer.setAttribute("aria-hidden", "true");

    document.documentElement.style.overflow = prevOverflow.html;
    document.body.style.overflow = prevOverflow.body;

    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }

  layer.addEventListener("click", (e) => {
    if (e.target === layer) closeModal();
  });

  btnCancel?.addEventListener("click", closeModal);

  btnGo?.addEventListener("click", () => {
    const base = location.pathname.includes("/view/") ? "/view/login.html" : "/login.html";
    const loginUrl = new URL(base, location.origin);
    const returnTo = pendingHref || (location.pathname + location.search + location.hash);
    loginUrl.searchParams.set("returnTo", returnTo);
    location.href = loginUrl.toString();
  });

  guardedLinks.forEach((a) => {
    a.addEventListener("click", async (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;

      e.preventDefault();
      const href = a.getAttribute("href") || "";

      const ok = await isLoggedInAsync();
      if (ok) {
        location.href = new URL(href, location.href).toString();
      } else {
        openModal(href);
      }
    });
  });

  closeModal();
};

// ==============================
// Role 기반 메뉴 토글 (base.js 수정 없이)
// - /api/session 직접 조회
// - fetch 겹침 방지(inFlight) + 레이스 방지(seq)
// - 네트워크/일시 오류 시 "로그아웃 처리로 덮어쓰기" 하지 않고 기존 상태 유지
// - sidebar async mount 대응(MutationObserver)
// ==============================
(function () {
  const SIDEBAR_ROOT = "#sidebarMount";
  const ADMIN_SELECTOR = ".admin-only, [data-require-admin='true']";

  let authState = { loggedIn: false, isAdmin: false, roleId: null, loaded: false };

  let inflight = null;
  let seq = 0;

  function applyRoleMenu() {
    const root = document.querySelector(SIDEBAR_ROOT);
    if (!root) return;

    const adminNodes = root.querySelectorAll(ADMIN_SELECTOR);
    if (!adminNodes.length) return;

    // 기본 숨김
    adminNodes.forEach(el => el.classList.add("ts-is-hidden"));

    // 관리자면 노출
    if (authState.loggedIn && authState.isAdmin === true) {
      adminNodes.forEach(el => el.classList.remove("ts-is-hidden"));
    }
  }

  function setAuth(next) {
    authState.loggedIn = !!next?.loggedIn;
    authState.isAdmin  = !!next?.isAdmin;
    authState.roleId   = (next?.roleId ?? null);
    authState.loaded   = true;
    applyRoleMenu();
  }

  async function refreshAuth({ force = false } = {}) {
    if (inflight && !force) return inflight;

    const mySeq = ++seq;

    inflight = (async () => {
      try {
        const res = await fetch("/api/session", {
          credentials: "include",
          cache: "no-store",
          headers: { "Accept": "application/json" },
        });

        // 명확히 비로그인/권한없음이면 그때만 로그아웃 처리
        if (res.status === 401 || res.status === 403) {
          if (mySeq === seq) setAuth({ loggedIn: false, isAdmin: false, roleId: null });
          return;
        }

        if (!res.ok) throw new Error("session fetch failed: " + res.status);

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("application/json")) throw new Error("session not json");

        const body = await res.json().catch(() => ({}));

        if (mySeq !== seq) return; // 레이스 방지(늦게 온 응답 무시)

        const loggedIn = !!body.logged_in;
        const isAdmin  = loggedIn && !!body.admin_in; // base.js와 동일
        const roleId   = body.role_id ?? null;

        setAuth({ loggedIn, isAdmin, roleId });
      } catch (e) {
        // ✅ 여기 핵심: 일시 오류면 기존 authState 유지(숨기지 않음)
        authState.loaded = true;
        applyRoleMenu();

        // 필요하면 가벼운 재시도 1회 (과도한 요청 방지)
        setTimeout(() => {
          if (mySeq === seq) refreshAuth({ force: true });
        }, 800);
      }
    })().finally(() => {
      // 현재 요청이 최신 seq일 때만 inflight 해제
      if (mySeq === seq) inflight = null;
    });

    return inflight;
  }

  function observeSidebarMount() {
    const attach = (mount) => {
      if (!mount || mount.dataset.roleObsBound === "1") return;
      mount.dataset.roleObsBound = "1";

      const mo = new MutationObserver(() => applyRoleMenu());
      mo.observe(mount, { childList: true, subtree: true });
    };

    const mount = document.querySelector(SIDEBAR_ROOT);
    if (mount) {
      attach(mount);
      return;
    }

    const bodyObs = new MutationObserver(() => {
      const m = document.querySelector(SIDEBAR_ROOT);
      if (m) {
        attach(m);
        bodyObs.disconnect();
      }
    });
    bodyObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 외부에서 필요 시 호출 가능
  window.SidebarRoleBridge = {
    refresh: (opts) => refreshAuth({ force: true, ...(opts || {}) }),
    apply: applyRoleMenu,
  };

  observeSidebarMount();

  // 최초 1회 + (세션 반영 지연 대비) 짧은 후속 1회
  refreshAuth();
  setTimeout(() => refreshAuth({ force: true }), 300);

  // 탭 복귀 시 갱신(중복 방지됨: inflight/seq)
  window.addEventListener("focus", () => refreshAuth());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAuth();
  });
})();


// ==============================
// Mobile sidebar toggle (hamburger + backdrop + X close)
// 여러 번 호출돼도 안전(idempotent)하게 설계
// ==============================
(function () {
  function $(sel, el = document) { return el.querySelector(sel); }

  function ensureBackdrop() {
    let b = $("#tsSidebarBackdrop");
    if (!b) {
      b = document.createElement("div");
      b.id = "tsSidebarBackdrop";
      b.className = "tsSidebarBackdrop";
      document.body.appendChild(b);
    }
    return b;
  }

  function ensureHamburgerButton() {
    let btn = document.querySelector("#btnSidebarToggle");

    // 지금은 header.html이 #headerMount 안에 들어오니까 그 케이스까지 커버
    const headerInner =
      document.querySelector("#headerMount header .header-inner") ||
      document.querySelector("#headerMount header .topbar__inner") ||
      document.querySelector("header .header-inner") ||
      document.querySelector("header .topbar__inner");

    // 없으면 생성
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnSidebarToggle";
      btn.className = "tsHamburger";
      btn.type = "button";
      btn.setAttribute("aria-label", "메뉴 열기");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = "<span></span><span></span><span></span>";
    }

    // 헤더가 있으면: 무조건 헤더 안으로 “이동”
    if (headerInner) {
      const brand = headerInner.querySelector(".brand");

      if (!headerInner.contains(btn)) {
        // fallback으로 줬던 fixed 인라인 스타일 제거
        btn.style.position = "";
        btn.style.top = "";
        btn.style.right = "";
        btn.style.zIndex = "";
        btn.style.display = "";

        if (brand) headerInner.insertBefore(btn, brand);
        else headerInner.prepend(btn);
      }
      return btn;
    }

    // 아직 헤더가 없으면: body fixed로 임시 배치
    if (!btn.isConnected) document.body.appendChild(btn);

    btn.style.position = "fixed";
    btn.style.top = "12px";
    btn.style.right = "12px";
    btn.style.zIndex = "100000";
    btn.style.display = "inline-flex";

    return btn;
  }


  function ensureSidebarCloseButton(sidebar) {
    // 이미 있으면 재사용
    let btn = sidebar.querySelector("#btnSidebarClose");
    if (btn) return btn;

    // 상단바 + X 버튼 생성
    const top = document.createElement("div");
    top.className = "tsSidebarTop";
    top.innerHTML = `
      <button id="btnSidebarClose" class="tsSidebarClose" type="button" aria-label="메뉴 닫기">×</button>
    `;

    const menu = sidebar.querySelector(".menu");
    if (menu) sidebar.insertBefore(top, menu);
    else sidebar.prepend(top);

    return top.querySelector("#btnSidebarClose");
  }

  function openSidebar() {
    const sidebar = $("#sidebarMount");
    const backdrop = $("#tsSidebarBackdrop");
    const btnToggle = $("#btnSidebarToggle");
    if (!sidebar || !backdrop || !btnToggle) return;

    sidebar.classList.add("is-open");
    backdrop.classList.add("is-open");
    btnToggle.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    const sidebar = $("#sidebarMount");
    const backdrop = $("#tsSidebarBackdrop");
    const btnToggle = $("#btnSidebarToggle");
    if (!sidebar || !backdrop || !btnToggle) return;

    sidebar.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    btnToggle.setAttribute("aria-expanded", "false");
  }

  function toggleSidebar() {
    const sidebar = $("#sidebarMount");
    if (!sidebar) return;
    sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar();
  }

  function initMobileSidebarToggle() {
    const sidebar = $("#sidebarMount");
    if (!sidebar) return;

    const backdrop = ensureBackdrop();
    const btnToggle = ensureHamburgerButton();
    const btnClose = ensureSidebarCloseButton(sidebar);

    // ✅ 이벤트 중복 바인딩 방지 (버튼/백드롭 각각에 표시)
    if (btnToggle && btnToggle.dataset.bound !== "1") {
      btnToggle.dataset.bound = "1";
      btnToggle.addEventListener("click", (e) => { e.preventDefault(); toggleSidebar(); });
    }

    if (backdrop && backdrop.dataset.bound !== "1") {
      backdrop.dataset.bound = "1";
      backdrop.addEventListener("click", closeSidebar);
    }

    // ✅ X 버튼은 mount 때마다 새로 생길 수 있으니, onclick으로 "덮어쓰기" (중복 걱정 없음)
    if (btnClose) {
      btnClose.onclick = (e) => { e.preventDefault(); closeSidebar(); };
    }

    // ✅ 사이드바 메뉴 클릭 시 닫기: sidebar 요소에 1회만
    if (sidebar.dataset.menuCloseBound !== "1") {
      sidebar.dataset.menuCloseBound = "1";
      sidebar.addEventListener("click", (e) => {
        const a = e.target.closest("a");
        if (a) closeSidebar();
      }, true);
    }

    // ✅ ESC / resize는 document/window에 1회만
    if (document.documentElement.dataset.sidebarKeyBound !== "1") {
      document.documentElement.dataset.sidebarKeyBound = "1";
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSidebar(); }, { passive: true });
    }

    if (window.__tsSidebarResizeBound !== true) {
      window.__tsSidebarResizeBound = true;
      window.addEventListener("resize", () => { if (window.innerWidth > 1100) closeSidebar(); }, { passive: true });
    }

    // 초기 상태 닫기
    closeSidebar();
  }

  // sidebar.js에서 mount 직후 호출할 수 있게 공개
  window.__initMobileSidebarToggle = initMobileSidebarToggle;

  // 혹시 mount가 이미 끝난 페이지면 한 번 실행
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileSidebarToggle); // DOMContentLoaded 동작 
  } else {
    initMobileSidebarToggle();
  }
})();

document.addEventListener("header:loaded", () => {
  window.__initMobileSidebarToggle?.();
});