(function () {
  const authInEls  = document.querySelectorAll(".js-auth-in");   // 로그인 상태 UI (로그아웃 등)
  const authOutEls = document.querySelectorAll(".js-auth-out");  // 비로그인 상태 UI (로그인, 회원가입)
  const authMenu = document.querySelectorAll(".js-auth-menu");
  if (!authInEls.length && !authOutEls.length && !authMenu) return;

  // 최초 한 번, 원래 display 값을 백업해 둔다.
  const allAuthEls = [...authInEls, ...authOutEls, ...authMenu];
  allAuthEls.forEach(el => {
    if (!el.dataset.tsDisplayBackup) {
      const d = getComputedStyle(el).display;
      // 원래 display가 none이면 빈 문자열로 두고, 나중에 브라우저 기본값 쓰게 함
      el.dataset.tsDisplayBackup = (d === "none" ? "" : d);
    }
  });

  function setVisible(list, visible) {
    list.forEach(el => {
      if (visible) {
        // 원래 display로 되돌리기
        el.style.display = el.dataset.tsDisplayBackup || "";
        el.removeAttribute("hidden");
      } else {
        // 어떤 CSS보다 강하게 inline 스타일로 숨기기
        el.style.display = "none";
        el.setAttribute("hidden", "true");
      }
    });
  }

  function setUI(loggedIn) {
    // loggedIn === true  → in 보이고 out 숨김  → 로그아웃만 보이게
    // loggedIn === false → out 보이고 in 숨김  → 로그인/회원가입 보이게
    setVisible(authInEls,  loggedIn);
    setVisible(authOutEls, !loggedIn);
  }

  function setMenu(roleAdmin) {
    setVisible(authMenu, roleAdmin);
  }
  // 기본값: 로그아웃 상태 UI
  setUI(false);
  setMenu(false);

  fetch("/api/session", { credentials: "include" })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(body => {
      const loggedIn = !!body.logged_in;
      const isAdmin  = loggedIn && !!body.admin_in;

      setUI(loggedIn);
      setMenu(isAdmin);
    })
    .catch(() => {setUI(false); setMenu(false);});
})();