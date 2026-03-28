(() => {
  "use strict";

  let WORDS = [];
  let bookmarks = [];
  let currentSeg = "ko";
  let currentIndex = "all";
  let selectedId = null;

  const API_BASE = "/economic";
  const BOOKMARK_API_BASE = "/bookmarks";

  // DOM 요소 안전하게 선택
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const elements = {
    indexBar: $("#indexBar"),
    listEl: $("#wordList"),
    detailTitle: $("#detailTitle"),
    detailMeta: $("#detailMeta"),
    detailContent: $("#detailContent"),
    detailStarBtn: $("#detailStarBtn"),
    detailStarIcon: $(".icon-star"),
    modal: $("#bookmarkModal"),
    bookmarkListEl: $("#bookmarkList"),
    bookmarkEmptyEl: $("#bookmarkEmpty"),
    panel: $(".word-panel"),
  };

  /* ==================
  1. 데이터 로드 및 통신
  ================== */
  function getSegment(term) {
    const char = (term || "").trim().charAt(0);
    if (/[가-힣]/.test(char)) return "ko";
    if (/[a-zA-Z]/.test(char)) return "en";
    if (/[0-9]/.test(char)) return "num";
    return "ko";
  }

  // ✅ (추가) 서버에서 비활성 용어(state=DISABLED)도 내려오는 경우를 대비한 필터
  function isDisabledRow(item) {
    const s = String(item?.state ?? "").toUpperCase().trim();
    return s === "DISABLED";
  }

  async function loadWords() {
    const res = await fetch(`${API_BASE}/terms`, {
      credentials: "include",
      cache: "no-store",
    });
    const json = await res.json();
    const dataList = json.data || [];

    // ✅ (중요) state=DISABLED는 WORDS에서 제외(단어사전에서 안 보이게)
    const activeList = dataList.filter((it) => !isDisabledRow(it));
    // DB 데이터를 받아서 분류 정보를 포함한 객체로 변환
    WORDS = activeList.map((item) => ({
      id: String(item.term_id),
      term: item.term,
      seg: getSegment(item.term),
      isBookmarked: item.is_bookmarked === 1,
      state: item.state, // 있으면 보관(디버그용)
    }));
  }

  async function loadMyBookmarks() {
    try {
      const res = await fetch(`${BOOKMARK_API_BASE}/me`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || []).map((b) => String(b.term_id));
    } catch (e) {
      return [];
    }
  }

  async function toggleBookmark(id) {
    if (!id) return false;
    const willAdd = !bookmarks.includes(id);
    const state = willAdd ? "ADD" : "CANCEL";

    try {
      const res = await fetch(`${BOOKMARK_API_BASE}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ term_id: id, state }),
      });

      if (res.status === 401) {
        alert("로그인 후 이용 가능합니다.");
        return false;
      }

      if (res.ok) {
        if (state === "ADD") {
          if (!bookmarks.includes(id)) bookmarks.push(id);
        } else {
          bookmarks = bookmarks.filter((x) => x !== id);
        }
        return true;
      }
    } catch (e) {
      console.error("북마크 통신 에러:", e);
    }
    return false;
  }

  // ✅ (추가) 비활성 용어 북마크를 서버에서도 강제 CANCEL
  async function cancelBookmarkServer(termId) {
    try {
      const res = await fetch(`${BOOKMARK_API_BASE}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ term_id: termId, state: "CANCEL" }),
      });
      return res.ok;
    } catch (e) {
      console.error("북마크 CANCEL 실패:", e);
      return false;
    }
  }

  // ✅ (추가) 현재 WORDS(활성 용어) 기준으로 북마크에 남은 비활성 용어를 자동 제거
  async function cleanupDisabledBookmarks() {
    const activeSet = new Set(WORDS.map((w) => String(w.id)));
    const disabledIds = bookmarks.filter((id) => !activeSet.has(String(id)));

    if (!disabledIds.length) return;

    // 1) 서버에서도 CANCEL
    await Promise.all(disabledIds.map((id) => cancelBookmarkServer(String(id))));

    // 2) 로컬에서도 제거
    bookmarks = bookmarks.filter((id) => activeSet.has(String(id)));
  }

  /* ==================
  2. 렌더링 함수
  ================== */
  function renderIndexBar() {
    if (!elements.indexBar) return;

    const KO_INDEX = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
    const EN_INDEX = [
      "A","B","C","D","E","F","G","H","I","J","K","L","M",
      "N","O","P","Q","R","S","T","U","V","W","X","Y","Z"
    ];
    const NUM_INDEX = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

    let targetIndex = [];
    if (currentSeg === "ko") targetIndex = KO_INDEX;
    else if (currentSeg === "en") targetIndex = EN_INDEX;
    else if (currentSeg === "num") targetIndex = NUM_INDEX;

    elements.indexBar.innerHTML = `
      <div class="index-pill">
        <button class="index-btn ${currentIndex === "all" ? "is-active" : ""}" data-key="all">전체</button>
        ${targetIndex
          .map(
            (k) => `
          <button class="index-btn ${currentIndex === k ? "is-active" : ""}" data-key="${k}">${k}</button>
        `
          )
          .join("")}
      </div>`;

    $$(".index-btn").forEach((btn) => {
      btn.onclick = () => {
        currentIndex = btn.dataset.key;
        renderIndexBar();
        renderList();
      };
    });
  }

  function getKoIndex(term) {
    const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    const CHO_NORM = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };
    const c = (term || "").charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const idx = Math.floor((c - 0xac00) / 588);
      const cho = CHO[idx];
      return CHO_NORM[cho] || cho;
    }
    return null;
  }

  function renderList() {
    if (!elements.listEl) return;

    let items = WORDS.filter((w) => w.seg === currentSeg);

    if (currentIndex !== "all") {
      items = items.filter((w) => {
        const term = (w.term || "").trim();
        const up = term.toUpperCase();
        if (currentSeg === "ko") {
          return getKoIndex(term) === currentIndex;
        }
        return up.charAt(0) === currentIndex;
      });
    }

    items.sort((a, b) => a.term.localeCompare(b.term, currentSeg === "ko" ? "ko" : "en"));

    if (!items.length) {
      elements.listEl.innerHTML = `<div class="word-empty">단어가 없습니다.</div>`;
      return;
    }

    if (!selectedId || !items.some((x) => x.id === selectedId)) {
      selectedId = items[0].id;
    }

    elements.listEl.innerHTML = items
      .map((w) => {
        const on = bookmarks.includes(w.id);
        return `
          <button class="word-item ${w.id === selectedId ? "is-selected" : ""}" data-id="${w.id}">
            <span class="word-item-title">${w.term}</span>
            <span class="word-item-right">
              <span class="star-mini ${on ? "is-on" : ""}" data-star="${w.id}">${on ? "★" : "☆"}</span>
            </span>
          </button>`;
      })
      .join("");

    // 리스트 클릭 이벤트 바인딩
    $$(".word-item").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-star]")) return;
        selectedId = el.dataset.id;
        renderList();
      };
    });

    // 리스트 내 별표 클릭 이벤트
    $$("[data-star]").forEach((el) => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const id = el.dataset.star;
        if (await toggleBookmark(id)) {
          renderList();
          if (selectedId === id) updateDetailStarUI();
        }
      };
    });

    renderDetail(selectedId);
  }

  async function renderDetail(id) {
    if (!id || !elements.detailTitle) return;

    try {
      const res = await fetch(`${API_BASE}/terms/${id}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const { data: w } = await res.json();

      // ✅ 혹시 상세가 DISABLED면 화면에서 자동으로 제외 처리
      if (isDisabledRow(w)) {
        // 목록을 다시 로드해서 최신화 후 렌더
        await loadWords();
        await cleanupDisabledBookmarks();
        renderIndexBar();
        renderList();
        return;
      }

      elements.detailTitle.textContent = w.term || "정보 없음";
      const ea = String(w.event_at || "");
      elements.detailMeta.textContent = ea ? ea.split("T")[0].slice(0, 10) : "";

      const desc = w.description || "설명이 등록되지 않았습니다.";
      elements.detailContent.innerHTML = desc
        .split("\n")
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join("");

      updateDetailStarUI();
    } catch (e) {
      console.error("상세 로드 실패:", e);
    }
  }

  function updateDetailStarUI() {
    if (!elements.detailStarIcon) return;
    const on = bookmarks.includes(selectedId);
    elements.detailStarIcon.textContent = on ? "★" : "☆";
    elements.detailStarIcon.classList.toggle("is-on", on);
  }

  /* ==================
  3. 이벤트 초기화
  ================== */
  function bindStaticEvents() {
    // 북마크 모달 열기
    $("#openBookmark").onclick = async () => {
      // ✅ 모달 열 때도 한 번 더 정리(관리자에서 삭제된 용어가 생길 수 있음)
      await cleanupDisabledBookmarks();
      elements.modal?.classList.add("is-open");
      renderBookmarkModalList();
    };

    // 모달 닫기 (여러 버튼 공통)
    $$("#closeBookmark, #closeBookmark2").forEach((btn) => {
      btn.onclick = () => elements.modal?.classList.remove("is-open");
    });

    // 세그먼트 버튼 (한글/영문/숫자)
    $$(".word-seg-btn").forEach((btn) => {
      btn.onclick = () => {
        $$(".word-seg-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        currentSeg = btn.dataset.seg;
        currentIndex = "all";
        renderIndexBar();
        renderList();
      };
    });

    // 상세페이지 별표 버튼
    if (elements.detailStarBtn) {
      elements.detailStarBtn.onclick = async () => {
        if (await toggleBookmark(selectedId)) {
          updateDetailStarUI();
          renderList();
        }
      };
    }

    // 전체 삭제 버튼
    const clearBtn = document.getElementById("clearBookmarks");
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (!confirm("저장된 북마크를 모두 삭제하시겠습니까?")) return;

        try {
          const res = await fetch(`${BOOKMARK_API_BASE}/clear`, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
          });

          if (res.ok) {
            bookmarks = [];
            alert("모든 북마크가 삭제되었습니다.");
            await renderBookmarkModalList();
            renderList();
          } else {
            const errorData = await res.json().catch(() => ({}));
            alert(`삭제 실패: ${errorData.message || "알 수 없는 오류"}`);
          }
        } catch (error) {
          console.error("전체 삭제 중 에러 발생:", error);
          alert("서버와 통신하는 중 문제가 발생했습니다.");
        }
      };
    }
  }

  async function renderBookmarkModalList() {
    if (!elements.bookmarkListEl) return;

    // 최신 서버 북마크 읽기
    const res = await fetch(`${BOOKMARK_API_BASE}/me`, {
      credentials: "include",
      cache: "no-store",
    });
    const json = await res.json();
    const items = json.data || [];

    // ✅ 활성 용어 집합(WORDS는 이미 DISABLED 제외)
    const activeSet = new Set(WORDS.map((w) => String(w.id)));

    // ✅ (핵심) 북마크 목록에 비활성 용어가 섞여 있으면 서버에서도 자동 CANCEL
    const disabledInBookmarks = items
      .map((it) => String(it.term_id))
      .filter((id) => !activeSet.has(id));

    if (disabledInBookmarks.length) {
      await Promise.all(disabledInBookmarks.map((id) => cancelBookmarkServer(id)));
      // 로컬 bookmarks도 같이 정리
      bookmarks = bookmarks.filter((id) => activeSet.has(String(id)));
    }

    // 화면에는 활성 용어만 표시
    const visibleItems = items.filter((it) => activeSet.has(String(it.term_id)));

    elements.bookmarkEmptyEl.hidden = visibleItems.length > 0;

    elements.bookmarkListEl.innerHTML = visibleItems
      .map(
        (w) => `
      <div class="bookmark-item" data-id="${w.term_id}"
           style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #eee; cursor:pointer;">
        <span style="flex:1; font-size:16px;"><strong>${w.term}</strong></span>
        <button class="word-outline-btn rm-btn" data-id="${w.term_id}" style="flex-shrink:0; margin-left:10px;">삭제</button>
      </div>
    `
      )
      .join("");

    const bookmarkRows = elements.bookmarkListEl.querySelectorAll(".bookmark-item");
    bookmarkRows.forEach((row) => {
      row.onclick = (e) => {
        if (e.target.classList.contains("rm-btn")) return;

        const id = String(row.dataset.id);
        const target = WORDS.find((w) => String(w.id) === id);

        if (target) {
          selectedId = id;
          currentSeg = target.seg;

          if (currentSeg === "ko") {
            currentIndex = getKoIndex(target.term);
          } else {
            currentIndex = (target.term || "").trim().charAt(0).toUpperCase();
          }

          $$(".word-seg-btn").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.seg === currentSeg);
          });

          renderIndexBar();
          renderList();

          elements.modal?.classList.remove("is-open");
        }
      };
    });

    // 북마크 목록에서 개별 삭제
    $$(".rm-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (await toggleBookmark(String(btn.dataset.id))) {
          renderBookmarkModalList();
          renderList();
        }
      };
    });
  }

  async function init() {
    await loadWords();
    bookmarks = await loadMyBookmarks();

    // ✅ (추가) 비활성 용어 북마크 자동 제거(서버+로컬)
    await cleanupDisabledBookmarks();

    bindStaticEvents();
    renderIndexBar();
    renderList();

    elements.panel?.classList.remove("is-loading");
  }

  // 문서 로드 시 실행
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
