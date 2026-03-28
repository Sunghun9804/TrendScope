// /static/admin_rerun.js
(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  // ==========================================
// 1. 전역 상태 체크 (새로고침 대응)
// ==========================================
async function syncGlobalStatus() {
    try {
        const res = await fetch('/admin/reanalyze/status/latest'); 
        const data = await res.json();

        if (data.status === "running") {
            // 기존 setProgress 활용
            setProgress(true, data.progress);
            // 버튼 잠금
            btnRun.disabled = true;
            btnRun.classList.add("opacity-50", "cursor-not-allowed");
            
            // 폴링 시작
            startPolling(data.job_id);
        } else {
            setProgress(false, 0);
            btnRun.disabled = false;
            btnRun.classList.remove("opacity-50", "cursor-not-allowed");
        }
    } catch (e) {
        console.error("상태 동기화 실패:", e);
    }
}



// ==========================================
// 3. 폴링 (진행률 추적 및 완료 후 리로드)
// ==========================================
function startPolling(jobId) {
    const timer = setInterval(async () => {
        try {
            const res = await fetch(`/admin/reanalyze/progress/${jobId}`);
            const data = await res.json();
            if (data.status === "running") {
                setProgress(true, data.progress);
            } 
            else {
                // 분석 종료 (done 또는 error) 시 일단 타이머 중지
                clearInterval(timer);

                if (data.status === "done") {
                    // 1. 100% 상태를 명시적으로 표시
                    setProgress(true, 100); 
                    
                    // 2. 3초(3000ms) 뒤에 UI 초기화 및 리스트 새로고침
                    setTimeout(() => {
                        setProgress(false, 0); // 분석바 숨김
                        btnRun.disabled = false;
                        btnRun.classList.remove("opacity-50", "cursor-not-allowed");
                        
                        // 리스트 새로고침
                        if (typeof refresh === "function") {
                            refresh(startEl.value, endEl.value);
                        }
                        alert("재분석이 완료되었습니다.");
                    }, 3000); 
                } 
                else {
                    // 에러 발생 시에는 즉시 해제
                    setProgress(false, 0);
                    btnRun.disabled = false;
                    btnRun.classList.remove("opacity-50", "cursor-not-allowed");
                    alert("분석 중 오류가 발생했습니다.");
                }
            }
        } catch (e) {
            console.error("폴링 중 에러:", e);
            clearInterval(timer);
        }
    }, 2000);
}
  // =========================
  // util
  // =========================
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toInputValue(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function parseInputDate(v) {
    const [y, m, d] = (v || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  function clampStartEnd(startEl, endEl) {
    const s = parseInputDate(startEl.value);
    const e = parseInputDate(endEl.value);
    if (!s || !e) return;
    if (s > e) endEl.value = startEl.value;
  }
  function isoToYmd(iso) { return String(iso || "").replaceAll("-", ""); }

  // =========================
  // API
  // =========================
  const API = {
    errors: "/admin/reanalyze/errors",
    run: "/admin/reanalyze/run",
    progress: (jobId) => `/admin/reanalyze/progress/${encodeURIComponent(jobId)}`,
  };

  async function apiJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
    
    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        credentials: "include",
        headers: {
          ...(opts.headers || {}),
        },
      });

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

  function pickList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return payload.items || payload.articles || payload.data || payload.rows || payload.results || [];
  }

  // 서버 row 형태가 달라도 UI row로 맞추기
  function normalizeRow(raw) {
    const article_id = raw.article_id ?? raw.id ?? raw.articleId ?? raw._id ?? "";
    const publishedRaw = raw.published_at ?? raw.publishedAt ?? raw.date ?? raw.published ?? null;
    const published_at = publishedRaw ? new Date(publishedRaw) : new Date();

    const missing =
      raw.missing_fields ??
      raw.missingFields ??
      raw.null_fields ??
      raw.nullFields ??
      raw.missing ??
      [];

    const missingSet = new Set(Array.isArray(missing) ? missing : String(missing).split(",").map(s => s.trim()));

    const row = {
      article_id,
      published_at,
      keyword: (raw.keyword === null || missingSet.has("keyword")) ? null : (raw.keyword ?? "OK"),
      sentiment: (raw.sentiment === null || missingSet.has("sentiment")) ? null : (raw.sentiment ?? "OK"),
      trust: (raw.trust === null || missingSet.has("trust")) ? null : (raw.trust ?? "OK"),
      summary: (raw.summary === null || missingSet.has("summary")) ? null : (raw.summary ?? "OK"),
    };

    return row;
  }

  async function fetchMissingArticles(startIso, endIso, fieldsArr) {
    // 1차: ISO
    const qs1 = new URLSearchParams();
    qs1.set("start", startIso);
    qs1.set("end", endIso);
    qs1.set("fields", fieldsArr.join(","));

    try {
      const payload = await apiJson(`${API.errors}?${qs1.toString()}`, { cache: "no-store" });
      const list = pickList(payload).map(normalizeRow).filter(r => r.article_id);
      // 최신순 정렬(서버가 이미 정렬해도 안전)
      list.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());

      return list;
    } catch (e1) {
      // 2차: YYYYMMDD

      const qs2 = new URLSearchParams();
      qs2.set("start", isoToYmd(startIso));
      qs2.set("end", isoToYmd(endIso));
      qs2.set("fields", fieldsArr.join(","));

      const payload = await apiJson(`${API.errors}?${qs2.toString()}`, { cache: "no-store" });
      const list = pickList(payload).map(normalizeRow).filter(r => r.article_id);
      list.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
      return list;
    }
  }

  // =========================
  // models
  // =========================
  const MODELS = ["keyword", "sentiment", "trust", "summary"];
  const MODEL_LABEL = {
    keyword: "Keyword",
    sentiment: "Sentiment",
    trust: "Trust",
    summary: "Summary",
  };

  // =========================
  // elements
  // =========================
  const startEl = $("#startDate");
  const endEl = $("#endDate");
  const btnSearch = $("#btnSearch");
  const btnRun = $("#btnRun");

  const runRatePill = $("#runRatePill");
  const runRate = $("#runRate");
  const runRateLabel = $("#runRateLabel");
  const runRateInfo = $("#runRateInfo");

  const chipAll = $("#chipAll");
  const chipClear = $("#chipClear");
  const modelChips = $$(".rerun-chip[data-model]");

  const checkAllRows = $("#checkAllRows");
  const tbody = $("#tbodyArticles");
  const emptyState = $("#emptyState");
  const emptyHint = $("#emptyHint");

  const toast = $("#toast");
  const toastText = $("#toastText");
  const btnToastClose = $("#btnToastClose");

  const confirmModal = $("#confirmModal");
  const confirmDesc = $("#confirmDesc");
  const btnConfirmCancel = $("#btnConfirmCancel");
  const btnConfirmOk = $("#btnConfirmOk");

  const required = [
    startEl, endEl, btnSearch, btnRun,
    chipAll, chipClear,
    checkAllRows, tbody, emptyState, emptyHint,
    toast, toastText, btnToastClose,
    confirmModal, confirmDesc, btnConfirmCancel, btnConfirmOk,
    runRatePill, runRate, runRateLabel, runRateInfo
  ];
  if (required.some(v => !v)) {
    console.warn("[admin_rerun.js] required element missing. abort.");
    return;
  }


  // =========================
  // state
  // =========================
  let selectedModels = new Set(MODELS);
  let currentList = [];
  let selectedRowIds = new Set();
  let isLocked = false;   // 실행 중 잠금
  let isFetching = false; // 조회 중 잠금(가벼운 잠금)

  let running = false;
  let pct = 0;
  let pollTimer = null;
  let currentJobId = null;

  // =========================
  // init dates: yesterday ~ today
  // =========================
  (function initDates() {
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    startEl.value = toInputValue(y);
    endEl.value = toInputValue(today);
  })();

  // =========================
  // UI helpers
  // =========================
  function showToast(msg) {
    toastText.innerHTML = msg || "";
    toast.hidden = false;
  }
  function hideToast() {
    toast.hidden = true;
  }

  function setLocked(on) {
    isLocked = on;
    btnSearch.disabled = on;
    btnRun.disabled = on ? true : btnRun.disabled;

    if (on) document.body.classList.add("rerun-running");
    else document.body.classList.remove("rerun-running");
  }

  function setFetching(on) {
    isFetching = on;
    btnSearch.disabled = on || isLocked;
    // 실행 버튼은 선택 상태에 의해 결정되므로 여기선 손대지 않음
  }

  function syncRunButton() {
    const can =
      !isLocked &&
      !isFetching &&
      selectedModels.size > 0 &&
      currentList.length > 0 &&
      Array.from(selectedRowIds).some(id => currentList.some(r => r.article_id === id));
    btnRun.disabled = !can;
  }

  function syncHeaderCheck() {
    const ids = currentList.map(r => r.article_id);
    const allSelected = ids.length > 0 && ids.every(id => selectedRowIds.has(id));
    const anySelected = ids.some(id => selectedRowIds.has(id));

    checkAllRows.checked = allSelected;
    checkAllRows.indeterminate = (!allSelected && anySelected);
  }

  // =========================
  // chips
  // =========================
  function syncChipUI() {
    modelChips.forEach(ch => {
      const m = ch.dataset.model;
      ch.classList.toggle("is-active", selectedModels.has(m));
    });

    chipAll.classList.toggle("is-active", selectedModels.size === MODELS.length);
    chipClear.classList.toggle("is-active", selectedModels.size === 0);
  }

  function setAllModels(on) {
    selectedModels = on ? new Set(MODELS) : new Set();
    syncChipUI();
    const start = startEl.value;
    const end = endEl.value;

    refresh(start, end);
  }

  chipAll.addEventListener("click", () => {
    if (isLocked) return;
    setAllModels(true);
  });
  chipClear.addEventListener("click", () => {
    if (isLocked) return;
    setAllModels(false);
  });

  modelChips.forEach(ch => {
    ch.addEventListener("click", () => {
      if (isLocked) return;
      const m = ch.dataset.model;
      if (selectedModels.has(m)) selectedModels.delete(m);
      else selectedModels.add(m);
      syncChipUI();
      const start = startEl.value;
      const end = endEl.value;

      refresh(start, end);
    });
  });

  // =========================
  // render
  // =========================
  function renderCell(v) {
    if (v === null) return `<span class="rerun-pill is-null">Null</span>`;
    return `<span class="rerun-pill is-dot" aria-label="OK">·</span>`;
  }

  function render() {
    if (currentList.length === 0) {
      tbody.innerHTML = "";
      emptyState.hidden = false;

      if (selectedModels.size === 0) {
        emptyHint.textContent = "분석 모델을 선택하면 목록이 표시됩니다. (전체 해제 상태)";
      } else {
        emptyHint.textContent = "조건에 해당하는 null 기사 목록이 없습니다.";
      }

      checkAllRows.checked = false;
      checkAllRows.indeterminate = false;

      syncRunButton();
      return;
    }

    emptyState.hidden = true;
    tbody.innerHTML = "";

    currentList.forEach(row => {
      const checked = selectedRowIds.has(row.article_id);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="width:54px;">
          <input type="checkbox" class="rerun-check rowCheck" data-id="${row.article_id}" ${checked ? "checked" : ""}>
        </td>
        <td style="width:360px;" class="rerun-mono">${row.article_id}</td>
        <td data-col="keyword">${renderCell(row.keyword)}</td>
        <td data-col="sentiment">${renderCell(row.sentiment)}</td>
        <td data-col="trust">${renderCell(row.trust)}</td>
        <td data-col="summary">${renderCell(row.summary)}</td>
      `;
      tbody.appendChild(tr);
    });

    $$(".rowCheck", tbody).forEach(ch => {
      ch.addEventListener("change", () => {
        if (isLocked) { ch.checked = !ch.checked; return; }
        const id = ch.dataset.id;
        if (!id) return;

        if (ch.checked) selectedRowIds.add(id);
        else selectedRowIds.delete(id);

        syncHeaderCheck();
        syncRunButton();
      });
    });

    syncHeaderCheck();
    syncRunButton();
  }

  function selectAllRows(on) {
    const ids = currentList.map(r => r.article_id);
    if (on) ids.forEach(id => selectedRowIds.add(id));
    else ids.forEach(id => selectedRowIds.delete(id));
    render();
  }

  // =========================
  // toolbar events
  // =========================
btnSearch.addEventListener("click", () => {
  if (isLocked) return;

  clampStartEnd(startEl, endEl);

  const start = startEl.value;
  const end = endEl.value;

  refresh(start, end);
});

  checkAllRows.addEventListener("change", () => {
    if (isLocked) { checkAllRows.checked = !checkAllRows.checked; return; }
    selectAllRows(checkAllRows.checked);
  });

  // =========================
  // confirm modal
  // =========================
  function openConfirm() {
    const targetIds = currentList.filter(r => selectedRowIds.has(r.article_id)).map(r => r.article_id);
    const modelNames = Array.from(selectedModels).map(m => MODEL_LABEL[m]).join(", ");

    confirmDesc.innerHTML = `
      선택된 기사: <b>${targetIds.length}건</b><br>
      선택 모델: <b>${modelNames || "-"}</b><br><br>
      실행 시 시간이 오래 걸릴 수 있습니다.<br>
      확인을 누르면 실행이 시작됩니다.
    `;

    confirmModal.hidden = false;
  }
  function closeConfirm() {
    confirmModal.hidden = true;
  }

  btnRun.addEventListener("click", () => {
    if (btnRun.disabled) return;
    openConfirm();
  });

  btnConfirmCancel.addEventListener("click", closeConfirm);
  confirmModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "true") closeConfirm();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !confirmModal.hidden) closeConfirm();
  });

  // =========================
  // progress pill
  // =========================
  function setProgress(on, percent) {
    running = on;
    pct = Math.max(0, Math.min(100, Math.round(percent || 0)));

    if (!running) {
      runRatePill.hidden = true;
      runRate.textContent = "(0%)";
      return;
    }

    runRatePill.hidden = false;
    runRateLabel.textContent = "재분석 실행 중";
    runRate.textContent = `(${pct}%)`;
  }

  runRateInfo.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!running) return;
    showToast("현재 재분석이 진행 중입니다.<br>완료까지 재실행은 제한되며,<br>조회 기능은 정상적으로 이용 가능합니다.");
  });

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

function normalizeProgress(job) {
  const status = String(job.status || "").toLowerCase();

  const percent =
    typeof job.progress === "number"
      ? job.progress
      : job.total
        ? Math.round((job.processed / job.total) * 100)
        : 0;

  return {
    running: status === "running",
    done: status === "done" || status === "error",
    percent,
    error: job.error || null,
  };
}


  async function pollOnce() {
  if (!currentJobId) return;

  try {
    const payload = await apiJson(API.progress(currentJobId), {
      cache: "no-store",
      timeoutMs: 15000
    });
    if (!payload) return;

    const p = normalizeProgress(payload);
    setProgress(p.running, p.percent);

    if (p.done) {
      stopPolling();
      setProgress(false, 0);
      setLocked(false);
      const start = startEl.value;
      const end = endEl.value;
      await refresh(start, end); // 완료 후 목록 갱신
      showToast("재분석이 완료되었습니다.");
    }

  } catch (e) {
    console.warn("[reanalyze.progress] poll failed:", e);
  }
}
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
  // =========================
  // run (real)
  // =========================
async function startRunReal() {
  const targets = currentList
    .filter(r => selectedRowIds.has(r.article_id))
    .map(r => r.article_id);

  const fields = Array.from(selectedModels);

  if (!targets.length || !fields.length) {
    showToast("기사 또는 모델이 선택되지 않았습니다.");
    return;
  }

  const jobId = crypto.randomUUID(); // uuid 생성
  currentJobId = jobId;

  // query string으로 구성
  const qs = new URLSearchParams();
  targets.forEach(id => qs.append("article_ids", id));
  fields.forEach(f => qs.append("fields", f));
  qs.set("job_id", jobId);
  setLocked(true);
  setProgress(true, 0);
  btnRun.disabled = true;

  try {
    // ✅ body 없이 POST 요청
    await apiJson(`${API.run}`, { // URL 뒤의 ?${qs} 제거
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ // 데이터를 body에 JSON으로 전달
        article_ids: targets,
        fields: fields,
        job_id: qs.get("job_id")
      }),
    });

    // 진행률 polling
    await pollOnce();
    pollTimer = setInterval(pollOnce, 10000);

  } catch (e) {
    setLocked(false);
    setProgress(false, 0);
    showToast(`실행 실패: ${e.message}`);
  }
}



  btnConfirmOk.addEventListener("click", async () => {
    closeConfirm();
    await startRunReal();
  });

  // =========================
  // toast close
  // =========================
  btnToastClose.addEventListener("click", hideToast);

  // =========================
  // refresh (real list)
  // =========================
  async function refresh(start, end) {
    // 모델 전체 해제면 서버 호출 안 함
    if (selectedModels.size === 0) {
      currentList = [];
      selectedRowIds = new Set();
      render();
      return;
    }

    setFetching(true);

    try {
      const fields = Array.from(selectedModels);
      const list = await fetchMissingArticles(start, end, fields);

      currentList = list;
      selectedRowIds = new Set(currentList.map(r => r.article_id)); // 조회 후 전체 선택
      render();
    } catch (e) {
      currentList = [];
      selectedRowIds = new Set();
      render();
      showToast(`조회 실패: ${e?.message || e}`);
    } finally {
      setFetching(false);
      syncRunButton();
    }
  }

  // =========================
  // boot
  // =========================
  (function boot() {
    syncChipUI();
    refresh(startEl.value, endEl.value);
    setProgress(false, 0);
    syncGlobalStatus();
  })();
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