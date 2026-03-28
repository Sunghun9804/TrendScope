(function () {
  "use strict";


  // ===== util =====
  const $ = (sel, el = document) => el.querySelector(sel);

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function toDateNum(iso) {
    // "YYYY-MM-DD" -> YYYYMMDD number
    if (!iso) return 0;
    return Number(String(iso).replaceAll("-", ""));
  }

  function isoToYmd(iso) {
    // "YYYY-MM-DD" -> "YYYYMMDD"
    return String(iso || "").replaceAll("-", "");
  }

  function codeClass(code) {
    if (code >= 300 && code < 400) return "is-3xx";
    if (code >= 400 && code < 500) return "is-4xx";
    if (code >= 500) return "is-5xx";
    return "";
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("\n", " ");
  }

  // ===== API endpoints (same-origin) =====
  const API = {
    listRuns: "/admin/collection/runs",
    runDetail: (runId) => `/admin/collection/runs/${encodeURIComponent(runId)}`,
    rerun: (runId) => `/admin/collection/runs/${encodeURIComponent(runId)}/rerun`,
    progress: "/admin/collection/progress",
  };

  // ===== fetch wrapper (credentials + timeout) =====
  async function apiJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);

    const method = (opts && opts.method) ? opts.method : "GET";

    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        credentials: "include",
        headers: {
          ...(opts.headers || {}),
        },
      });

      // 401/403이면 관리자 세션 문제 → 로그인으로
      if (res.status === 401 || res.status === 403) {
        location.replace("/login");
        return null;
      }

      const ct = res.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const body = isJson ? await res.json() : await res.text();

      if (!res.ok) {
        const msg =
          (isJson && (body?.detail || body?.message)) ||
          (typeof body === "string" ? body : "") ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return body;
    } finally {
      clearTimeout(t);
    }
  }

  // ===== normalize (서버 응답 형태가 조금 달라도 UI가 받는 형태로 맞춤) =====
  function normalizeRun(raw) {
    if (!raw || typeof raw !== "object") return null;

    // 가능한 키 후보들
    const run_id = raw.run_id ?? raw.id ?? raw.runId ?? raw.runID;
    const job_name = raw.job_name ?? raw.job ?? raw.jobName ?? raw.name ?? "수집";
    const start_at = raw.start_at ?? raw.started_at ?? raw.startAt ?? raw.startedAt ?? raw.start_time ?? "";
    const end_at = raw.end_at ?? raw.ended_at ?? raw.endAt ?? raw.endedAt ?? raw.end_time ?? "";
    const work_at = raw.work_at ?? raw.workAt ?? raw.work_time ?? raw.workTime ?? raw.scheduled_at ?? "";
    const state_code = Number(raw.state_code ?? raw.status_code ?? raw.stateCode ?? raw.code ?? 0);
    const message = raw.message ?? raw.msg ?? raw.error ?? raw.summary ?? "";

    const detail =
      raw.detail ??
      raw.trace ??
      raw.stack ??
      raw.error_detail ??
      raw.errorDetail ??
      raw.log ??
      raw.raw ??
      "";

    return {
      run_id,
      job_name,
      start_at,
      end_at,
      work_at,
      state_code,
      message,
      detail,
    };
  }

  function pickListItems(payload) {
    // list payload가 {items:[]}, {runs:[]}, [] 등 아무거나 와도 대응
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return (
      payload.items ||
      payload.runs ||
      payload.data ||
      payload.rows ||
      payload.results ||
      payload.list ||
      []
    );
  }

  function pickNextCursor(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.next_cursor ?? payload.nextCursor ?? payload.cursor_next ?? payload.cursorNext ?? null;
  }

  async function fetchRunsPage({ startIso, endIso, cursor, limit }) {
    // 1차: ISO(YYYY-MM-DD)로 시도
    const qs1 = new URLSearchParams();
    if (startIso) qs1.set("start", startIso);
    if (endIso) qs1.set("end", endIso);
    if (cursor) qs1.set("cursor", cursor);
    if (limit) qs1.set("limit", String(limit));

    try {
      const payload = await apiJson(`${API.listRuns}?${qs1.toString()}`, { cache: "no-store" });
      const items = pickListItems(payload).map(normalizeRun).filter(Boolean);
      return { items, nextCursor: pickNextCursor(payload) };
    } catch (e1) {
      // 2차: YYYYMMDD로 fallback (서버가 숫자 날짜를 원할 수도 있어서)
      const qs2 = new URLSearchParams();
      if (startIso) qs2.set("start", isoToYmd(startIso));
      if (endIso) qs2.set("end", isoToYmd(endIso));
      if (cursor) qs2.set("cursor", cursor);
      if (limit) qs2.set("limit", String(limit));

      const payload = await apiJson(`${API.listRuns}?${qs2.toString()}`, { cache: "no-store" });
      const items = pickListItems(payload).map(normalizeRun).filter(Boolean);
      return { items, nextCursor: pickNextCursor(payload) };
    }
  }

  async function fetchRunDetail(runId) {
    const payload = await apiJson(API.runDetail(runId), { cache: "no-store" });
    // detail endpoint가 {item:{...}}로 줄 수도 있어서 대응
    const raw = payload?.item ?? payload?.data ?? payload;
    return normalizeRun(raw) || null;
  }

  function normalizeProgress(payload) {
    // {running:true, percent:30} or {pct:30} or {progress:0.3} 등 대응
    if (!payload || typeof payload !== "object") return { running: false, percent: 0, runId: null };

    const running =
      payload.running ??
      payload.is_running ??
      payload.isRunning ??
      payload.active ??
      payload.in_progress ??
      payload.inProgress ??
      false;

    let p =
      payload.percent ??
      payload.pct ??
      payload.percentage ??
      payload.progress ??
      payload.rate ??
      0;

    // progress가 0~1로 오면 0~100으로
    if (typeof p === "number" && p > 0 && p <= 1) p = p * 100;

    const runId = payload.run_id ?? payload.runId ?? payload.active_run_id ?? payload.activeRunId ?? null;

    return {
      running: !!running,
      percent: Math.max(0, Math.min(100, Math.round(Number(p) || 0))),
      runId,
    };
  }

  // =========================================================
  // UI state (cursor 기반 무한스크롤)
  // =========================================================
  const PAGE_SIZE = 20;

  let queryStartIso = null;
  let queryEndIso = null;

  let nextCursor = null;
  let loading = false;
  let done = false;

  // 현재 선택된(상세로 열어둔) 행 1건
  let selectedRun = null;

  // 진행률 pill
  let rerunRunning = false;
  let rerunPct = 0;
  let rerunTimer = null;
  let rerunJobId = null;
  let rerunActiveRunId = null;

  // ===== elements =====
  const startInput = $("#startDate");
  const endInput = $("#endDate");
  const btnSearch = $("#btnSearch");

  const tbody = $("#tbodyRuns");
  const tableBodyWrap = $("#tableBodyWrap");

  const infiniteLoader = $("#infiniteLoader");
  const infiniteLoaderText = $("#infiniteLoaderText");
  const emptyState = $("#emptyState");

  const detailModal = $("#detailModal");
  const detailMeta = $("#detailMeta");
  const detailMessage = $("#detailMessage");
  const btnCloseModal = $("#btnCloseModal");
  const btnRun = $("#btnRun");

  const toast = $("#toast");
  const toastText = $("#toastText");
  const btnToastClose = $("#btnToastClose");

  const runRatePill = $("#runRatePill");
  const runRate = $("#runRate");
  const runRateLabel = $("#runRateLabel");
  const runRateInfo = $("#runRateInfo");

  const confirmModal = $("#confirmModal");
  const btnConfirmCancel = $("#btnConfirmCancel");
  const btnConfirmOk = $("#btnConfirmOk");

  // =========================================================
  // loader helpers
  // =========================================================
  function setLoader(mode) {
    if (!infiniteLoader) return;

    if (mode === "hide") {
      infiniteLoader.hidden = true;
      infiniteLoader.classList.remove("is-done");
      return;
    }

    infiniteLoader.hidden = false;
    if (mode === "loading") {
      infiniteLoader.classList.remove("is-done");
      if (infiniteLoaderText) infiniteLoaderText.textContent = "로딩 중...";
      return;
    }

    if (mode === "done") {
      infiniteLoader.classList.add("is-done");
      if (infiniteLoaderText) infiniteLoaderText.textContent = "모든 오류 건을 불러왔습니다.";
    }
  }

  function showEmpty(show) {
    if (!emptyState) return;
    emptyState.hidden = !show;
  }

  // =========================================================
  // toast
  // =========================================================
  function showToast(msg) {
    if (!toast) return;
    if (toastText && msg) toastText.innerHTML = msg;
    toast.hidden = false;
  }

  function hideToast() {
    if (!toast) return;
    toast.hidden = true;
  }

  // =========================================================
  // modal open/close
  // =========================================================
  function openDetail(run) {
    if (!detailModal) return;

    selectedRun = run;

    if (detailMeta) {
      detailMeta.innerHTML = `
        <div class="admin-meta">run_id: ${escapeHtml(run.run_id)}</div>
        <div class="admin-meta">job: ${escapeHtml(run.job_name)}</div>
        <div class="admin-meta">start: ${escapeHtml(run.start_at)}</div>
        <div class="admin-meta">end: ${escapeHtml(run.end_at)}</div>
        <div class="admin-meta">work: ${escapeHtml(run.work_at)}</div>
        <div class="admin-meta">code: ${escapeHtml(run.state_code)}</div>
      `;
    }

    if (detailMessage) detailMessage.textContent = run.detail || run.message || "";

    detailModal.hidden = false;
  }

  function closeDetail() {
    if (!detailModal) return;
    detailModal.hidden = true;
  }

  function openConfirm() {
    if (!confirmModal) return;
    confirmModal.hidden = false;
  }

  function closeConfirm() {
    if (!confirmModal) return;
    confirmModal.hidden = true;
  }

  // =========================================================
  // progress pill (서버 progress polling)
  // =========================================================
  function updateRunRatePill() {
    if (!runRatePill || !runRate) return;

    if (!rerunRunning) {
      runRatePill.hidden = true;
      runRate.textContent = "(0%)";
      return;
    }

    runRatePill.hidden = false;
    if (runRateLabel) runRateLabel.textContent = "분석 작업 실행 중";

    const pct = Math.max(0, Math.min(100, Math.round(rerunPct)));
    runRate.textContent = `(${pct}%)`;
  }

  function stopRerunPolling() {
    if (rerunTimer) clearInterval(rerunTimer);
    rerunTimer = null;
  }

  function stopRerun() {
    rerunRunning = false;
    rerunPct = 0;
    rerunJobId = null;
    rerunActiveRunId = null;
    stopRerunPolling();
    updateRunRatePill();
  }

  async function pollProgressOnce() {
    try {
      const qs = new URLSearchParams();
      if (rerunJobId) qs.set("job_id", String(rerunJobId));
      else if (rerunActiveRunId) qs.set("run_id", String(rerunActiveRunId));

      const url = qs.toString() ? `${API.progress}?${qs.toString()}` : API.progress;
      const payload = await apiJson(url, { cache: "no-store", timeoutMs: 12000 });
      if (!payload) return;

      const p = normalizeProgress(payload);
      rerunRunning = p.running;
      rerunPct = p.percent;
      if (p.runId) rerunActiveRunId = p.runId;

      updateRunRatePill();

      // 완료 판단(서버가 running false로 주거나, percent 100)
      if (!rerunRunning || rerunPct >= 100) {
        stopRerun();
        showToast("재실행이 완료되었습니다.");
      }
    } catch (e) {
      console.warn("[collection.progress] poll failed:", e?.message || e);
    }
  }

  async function syncProgressFromServer() {
    try {
      const payload = await apiJson(API.progress, { cache: "no-store", timeoutMs: 12000 });
      if (!payload) return;
      const p = normalizeProgress(payload);
      rerunRunning = p.running;
      rerunPct = p.percent;
      rerunActiveRunId = p.runId;

      updateRunRatePill();

      if (rerunRunning) {
        stopRerunPolling();
        rerunTimer = setInterval(pollProgressOnce, 5000);
      }
    } catch (e) {
      console.warn("[collection.progress] init failed:", e?.message || e);
    }
  }

  async function startRerun() {
    if (!selectedRun) {
      showToast("실행할 작업(행)을 먼저 선택해주세요.");
      return;
    }

    if (rerunRunning) {
      showToast(
        "현재 실행이 진행 중입니다.<br>완료까지 재실행은 제한되며,<br>조회 기능은 정상적으로 이용 가능합니다."
      );
      return;
    }

    try {
      rerunRunning = true;
      rerunPct = 0;
      rerunActiveRunId = selectedRun.run_id;
      updateRunRatePill();

      const payload = await apiJson(API.rerun(selectedRun.run_id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      rerunJobId = payload?.job_id ?? payload?.id ?? payload?.jobId ?? null;

      // 즉시 1회 반영 + 5초 폴링 시작
      await pollProgressOnce();
      stopRerunPolling();
      rerunTimer = setInterval(pollProgressOnce, 5000);
    } catch (e) {
      stopRerun();
      showToast(`실행 시작 실패: ${escapeHtml(e?.message || e)}`);
    }
  }

  // =========================================================
  // render / data (API 기반)
  // =========================================================
  function appendRows(rows) {
    if (!tbody) return;

    const frag = document.createDocumentFragment();

    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.runId = String(r.run_id);

      tr.innerHTML = `
        <td style="width:70px;">${escapeHtml(r.run_id)}</td>
        <td style="width:120px;">${escapeHtml(r.job_name)}</td>
        <td style="width:160px;" title="${escapeAttr(r.start_at)}">${escapeHtml(r.start_at)}</td>
        <td style="width:160px;" title="${escapeAttr(r.end_at)}">${escapeHtml(r.end_at)}</td>
        <td style="width:150px;" title="${escapeAttr(r.work_at)}">${escapeHtml(r.work_at)}</td>
        <td style="width:110px;">
          <span class="status-badge ${codeClass(r.state_code)}">${escapeHtml(r.state_code)}</span>
        </td>
        <td title="${escapeAttr(r.message)}">${escapeHtml(r.message)}</td>
      `;

      tr.addEventListener("click", async () => {
        tbody?.querySelectorAll("tr").forEach((x) => x.classList.remove("is-selected"));
        tr.classList.add("is-selected");

        const base = { ...r, detail: "" };
        if (detailMessage) detailMessage.textContent = "불러오는 중...";
        openDetail(base);

        try {
          const full = await fetchRunDetail(r.run_id);
          if (full) openDetail(full);
        } catch (e) {
          if (detailMessage) detailMessage.textContent = r.message || "";
          showToast(`상세 조회 실패: ${escapeHtml(e?.message || e)}`);
        }
      });

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  }

  function resetList() {
    loading = false;
    done = false;
    nextCursor = null;
    if (tbody) tbody.innerHTML = "";
    showEmpty(false);
    setLoader("hide");
    selectedRun = null;
  }

  async function loadNextPage() {
    if (loading || done) return;
    if (!queryStartIso || !queryEndIso) return;

    loading = true;
    setLoader("loading");

    try {
      const { items, nextCursor: nc } = await fetchRunsPage({
        startIso: queryStartIso,
        endIso: queryEndIso,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });

      if (items.length === 0) {
        if (!tbody || tbody.children.length === 0) {
          setLoader("hide");
          showEmpty(true);
        } else {
          done = true;
          setLoader("done");
        }
        loading = false;
        return;
      }

      appendRows(items);

      nextCursor = nc;

      if (!nextCursor) {
        done = true;
        setLoader("done");
      } else {
        setLoader("hide");
      }
    } catch (e) {
      setLoader("hide");
      showToast(`조회 실패: ${escapeHtml(e?.message || e)}`);
      if (!tbody || tbody.children.length === 0) showEmpty(true);
    } finally {
      loading = false;
    }
  }

  async function doSearch() {
    const today = isoToday();

    let startIso = startInput && startInput.value ? startInput.value : today;
    let endIso = endInput && endInput.value ? endInput.value : today;

    if (startInput) startInput.value = startIso;
    if (endInput) endInput.value = endIso;

    if (toDateNum(startIso) > toDateNum(endIso)) {
      [startIso, endIso] = [endIso, startIso];
      if (startInput) startInput.value = startIso;
      if (endInput) endInput.value = endIso;
    }


    queryStartIso = startIso;
    queryEndIso = endIso;

    resetList();
    await loadNextPage();
  }

  // =========================================================
  // events
  // =========================================================
  function bindEvents() {
    // ✅ 조회 버튼: 무조건 로그 + doSearch 실행되게
    btnSearch?.addEventListener("click", (e) => {
      e.preventDefault();
      doSearch();
    });

    // 무한 스크롤
    tableBodyWrap?.addEventListener("scroll", () => {
      if (loading || done) return;
      const nearBottom =
        tableBodyWrap.scrollTop + tableBodyWrap.clientHeight >= tableBodyWrap.scrollHeight - 120;
      if (nearBottom) loadNextPage();
    });

    // 상세 모달 닫기
    btnCloseModal?.addEventListener("click", closeDetail);
    detailModal?.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.close === "true") closeDetail();
    });

    // ESC로 닫기
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (confirmModal && !confirmModal.hidden) closeConfirm();
        if (detailModal && !detailModal.hidden) closeDetail();
      }
    });

    // 토스트 닫기
    btnToastClose?.addEventListener("click", hideToast);

    // i 버튼 클릭 -> 안내 토스트(실행중일 때만)
    runRateInfo?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!rerunRunning) return;

      showToast(
        "현재 실행이 진행 중입니다.<br>완료까지 재실행은 제한되며,<br>조회 기능은 정상적으로 이용 가능합니다."
      );
    });

    // 실행 버튼 -> 확인 모달(실행중이면 토스트)
    btnRun?.addEventListener("click", async () => {
      await syncProgressFromServer();

      if (rerunRunning) {
        showToast(
          "현재 실행이 진행 중입니다.<br>완료까지 재실행은 제한되며,<br>조회 기능은 정상적으로 이용 가능합니다."
        );
        return;
      }

      openConfirm();
    });

    // 확인 모달 닫기 (배경 클릭)
    confirmModal?.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.close === "true") closeConfirm();
    });

    // 확인/취소
    btnConfirmCancel?.addEventListener("click", closeConfirm);
    btnConfirmOk?.addEventListener("click", async () => {
      closeConfirm();
      await startRerun();
    });
  }

  // =========================================================
  // init
  // =========================================================
  async function init() {
    const today = isoToday();
    if (startInput) startInput.value = today;
    if (endInput) endInput.value = today;

    bindEvents();
    updateRunRatePill();

    // 서버 progress 상태 동기화(실행중이면 pill 띄우고 폴링)
    await syncProgressFromServer();

    // ✅ 페이지 처음 열리면 1회 자동 조회 (원하면 삭제 가능)
    await doSearch();
  }

  init();
})();

// ===============================
// date-pill 전체 클릭 -> date picker 열기
// ===============================
(function bindDatePillPicker() {
  document.querySelectorAll(".date-pill").forEach((pill) => {
    const input = pill.querySelector('input[type="date"]');
    if (!input) return;

    // 중복 바인딩 방지
    if (pill.dataset.boundPicker) return;
    pill.dataset.boundPicker = "1";

    // 커서도 pill 전체가 클릭 가능하게
    pill.style.cursor = "pointer";

    pill.addEventListener("click", (e) => {
      // 기본 label 클릭은 input focus로도 이어지지만,
      // 확실히 picker까지 열어주기 위해 showPicker 사용
      e.preventDefault();
      e.stopPropagation();

      if (typeof input.showPicker === "function") input.showPicker();
      else input.focus();
    });
  });
})();