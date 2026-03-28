(() => {
  // ====== keys (signup.html과 맞춰야 함) ======
  const TS_USERS_KEY = "ts_users";         // signup에서 저장하는 유저 목록
  const TS_SESSION_KEY = "ts_session";     // 로그인 세션(샘플)
  const SAVED_ID_KEY = "ts_saved_id_v1";   // 아이디 저장

  // 아이디별 실패/잠금 상태 저장
  // {
  //   "trendscope01": { count: 3, lockUntil: 0, lastFailAt: 1700000000000 }
  // }
  const FAIL_MAP_KEY = "ts_login_fail_map_v1";

  const MAX_FAIL = 5;
  const LOCK_MS = 1000 * 60 * 60 * 24; // 24h

  // ====== DOM ======
  const form = document.getElementById("loginForm");
  const idEl = document.getElementById("tsId");
  const pwEl = document.getElementById("tsPw");
  const btn = document.getElementById("tsLoginBtn");
  const rememberEl = document.getElementById("tsRemember");

  const group = document.getElementById("tsGroup");
  const errBox = document.getElementById("tsErrorMsg");
  const cntEl = document.getElementById("tsFailCount");

  const lockLayer = document.getElementById("tsLockLayer");
  const lockBtn = document.getElementById("tsLockBtn");

  // ====== storage helpers ======
  function safeJsonParse(s, fallback){
    try { return JSON.parse(s); } catch { return fallback; }
  }
  function loadUsers(){
    return safeJsonParse(localStorage.getItem(TS_USERS_KEY) || "[]", []);
  }
  function setSession(name, memberId){
    localStorage.setItem(TS_SESSION_KEY, JSON.stringify({
      name: name || "사용자",
      memberId: memberId || "",
      ts: Date.now()
    }));
  }
  function loadFailMap(){
    return safeJsonParse(localStorage.getItem(FAIL_MAP_KEY) || "{}", {});
  }
  function saveFailMap(map){
    localStorage.setItem(FAIL_MAP_KEY, JSON.stringify(map));
  }

  // ====== crypto (signup과 동일) ======
  async function sha256(str){
    if (window.crypto && crypto.subtle) {
      const buf = new TextEncoder().encode(str);
      const hash = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
    }
    return "plain:" + str; // 구형 브라우저 fallback
  }

  // ====== UI ======
  function toggleBtn(){
    const ok = (idEl.value || "").trim().length > 0 && (pwEl.value || "").trim().length > 0;
    btn.disabled = !ok;
    btn.style.cursor = ok ? "pointer" : "not-allowed";
    btn.style.background = ok ? "#0462D2" : "#d1d5db";
  }

  function focusOn(){ group.classList.add("isFocus"); }
  function focusOff(){
    const ae = document.activeElement;
    if (ae !== idEl && ae !== pwEl) group.classList.remove("isFocus");
  }

  function showFailMessage(count){
    if (!errBox || !cntEl) return;
    errBox.style.display = "block";
    cntEl.textContent = `(${count}/${MAX_FAIL})`;
    group.classList.add("isError");
  }
  function hideFailMessage(){
    if (errBox) errBox.style.display = "none";
    group.classList.remove("isError");
  }

  function openLockModal(){
    if (!lockLayer) return;
    lockLayer.style.display = "flex";
    lockLayer.setAttribute("aria-hidden", "false");
  }
  function closeLockModal(){
    if (!lockLayer) return;
    lockLayer.style.display = "none";
    lockLayer.setAttribute("aria-hidden", "true");
  }

  // ====== lock logic (아이디별) ======
  function now(){ return Date.now(); }

  // 만료된 잠금이면 자동 초기화(요구사항: 24h 지나면 count=5여도 로그인 가능)
  function normalizeFailStateForId(memberId){
    const map = loadFailMap();
    const st = map[memberId];
    if (!st) return { map, st: { count:0, lockUntil:0, lastFailAt:0 } };

    if (st.lockUntil && now() >= st.lockUntil){
      map[memberId] = { count: 0, lockUntil: 0, lastFailAt: 0 };
      saveFailMap(map);
      return { map, st: map[memberId] };
    }
    return { map, st };
  }

  function isLocked(memberId){
    const { st } = normalizeFailStateForId(memberId);
    return !!(st.lockUntil && now() < st.lockUntil);
  }

  function bumpFail(memberId){
    const { map, st } = normalizeFailStateForId(memberId);

    const nextCount = Math.min((st.count || 0) + 1, MAX_FAIL);
    const next = {
      count: nextCount,
      lastFailAt: now(),
      lockUntil: st.lockUntil || 0
    };

    // 5회 도달 순간: 24h 잠금 시작
    if (nextCount >= MAX_FAIL) {
      next.lockUntil = now() + LOCK_MS;
    }

    map[memberId] = next;
    saveFailMap(map);

    return next;
  }

  function resetFail(memberId){
    const map = loadFailMap();
    map[memberId] = { count: 0, lockUntil: 0, lastFailAt: 0 };
    saveFailMap(map);
  }

  // ====== remember id ======
  function loadSavedId(){
    const saved = (localStorage.getItem(SAVED_ID_KEY) || "").trim();
    if (saved) {
      idEl.value = saved;
      rememberEl.checked = true;
    }
  }
  function applyRememberId(){
    if (rememberEl.checked) {
      localStorage.setItem(SAVED_ID_KEY, (idEl.value || "").trim());
    } else {
      localStorage.removeItem(SAVED_ID_KEY);
    }
  }

  // ====== events ======
  function onTyping(){
    toggleBtn();
    hideFailMessage();
  }

  idEl.addEventListener("input", () => { onTyping(); applyRememberId(); });
  pwEl.addEventListener("input", onTyping);

  idEl.addEventListener("focus", focusOn);
  pwEl.addEventListener("focus", focusOn);
  idEl.addEventListener("blur", focusOff);
  pwEl.addEventListener("blur", focusOff);

  rememberEl.addEventListener("change", applyRememberId);

  if (lockBtn) lockBtn.addEventListener("click", closeLockModal);

 // ====== login submit ======
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  hideFailMessage();
  const memberId = (idEl.value || "").trim();
  const passwd = (pwEl.value || "").trim();

  if (!memberId || !passwd) {
    return;
  }
  btn.disabled = true

  try {

    const res = await fetch("/login_check", {
      method: "POST",
      credentials: "include",
      headers: {
        "Accept": "application/json"
      },
      body: new URLSearchParams({
        user_id: memberId,
        pw: passwd
      })
    });

    if (!res.ok) {
      showFailMessage(0);
      return;
    }

    const body = await res.json();

    if (body.success) {
      location.href = "/";
      return;
    }

    const failCount = body.count ?? 0;

    showFailMessage(failCount);

    if (failCount >= MAX_FAIL) {
      openLockModal();
    }

  } catch (err) {
    showFailMessage(0);
  }
});

  // ====== boot ======
  loadSavedId();
  toggleBtn();

  // 페이지 로드시: 이미 잠금(24h 내)인 아이디를 입력해두면, UX상 카운트 배지 정도는 보여줄 수 있음(선택)
  // 여기서는 입력 중에만 처리하고, 강제 팝업은 submit에서만 띄움.
})();