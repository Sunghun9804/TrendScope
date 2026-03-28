(() => {
  "use strict";

  // =============================
  // API helpers (terms)
  // =============================
  const TERMS_API = {
    list: "/admin/terms/",
    detail: (id) => `/admin/terms/${encodeURIComponent(id)}`,
    create: "/admin/terms/",
    update: (id) => `/admin/terms/${encodeURIComponent(id)}`,
    remove: (id) => `/admin/terms/${encodeURIComponent(id)}`,
  };

  // ✅ 삭제(비활성)된 항목을 관리자 목록에서 기본으로 숨김
  const INCLUDE_DISABLED_DEFAULT = false;

  // 서버 repo에서 size를 최대 200으로 제한함
  const SERVER_MAX_PAGE_SIZE = 200;

  async function apiJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);

    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        credentials: "include",
        headers: { ...(opts.headers || {}) },
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

  function pickItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return payload.items || payload.data || payload.rows || payload.results || payload.terms || [];
  }

  function ymdDotFromAny(s) {
    const d = String(s || "");
    const ymd = d.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
    return ymd.replaceAll("-", ".") + " 수정";
  }

  // -----------------------------
  // Index constants
  // -----------------------------
  const KO_INDEX = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const EN_INDEX = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const NUM_INDEX = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  const KO_CHO_FULL = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
  ];
  const CHO_NORM = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    allWords: [],
    words: [],
    seg: "ko",
    index: "all",
    selectedId: null,

    isEditing: false,
    editMode: "edit", // "edit" | "add"
    editingId: null,
    draft: { keyword: "", content: "" },
  };

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ✅ 편집 상태 CSS 토글 (word-panel / word-detail-card)
  function syncEditingClasses() {
    const panel = $(".word-panel");
    if (panel) panel.classList.toggle("is-editing", !!state.isEditing);

    const detailCard = $(".word-detail-card");
    if (detailCard) detailCard.classList.toggle("is-editing", !!state.isEditing);
  }

  /**
   * ✅ FIX: 괄호 뒤 텍스트(tail)까지 보존
   */
  function parseKeyword(keywordRaw) {
    const keyword = (keywordRaw ?? "").trim();
    if (!keyword) return { keyword: "", head: "", en: "", tail: "", term: "" };

    const open = keyword.indexOf("(");
    if (open === -1) {
      return { keyword, head: keyword, en: "", tail: "", term: keyword };
    }

    const close = keyword.indexOf(")", open + 1);
    if (close === -1) {
      return { keyword, head: keyword, en: "", tail: "", term: keyword };
    }

    const head = keyword.slice(0, open).trim();
    const en = keyword.slice(open + 1, close).trim();
    const tail = keyword.slice(close + 1).trim();

    const term = [head, tail].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return { keyword, head, en, tail, term: term || head || tail || keyword };
  }

  // -----------------------------
  // Leading-char normalization
  // -----------------------------
  const ZERO_WIDTH_CODES = new Set([0x200b, 0xfeff]); // ZWSP, BOM
  const SKIP_CHARS = new Set([
    '"', "'", "“", "”", "‘", "’", "`", "´",
    "(", ")", "[", "]", "{", "}", "<", ">", "《", "》", "〈", "〉", "「", "」", "『", "』", "【", "】",
    "·", "•", "∙", "ㆍ", "‧",
    "-", "–", "—", "_",
    ".", ",", ":", ";", "!", "?", "/", "\\", "|",
    "※", "★", "☆", "✓", "✔", "▶",
  ]);

  function isAsciiLetter(ch) {
    return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
  }
  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  function isHangulSyllableCode(code) {
    return code >= 0xac00 && code <= 0xd7a3;
  }
  function isHangulCompatJamoCode(code) {
    return code >= 0x3131 && code <= 0x314e;
  }
  function isCircledNumber(code) {
    return (code >= 0x2460 && code <= 0x2473) || (code >= 0x2776 && code <= 0x277f);
  }
  function isRomanNumeralLike(code) {
    return code >= 0x2160 && code <= 0x216b;
  }

  function isDecimalLike(s, i) {
    const ch = s[i];
    const next = s[i + 1];
    const next2 = s[i + 2];
    return isDigit(ch) && next === "." && isDigit(next2 || "");
  }

  function isListPrefixDigit(s, i) {
    if (!isDigit(s[i])) return false;
    if (isDecimalLike(s, i)) return false;

    const next = s[i + 1] || "";
    const next2 = s[i + 2] || "";

    if (next === ")" || next === "]" || next === ":" || next === ".") {
      return /\s/.test(next2);
    }
    if (/\s/.test(next)) return true;

    return false;
  }

  function firstIndexChar(raw) {
    const s0 = String(raw ?? "");
    if (!s0) return "";

    const s = typeof s0.normalize === "function" ? s0.normalize("NFKC") : s0;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const code = ch.codePointAt(0);

      if (code > 0xffff) i++;

      if (/\s/.test(ch) || ZERO_WIDTH_CODES.has(code)) continue;
      if (SKIP_CHARS.has(ch)) continue;

      if (isCircledNumber(code)) continue;
      if (isRomanNumeralLike(code)) {
        const next = s[i + 1] || "";
        if (next === "." || next === ")" || /\s/.test(next)) continue;
      }

      if (isListPrefixDigit(s, i)) continue;

      if (isDigit(ch)) return ch;
      if (isAsciiLetter(ch)) return ch;
      if (isHangulSyllableCode(code) || isHangulCompatJamoCode(code)) return ch;
    }

    return "";
  }

  // -----------------------------
  // Index computations
  // -----------------------------
  function getKoIndex(term) {
    const ch = firstIndexChar(term);
    if (!ch) return null;

    const code = ch.charCodeAt(0);

    if (isHangulSyllableCode(code)) {
      const choIndex = Math.floor((code - 0xac00) / 588);
      const cho = KO_CHO_FULL[choIndex];
      if (!cho) return null;
      return CHO_NORM[cho] || cho;
    }

    if (isHangulCompatJamoCode(code)) {
      const norm = CHO_NORM[ch] || ch;
      return KO_INDEX.includes(norm) ? norm : null;
    }

    return null;
  }

  function getEnIndex(term) {
    const ch = firstIndexChar(term);
    if (!ch) return null;
    const c = ch.toUpperCase();
    return c >= "A" && c <= "Z" ? c : null;
  }

  function getNumIndex(term) {
    const ch = firstIndexChar(term);
    if (!ch) return null;
    return ch >= "0" && ch <= "9" ? ch : null;
  }

  function detectSeg(term) {
    const ch = firstIndexChar(term);
    if (!ch) return "ko";
    if (isDigit(ch)) return "num";
    if (isAsciiLetter(ch)) return "en";

    const code = ch.charCodeAt(0);
    if (isHangulSyllableCode(code) || isHangulCompatJamoCode(code)) return "ko";
    return "ko";
  }

  function computeIndex(seg, term) {
    if (seg === "ko") return getKoIndex(term);
    if (seg === "en") return getEnIndex(term);
    return getNumIndex(term);
  }

  // -----------------------------
  // Data load (fixed pagination)
  // -----------------------------
  async function fetchAllByGroup(group) {
    const all = [];
    let page = 1;

    for (let guard = 0; guard < 500; guard++) {
      const qs = new URLSearchParams();
      qs.set("group", group);

      // ✅ include_disabled를 true로 하고 싶을 때만 쿼리에 붙임
      if (INCLUDE_DISABLED_DEFAULT) qs.set("include_disabled", "true");

      qs.set("page", String(page));
      qs.set("size", String(SERVER_MAX_PAGE_SIZE));

      const payload = await apiJson(`${TERMS_API.list}?${qs.toString()}`, { cache: "no-store" });
      if (!payload) break;

      const items = pickItems(payload);
      if (!items.length) break;

      all.push(...items);

      const size = Number(payload.size) || SERVER_MAX_PAGE_SIZE;
      const total = Number(payload.total);

      if (items.length < size) break;
      if (Number.isFinite(total) && total > 0 && page * size >= total) break;

      page += 1;
    }

    return all;
  }

  async function loadWords() {
    const all = await fetchAllByGroup(""); // 전체

    state.allWords = all.map((row, i) => {
      const id = String(row.term_id ?? row.id ?? row.termId ?? i);

      const parsed = parseKeyword(row.term || row.keyword || row.name || "");
      const seg = detectSeg(parsed.term);

      const desc = row.description ?? row.content ?? row.body ?? "";
      const updatedAt =
        ymdDotFromAny(
          row.event_at ||
            row.eventAt ||
            row.updated_at ||
            row.updatedAt ||
            row.scraped_at ||
            row.scrapedAt
        ) || "";

      return {
        id,
        keyword: parsed.keyword,
        head: parsed.head,
        en: parsed.en,
        tail: parsed.tail,
        term: parsed.term,
        seg,
        body: String(desc)
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        updatedAt,
        indexKey: computeIndex(seg, parsed.term),
      };
    });
  }

  // -----------------------------
  // Filtering + sorting
  // -----------------------------
  function applyFilter() {
    let list = state.allWords.filter((w) => w.seg === state.seg);

    if (state.index !== "all") {
      list = list.filter((w) => w.indexKey === state.index);
    }

    list.sort((a, b) => a.term.localeCompare(b.term, state.seg === "en" ? "en" : "ko"));

    state.words = list;

    if (!state.words.some((w) => w.id === state.selectedId)) {
      state.selectedId = state.words[0]?.id || null;
    }
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function renderIndexBar() {
    const indexBar = $("#indexBar");
    if (!indexBar) return;

    const list = state.seg === "ko" ? KO_INDEX : state.seg === "en" ? EN_INDEX : NUM_INDEX;

    indexBar.innerHTML = `
      <div class="index-pill" role="tablist">
        <button class="index-btn ${state.index === "all" ? "is-active" : ""}" data-key="all">전체</button>
        ${list
          .map(
            (k) => `
          <button class="index-btn ${state.index === k ? "is-active" : ""}" data-key="${k}">${k}</button>
        `
          )
          .join("")}
      </div>
    `;
  }

  function ensureInlineActions() {
    const head = $(".word-detail-head");
    if (!head) return null;

    let actions = $("#detailActions");
    if (!actions) {
      actions = document.createElement("div");
      actions.id = "detailActions";
      actions.className = "word-detail-actions";
      head.appendChild(actions);
    }
    return actions;
  }

  function setToolbarLocked(locked) {
    $$(".word-seg-btn").forEach((b) => (b.disabled = !!locked));
    $$("#indexBar .index-btn").forEach((b) => (b.disabled = !!locked));

    const btnEdit = $("#btnEdit");
    const btnAdd = $("#btnAdd");
    const btnDelete = $("#btnDelete");

    if (btnEdit) btnEdit.disabled = !!locked;
    if (btnAdd) btnAdd.disabled = !!locked;
    if (btnDelete) btnDelete.disabled = !!locked;
  }

  function renderDetail(word) {
    const title = $("#detailTitle");
    const meta = $("#detailMeta");
    const content = $("#detailContent");
    const actions = ensureInlineActions();

    if (!title || !meta || !content) return;

    if (!word) {
      if (actions) actions.innerHTML = "";
      title.textContent = "단어를 선택하세요";
      meta.textContent = "";
      content.innerHTML = `
        <div class="word-empty">
          <div class="word-empty-emoji">📘</div>
        </div>
      `;
      return;
    }

    // Edit mode
    if (state.isEditing && state.editingId === word.id) {
      title.textContent = state.editMode === "add" ? "용어 추가" : "용어 편집";
      meta.textContent = "";

      if (actions) {
        actions.innerHTML = `
          <button class="word-primary-btn" id="btnSaveInline" type="button">저장</button>
          <button class="word-outline-btn" id="btnCancelInline" type="button">취소</button>
        `;
      }

      content.innerHTML = `
        <div class="wm-form word-inline-editor">
          <label class="wm-label" for="editKeyword">용어명</label>
          <input class="wm-input" id="editKeyword" type="text" placeholder="예) 가격 차별(Price Discrimination) 하이요" />
          <label class="wm-label" for="editContent">내용</label>
          <textarea class="wm-textarea" id="editContent" rows="14" placeholder="설명을 입력하세요"></textarea>
        </div>
      `;

      const keywordEl = $("#editKeyword");
      const contentEl = $("#editContent");
      if (keywordEl) keywordEl.value = state.draft.keyword;
      if (contentEl) contentEl.value = state.draft.content;

      const saveBtn = $("#btnSaveInline");
      const cancelBtn = $("#btnCancelInline");
      if (saveBtn) saveBtn.onclick = onSaveInline;
      if (cancelBtn) cancelBtn.onclick = exitEditMode;
      return;
    }

    // View mode
    if (actions) actions.innerHTML = "";

    const headHtml = escapeHtml(word.head || word.term || "");
    const enHtml = word.en ? `<small>(${escapeHtml(word.en)})</small>` : "";
    const tailHtml = word.tail ? `<span class="word-tail"> ${escapeHtml(word.tail)}</span>` : "";

    title.innerHTML = `${headHtml} ${enHtml}${tailHtml}`.replace(/\s+/g, " ").trim();
    meta.textContent = word.updatedAt || "";
    content.innerHTML = word.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  }

  function renderList() {
    const listEl = $("#wordList");
    if (!listEl) return;

    if (!state.words.length) {
      listEl.innerHTML = `
        <div class="word-empty" style="min-height:240px;">
          <div class="word-empty-title">해당 조건의 단어가 없어요</div>
        </div>
      `;
      renderDetail(null);
      return;
    }

    listEl.innerHTML = state.words
      .map(
        (w) => `
      <div class="word-item ${w.id === state.selectedId ? "is-selected" : ""}" data-id="${w.id}" role="option">
        <span class="word-item-title">${escapeHtml(w.term)}</span>
        <span class="word-item-right"><span class="play-mini">▶</span></span>
      </div>
    `
      )
      .join("");

    renderDetail(state.words.find((w) => w.id === state.selectedId) || null);

    requestAnimationFrame(() => {
      const el = listEl.querySelector(`.word-item[data-id="${state.selectedId}"]`);
      el?.scrollIntoView({ block: "center" });
    });
  }

  // -----------------------------
  // ✅ Modal helpers (삭제 confirm UI)
  // -----------------------------
  const modalState = {
    isOpen: false,
    lastFocusEl: null,
    onConfirm: null,
  };

  function getModalEls() {
    const backdrop = $("#wordModal");
    const modal = backdrop?.querySelector(".modal") || null;
    const body = $("#wmBody");
    const foot = $("#wmFoot");
    const title = $("#wmTitle");
    const closeBtn = backdrop?.querySelector("[data-wm-close]") || null;
    return { backdrop, modal, body, foot, title, closeBtn };
  }

  function openModal({ kind = "default", bodyHtml = "", footHtml = "" } = {}) {
    const { backdrop, modal, body, foot } = getModalEls();
    if (!backdrop || !modal || !body || !foot) return;

    modalState.lastFocusEl = document.activeElement;

    modal.classList.toggle("is-confirm", kind === "confirm");

    body.innerHTML = bodyHtml;
    foot.innerHTML = footHtml;

    backdrop.classList.add("is-open");
    backdrop.style.display = "grid";
    backdrop.setAttribute("aria-hidden", "false");
    modalState.isOpen = true;

    const firstFocusable = foot.querySelector(
      "button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])"
    );
    if (firstFocusable) firstFocusable.focus();
  }

  function closeModal() {
    const { backdrop, modal, body, foot } = getModalEls();
    if (!backdrop || !modal || !body || !foot) return;

    modal.classList.remove("is-confirm");
    body.innerHTML = "";
    foot.innerHTML = "";

    backdrop.classList.remove("is-open");
    backdrop.style.display = "none";
    backdrop.setAttribute("aria-hidden", "true");

    modalState.isOpen = false;
    modalState.onConfirm = null;

    const el = modalState.lastFocusEl;
    modalState.lastFocusEl = null;
    if (el && typeof el.focus === "function") el.focus();
  }

  function bindModalEventsOnce() {
    const { backdrop, closeBtn } = getModalEls();
    if (!backdrop) return;
    if (backdrop.dataset.bound === "1") return;
    backdrop.dataset.bound = "1";

    closeBtn?.addEventListener("click", closeModal);

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (!modalState.isOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    });
  }

  function openDeleteConfirmModal(word) {
    const termName = escapeHtml(word.term || "");
    const bodyHtml = `
      <div class="confirm-title">※ 실행 전 확인 ※</div>
      <div class="confirm-desc">
        <strong>"${termName}"</strong> 항목을 삭제(비활성)합니다.<br/>
        삭제할 경우 데이터 복구가 불가능합니다.<br/>
        정말 삭제하겠습니까?
      </div>
    `;

    const footHtml = `
      <button class="word-outline-btn confirm-btn" type="button" data-modal-cancel>취소</button>
      <button class="word-primary-btn confirm-btn" type="button" data-modal-confirm>확인</button>
    `;

    modalState.onConfirm = async () => {
      try {
        await apiJson(TERMS_API.remove(word.id), { method: "DELETE" });
        closeModal();

        await loadWords();
        applyFilter();
        renderIndexBar();
        renderList();
      } catch (e) {
        closeModal();
        alert(`삭제 실패: ${e?.message || e}`);
      }
    };

    openModal({ kind: "confirm", bodyHtml, footHtml });

    const { foot } = getModalEls();
    const cancelBtn = foot?.querySelector("[data-modal-cancel]");
    const confirmBtn = foot?.querySelector("[data-modal-confirm]");

    cancelBtn?.addEventListener("click", closeModal);
    confirmBtn?.addEventListener("click", () => modalState.onConfirm?.());
  }

  // -----------------------------
  // Edit mode handlers
  // -----------------------------
  function enterEditMode(mode) {
    const word = state.words.find((w) => w.id === state.selectedId) || null;

    if (mode === "edit") {
      if (!word) return;

      state.isEditing = true;
      state.editMode = "edit";
      state.editingId = word.id;

      state.draft = {
        keyword: word.keyword || "",
        content: word.body.join("\n"),
      };

      setToolbarLocked(true);
      syncEditingClasses();
      renderList();
      return;
    }

    // Add mode
    state.isEditing = true;
    state.editMode = "add";
    state.editingId = "__new__";
    state.draft = { keyword: "", content: "" };

    setToolbarLocked(true);
    syncEditingClasses();

    const title = $("#detailTitle");
    const meta = $("#detailMeta");
    const content = $("#detailContent");
    const actions = ensureInlineActions();
    if (!title || !meta || !content) return;

    title.textContent = "용어 추가";
    meta.textContent = "";

    if (actions) {
      actions.innerHTML = `
        <button class="word-primary-btn" id="btnSaveInline" type="button">저장</button>
        <button class="word-outline-btn" id="btnCancelInline" type="button">취소</button>
      `;
    }

    content.innerHTML = `
      <div class="wm-form word-inline-editor">
        <label class="wm-label" for="editKeyword">용어명</label>
        <input class="wm-input" id="editKeyword" type="text" placeholder="예) 가격 차별(Price Discrimination) 하이요" />
        <label class="wm-label" for="editContent">내용</label>
        <textarea class="wm-textarea" id="editContent" rows="14" placeholder="설명을 입력하세요"></textarea>
      </div>
    `;

    const saveBtn = $("#btnSaveInline");
    const cancelBtn = $("#btnCancelInline");
    if (saveBtn) saveBtn.onclick = onSaveInline;
    if (cancelBtn) cancelBtn.onclick = exitEditMode;
  }

  function exitEditMode() {
    state.isEditing = false;
    state.editMode = "edit";
    state.editingId = null;
    state.draft = { keyword: "", content: "" };

    setToolbarLocked(false);
    syncEditingClasses();

    applyFilter();
    renderIndexBar();
    renderList();
  }

  async function onSaveInline() {
    const keywordEl = $("#editKeyword");
    const contentEl = $("#editContent");
    const keyword = (keywordEl?.value ?? "").trim();
    const content = (contentEl?.value ?? "").trim();

    if (!keyword) {
      alert("용어명을 입력해 주세요.");
      keywordEl?.focus();
      return;
    }

    const parsed = parseKeyword(keyword);
    if (!parsed.term) {
      alert("용어명을 확인해 주세요.");
      keywordEl?.focus();
      return;
    }

    const seg = detectSeg(parsed.term);

    if (state.editMode === "add") {
      try {
        const created = await apiJson(TERMS_API.create, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: keyword, description: content }),
        });

        const newId = String(created?.item?.term_id ?? created?.item?.termId ?? created?.item?.id ?? "");

        await loadWords();
        state.seg = seg;
        state.index = "all";
        applyFilter();

        const byId = newId && state.words.find((w) => w.id === newId);
        const byKw = !byId ? state.words.find((w) => w.keyword === keyword) : null;

        state.selectedId = byId?.id || byKw?.id || state.words[0]?.id || null;

        exitEditMode();
      } catch (e) {
        alert(`저장 실패: ${e?.message || e}`);
      }
      return;
    }

    const id = state.selectedId;
    if (!id) return;

    try {
      await apiJson(TERMS_API.update(id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: keyword, description: content }),
      });

      await loadWords();

      state.seg = seg;
      state.index = "all";
      state.selectedId = id;

      exitEditMode();
    } catch (e) {
      alert(`수정 실패: ${e?.message || e}`);
    }
  }

  // -----------------------------
  // Delete (✅ confirm() 제거 → 모달로)
  // -----------------------------
  async function deleteSelected() {
    if (state.isEditing) return;

    const word = state.words.find((w) => w.id === state.selectedId) || null;
    if (!word) return;

    openDeleteConfirmModal(word);
  }

  // -----------------------------
  // Events
  // -----------------------------
  function bindEvents() {
    $$(".word-seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.isEditing) return;
        state.seg = btn.dataset.seg;
        state.index = "all";

        $$(".word-seg-btn").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
          b.setAttribute("aria-selected", b === btn);
        });

        applyFilter();
        renderIndexBar();
        renderList();
      });
    });

    $("#indexBar")?.addEventListener("click", (e) => {
      if (state.isEditing) return;
      const btn = e.target.closest(".index-btn");
      if (!btn) return;
      state.index = btn.dataset.key;
      applyFilter();
      renderIndexBar();
      renderList();
    });

    $("#wordList")?.addEventListener("click", (e) => {
      if (state.isEditing) return;
      const item = e.target.closest(".word-item");
      if (!item) return;
      state.selectedId = item.dataset.id;
      renderList();
    });

    $("#btnEdit")?.addEventListener("click", () => enterEditMode("edit"));
    $("#btnAdd")?.addEventListener("click", () => enterEditMode("add"));
    $("#btnDelete")?.addEventListener("click", () => deleteSelected());

    document.addEventListener("keydown", (e) => {
      if (!state.isEditing) return;
      if (e.key === "Escape") exitEditMode();
    });

    bindModalEventsOnce();
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    await loadWords();
    applyFilter();
    renderIndexBar();
    renderList();
    bindEvents();
    syncEditingClasses();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
