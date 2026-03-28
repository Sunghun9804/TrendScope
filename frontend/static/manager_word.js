(() => {
  "use strict";

  // 0) 필요한 DOM이 "나중에" 생겨도 잡아내기
  const REQUIRED_IDS = ["indexBar", "wordList", "detailTitle", "detailMeta", "detailContent"];
  let started = false;

  function hasAllRequiredDom() {
    return REQUIRED_IDS.every(id => document.getElementById(id));
  }

  function boot() {
    if (started) return;

    if (!hasAllRequiredDom()) {
      const mo = new MutationObserver(() => {
        if (hasAllRequiredDom()) {
          mo.disconnect();
          boot();
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 15000);
      return;
    }

    started = true;
    startWordAdmin(); // 여기서 본 로직 시작
  }

  // 필요하면 외부에서 수동 호출 가능
  window.initWordAdminPage = boot;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 1) 여기부터 네 기존 로직을 "그대로" 넣기
  function startWordAdmin() {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    // DOM 레퍼런스: p;l/;9l처음엔 비워두고, init에서 채운다
    let indexBar, listEl, detailTitle, detailMeta, detailContent;
    let btnAdd, btnEdit, btnDelete;
    let modalBackdrop, modalTitle, modalBody, modalFoot;
    let modalEl;

    function cacheDom() {
      indexBar = $("#indexBar");
      listEl = $("#wordList");
      detailTitle = $("#detailTitle");
      detailMeta = $("#detailMeta");
      detailContent = $("#detailContent");

      btnAdd = $("#btnAdd");
      btnEdit = $("#btnEdit");
      btnDelete = $("#btnDelete");

      modalBackdrop = $("#wordModal");
      modalTitle = $("#wmTitle");
      modalBody = $("#wmBody");
      modalFoot = $("#wmFoot");

      modalEl = modalBackdrop?.querySelector(".modal");

      return !!(indexBar && listEl && detailTitle && detailMeta && detailContent);
    }

    // ===== init을 "DOM 준비된 다음"에 1번만 실행 =====
    let __started = false;

    function boot() {
      if (__started) return;

      // DOM이 이미 있으면 즉시 init
      if (cacheDom()) {
        __started = true;
        init();
        return;
      }

      // 아직 없으면: 생길 때까지 관찰
      const mo = new MutationObserver(() => {
        if (cacheDom()) {
          mo.disconnect();
          __started = true;
          init();
        }
      });

      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 15000);
    }

    // 페이지 조각 로딩이면 외부에서 수동 호출도 가능
    window.initWordAdminPage = boot;

    const KO_INDEX = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
    const EN_INDEX = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const NUM_INDEX = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

    const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
    const CHO_NORM = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };

    // ===== State =====
    const state = {
      words: /** @type {Array<{id:string, seg:'ko'|'en'|'num', term:string, en:string, updatedAt:string, body:string[], indexKey:string|null}>} */ ([]),
      byId: new Map(),
      seg: /** @type {'ko'|'en'|'num'} */ ("ko"),
      index: "all",
      selectedId: /** @type {string|null} */ (null),
    };

    // ===== Utils =====
    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function randomId() {
      return (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `r${Math.random().toString(16).slice(2)}${Date.now()}`;
    }

    function nowLabel() {
      const d = new Date();
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yy}.${mm}.${dd} 수정`;
    }

    function splitKeyword(keyword) {
      const s = String(keyword ?? "").trim();
      const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);
      if (!m) return { term: s, en: "" };
      return { term: m[1].trim(), en: m[2].trim() };
    }

    function tabToSeg(tab, term) {
      const t = String(tab || "").toUpperCase().trim();
      if (t === "KOR") return "ko";
      if (t === "ENG") return "en";
      if (t === "NUM") return "num";

      const first = (term || "").trim()[0] || "";
      if (first >= "0" && first <= "9") return "num";
      if ((first >= "A" && first <= "Z") || (first >= "a" && first <= "z")) return "en";
      return "ko";
    }

    function formatUpdatedAt(iso) {
      const s = String(iso || "").trim();
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yy}.${mm}.${dd} 수정`;
    }

    function getKoIndex(term) {
      const c = (term || "").trim().charCodeAt(0);
      if (!c) return null;
      if (c >= 0xAC00 && c <= 0xD7A3) {
        const idx = Math.floor((c - 0xAC00) / 588);
        const cho = CHO[idx] || null;
        return CHO_NORM[cho] || cho;
      }
      return null;
    }
    function getEnIndex(term) {
      const first = (term || "").trim()[0];
      if (!first) return null;
      const up = first.toUpperCase();
      return (up >= "A" && up <= "Z") ? up : null;
    }
    function getNumIndex(term) {
      const first = (term || "").trim()[0];
      if (!first) return null;
      return (first >= "0" && first <= "9") ? first : null;
    }
    function computeIndexKey(seg, term) {
      if (seg === "ko") return getKoIndex(term);
      if (seg === "en") return getEnIndex(term);
      return getNumIndex(term);
    }

    // ===== Data =====
    async function loadWordsFromJson(url = "/view/word.json") {
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();

      if (!res.ok) throw new Error(`JSON 요청 실패: ${res.status} ${res.statusText}\n${text.slice(0, 160)}`);

      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error(`JSON 파싱 실패(응답이 JSON이 아닐 수 있음): ${text.slice(0, 160)}`);
      }

      const arr =
        Array.isArray(raw) ? raw :
          Array.isArray(raw.data) ? raw.data :
            Array.isArray(raw.words) ? raw.words :
              Array.isArray(raw.items) ? raw.items :
                null;

      if (!arr) throw new Error("JSON이 배열이 아니고, data/words/items도 없음");

      const seen = new Set();
      const words = [];

      for (const row of arr) {
        if (!row) continue;

        const tid = String(row.term_id ?? "").trim();
        const id = tid ? `kdi_${tid}` : `kdi_${randomId()}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const { term, en } = splitKeyword(row.keyword || "");
        const seg = tabToSeg(row.tab, term);

        const body = String(row.content || "")
          .split(/\n\s*\n/g)
          .map(s => s.trim())
          .filter(Boolean);

        const updatedAt = formatUpdatedAt(row.scraped_at);
        const indexKey = computeIndexKey(seg, term);

        words.push({ id, seg, term, en, updatedAt, body, indexKey });
      }

      return words;
    }

    // ===== Render: Seg =====
    function syncSegButtons() {
      $$(".word-seg-btn").forEach(b => {
        const on = b.dataset.seg === state.seg;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    // ===== Render: IndexBar =====
    function renderIndexBtn(key, label) {
      const on = key === state.index ? "is-active" : "";
      return `<button class="index-btn ${on}" type="button" data-key="${key}">${label}</button>`;
    }

    function renderIndexBar() {
      const list = state.seg === "ko" ? KO_INDEX : state.seg === "en" ? EN_INDEX : NUM_INDEX;

      indexBar.innerHTML = `
    <div class="index-pill" role="tablist" aria-label="인덱스 선택">
      ${renderIndexBtn("all", "전체")}
      ${list.map(k => renderIndexBtn(k, k)).join("")}
    </div>
  `;
    }


    // ===== Render: List / Detail =====
    function getFilteredWords() {
      let arr = state.words.filter(w => w.seg === state.seg);
      if (state.index !== "all") arr = arr.filter(w => w.indexKey === state.index);

      const locale = (state.seg === "en") ? "en" : "ko";
      return arr.slice().sort((a, b) => a.term.localeCompare(b.term, locale));
    }

    function renderDetail(id) {
      const w = state.byId.get(id);
      if (!w) return;

      detailTitle.innerHTML = `
        ${escapeHtml(w.term)}
        ${w.en ? ` <small>(${escapeHtml(w.en)})</small>` : ""}
      `;
      detailMeta.textContent = w.updatedAt || "";
      detailContent.innerHTML = (w.body || []).map(p => `<p>${escapeHtml(p)}</p>`).join("");
    }

    function setSelected(id) {
      state.selectedId = id;

      $$(".word-item", listEl).forEach(el => {
        const on = el.dataset.id === id;
        el.classList.toggle("is-selected", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });

      if (!id) {
        detailTitle.textContent = "단어를 선택하세요";
        detailMeta.textContent = "";
        detailContent.innerHTML = `
          <div class="word-empty">
            <div class="word-empty-emoji">📘</div>
          </div>
        `;
        return;
      }
      renderDetail(id);
    }

    function renderList() {
      const items = getFilteredWords();

      if (!items.length) {
        listEl.innerHTML = `
          <div class="word-empty" style="min-height:240px;">
            <div class="word-empty-title">해당 조건의 단어가 없어요</div>
          </div>
        `;
        setSelected(null);
        return;
      }

      if (!state.selectedId || !items.some(x => x.id === state.selectedId)) {
        state.selectedId = items[0].id;
      }

      listEl.innerHTML = items.map(w => {
        const selected = w.id === state.selectedId;
        return `
          <div class="word-item ${selected ? "is-selected" : ""}"
               data-id="${w.id}"
               role="option"
               tabindex="0"
               aria-selected="${selected}">
            <span class="word-item-title">${escapeHtml(w.term)}</span>
            <span class="word-item-right">
              <span class="play-mini" aria-hidden="true">▶</span>
            </span>
          </div>
        `;
      }).join("");

      renderDetail(state.selectedId);
    }

    // ===== Modal =====
    function openModal({ title, bodyHtml, footHtml, onBind }) {
      if (!modalBackdrop || !modalTitle || !modalBody || !modalFoot) return;

      if (modalEl) {
        modalEl.classList.toggle("is-confirm", variant === "confirm");
      }

      modalTitle.textContent = title;
      modalBody.innerHTML = bodyHtml;
      modalFoot.innerHTML = footHtml;
      modalBackdrop.classList.add("is-open");

      const onBackdrop = (e) => { if (e.target === modalBackdrop) closeModal(); };
      modalBackdrop.addEventListener("click", onBackdrop, { once: true });

      const onEsc = (e) => { if (e.key === "Escape") closeModal(); };
      document.addEventListener("keydown", onEsc, { once: true });

      modalBackdrop.querySelectorAll("[data-wm-close]").forEach(btn => btn.addEventListener("click", closeModal));

      onBind?.();
      modalBody.querySelector("input, textarea, select, button")?.focus?.();
    }
    function closeModal() {
      modalBackdrop?.classList.remove("is-open");

      if (modalEl) modalEl.classList.remove("is-confirm");
    }

    function wordToTextarea(bodyArr) {
      return (bodyArr || []).join("\n\n");
    }
    function textareaToBody(text) {
      return String(text || "")
        .split(/\n\s*\n/g)
        .map(s => s.trim())
        .filter(Boolean);
    }

    function upsertWordLocal(nextWord) {
      if (nextWord.id.startsWith("local_")) {
        const idx = edits.added.findIndex(x => x.id === nextWord.id);
        if (idx >= 0) edits.added[idx] = nextWord;
        else edits.added.unshift(nextWord);
      } else {
        edits.updated[nextWord.id] = {
          seg: nextWord.seg,
          term: nextWord.term,
          en: nextWord.en,
          body: nextWord.body,
          updatedAt: nextWord.updatedAt,
          indexKey: nextWord.indexKey,
        };
      }
      saveEdits();
    }

    function deleteWordLocal(id) {
      if (!id) return;
      if (id.startsWith("local_")) {
        edits.added = edits.added.filter(x => x.id !== id);
      } else {
        if (!edits.deleted.includes(id)) edits.deleted.push(id);
        if (edits.updated[id]) delete edits.updated[id];
      }
      saveEdits();
    }

    const EDITS_KEY = "ts_word_admin_edits_v1";

    function loadEdits() {
      try {
        const raw = localStorage.getItem(EDITS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object"
          ? {
            added: Array.isArray(parsed.added) ? parsed.added : [],
            updated: parsed.updated && typeof parsed.updated === "object" ? parsed.updated : {},
            deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
          }
          : { added: [], updated: {}, deleted: [] };
      } catch {
        return { added: [], updated: {}, deleted: [] };
      }
    }

    const edits = loadEdits();

    function saveEdits() {
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
    }

    function applyEdits(baseWords) {
      const byId = new Map(baseWords.map(w => [w.id, w]));

      // updated
      for (const [id, patch] of Object.entries(edits.updated)) {
        if (!byId.has(id)) continue;
        const prev = byId.get(id);
        const next = { ...prev, ...patch };
        next.indexKey = computeIndexKey(next.seg, next.term);
        byId.set(id, next);
      }

      // deleted
      for (const id of edits.deleted) byId.delete(id);

      // added
      for (const w of edits.added) {
        if (!w || !w.id) continue;
        byId.set(w.id, w);
      }

      return Array.from(byId.values());
    }

    function rebuildStateFromBase(baseWords) {
      const merged = applyEdits(baseWords);
      state.words = merged.map(w => ({ ...w, indexKey: computeIndexKey(w.seg, w.term) }));
      state.byId = new Map(state.words.map(w => [w.id, w]));
    }

    function refreshUI(keepSelection = true) {
      if (!keepSelection) state.selectedId = null;
      if (state.selectedId && !state.byId.has(state.selectedId)) state.selectedId = null;
      renderIndexBar();
      renderList();
    }

    // ===== Toolbar actions =====
    function openAddModal() {
      openModal({
        title: "용어 추가",
        bodyHtml: `
          <div class="wm-form">
            <label class="wm-label">분류</label>
            <select class="wm-input" id="wmSeg">
              <option value="ko">한글</option>
              <option value="en">영문</option>
              <option value="num">숫자</option>
            </select>

            <label class="wm-label" style="margin-top:10px;">용어</label>
            <input class="wm-input" id="wmTerm" placeholder="예) 고용" />

            <label class="wm-label" style="margin-top:10px;">영문(선택)</label>
            <input class="wm-input" id="wmEn" placeholder="예) Employment" />

            <label class="wm-label" style="margin-top:10px;">설명</label>
            <textarea class="wm-textarea" id="wmBody" rows="8" placeholder="문단은 빈 줄로 구분"></textarea>
          </div>
        `,
        footHtml: `
          <button class="word-outline-btn" type="button" data-wm-close>취소</button>
          <button class="word-primary-btn" type="button" id="wmSave">저장</button>
        `,
        onBind: () => {
          $("#wmSeg").value = state.seg;
          $("#wmSave").addEventListener("click", () => {
            const seg = ($("#wmSeg").value || "ko");
            const term = String($("#wmTerm").value || "").trim();
            const en = String($("#wmEn").value || "").trim();
            const body = textareaToBody($("#wmBody").value);

            if (!term) { alert("용어(단어)는 필수야."); $("#wmTerm").focus(); return; }

            const id = `local_${randomId()}`;
            const w = { id, seg, term, en, updatedAt: nowLabel(), body, indexKey: computeIndexKey(seg, term) };

            edits.added.unshift(w);
            saveEdits();

            state.words = applyEdits(state.words);
            state.byId = new Map(state.words.map(x => [x.id, x]));
            state.selectedId = id;

            closeModal();
            refreshUI(true);
          });
        },
      });
    }

    function openEditModal() {
      if (!state.selectedId) { alert("편집할 단어를 먼저 선택해줘."); return; }
      const w0 = state.byId.get(state.selectedId);
      if (!w0) return;

      openModal({
        title: "용어 편집",
        bodyHtml: `
          <div class="wm-form">
            <label class="wm-label">분류</label>
            <select class="wm-input" id="wmSeg">
              <option value="ko">한글</option>
              <option value="en">영문</option>
              <option value="num">숫자</option>
            </select>

            <label class="wm-label" style="margin-top:10px;">용어</label>
            <input class="wm-input" id="wmTerm" />

            <label class="wm-label" style="margin-top:10px;">영문(선택)</label>
            <input class="wm-input" id="wmEn" />

            <label class="wm-label" style="margin-top:10px;">설명</label>
            <textarea class="wm-textarea" id="wmBody" rows="8"></textarea>
          </div>
        `,
        footHtml: `
          <button class="word-outline-btn" type="button" data-wm-close>취소</button>
          <button class="word-primary-btn" type="button" id="wmSave">저장</button>
        `,
        onBind: () => {
          $("#wmSeg").value = w0.seg;
          $("#wmTerm").value = w0.term;
          $("#wmEn").value = w0.en || "";
          $("#wmBody").value = wordToTextarea(w0.body);

          $("#wmSave").addEventListener("click", () => {
            const seg = ($("#wmSeg").value || w0.seg);
            const term = String($("#wmTerm").value || "").trim();
            const en = String($("#wmEn").value || "").trim();
            const body = textareaToBody($("#wmBody").value);

            if (!term) { alert("용어(단어)는 필수야."); $("#wmTerm").focus(); return; }

            const next = { ...w0, seg, term, en, body, updatedAt: nowLabel(), indexKey: computeIndexKey(seg, term) };
            upsertWordLocal(next);

            state.byId.set(next.id, next);
            state.words = Array.from(state.byId.values());

            closeModal();
            refreshUI(true);
          });
        },
      });
    }

    function openModal({ title = "", bodyHtml = "", footHtml = "", onBind, variant = "default" } = {}) {
      // 혹시 캐시가 안 되어있을 수 있으니 한번 더 보장
      if (!modalBackdrop || !modalBody || !modalFoot) cacheDom();

      if (!modalBackdrop || !modalBody || !modalFoot) return;

      // modalEl은 열 때마다 최신 DOM으로 다시 잡는 게 안전
      modalEl = modalBackdrop.querySelector(".modal");

      // confirm 모드 토글
      if (modalEl) {
        modalEl.classList.toggle("is-confirm", variant === "confirm");
      }

      if (modalTitle) modalTitle.textContent = title;
      modalBody.innerHTML = bodyHtml;
      modalFoot.innerHTML = footHtml;

      modalBackdrop.classList.add("is-open");

      const onBackdrop = (e) => { if (e.target === modalBackdrop) closeModal(); };
      modalBackdrop.addEventListener("click", onBackdrop, { once: true });

      const onEsc = (e) => { if (e.key === "Escape") closeModal(); };
      document.addEventListener("keydown", onEsc, { once: true });

      modalBackdrop.querySelectorAll("[data-wm-close]").forEach(btn =>
        btn.addEventListener("click", closeModal)
      );

      onBind?.();
      modalBody.querySelector("input, textarea, select, button")?.focus?.();
    }

    function closeModal() {
      if (!modalBackdrop) return;
      modalBackdrop.classList.remove("is-open");

      // 닫을 때 confirm 모드 원복
      const m = modalBackdrop.querySelector(".modal");
      if (m) m.classList.remove("is-confirm");
    }

    // ===== Events =====
    function bindEvents() {
      $$(".word-seg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          state.seg = (btn.dataset.seg || "ko");
          state.index = "all";
          state.selectedId = null;
          syncSegButtons();
          renderIndexBar();
          renderList();
        });
      });

      indexBar.addEventListener("click", (e) => {
        const btn = e.target.closest(".index-btn");
        if (!btn) return;
        state.index = btn.dataset.key || "all";
        renderIndexBar();
        renderList();
      });

      listEl.addEventListener("click", (e) => {
        const item = e.target.closest(".word-item");
        if (!item) return;
        setSelected(item.dataset.id);
      });

      listEl.addEventListener("keydown", (e) => {
        const item = e.target.closest(".word-item");
        if (!item) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelected(item.dataset.id);
        }
      });

      btnAdd?.addEventListener("click", openAddModal);
      btnEdit?.addEventListener("click", openEditModal);
      btnDelete?.addEventListener("click", openDeleteModal);
    }

    // ===== Init =====
    async function init() {
      if (!cacheDom()) return;

      try {
        const baseWords = await loadWordsFromJson("/view/word.json");
        rebuildStateFromBase(baseWords);
      } catch (err) {
        console.error(err);
        listEl.innerHTML = `<div class="word-empty" style="min-height:240px;">
          <div class="word-empty-title">데이터 불러오기 실패</div>
        </div>`;
        setSelected(null);
      }

      bindEvents();
      syncSegButtons();
      renderIndexBar();
      renderList();
    }

    init(); // startWordAdmin 들어오면 실행
  }
})();