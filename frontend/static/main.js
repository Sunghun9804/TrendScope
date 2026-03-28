// #region 확인끝
// #region ===== 전역변수 =====
let KEYWORDS = [];

// dropdownApi는 selectKeyword에서 쓰므로 위에 선언 (TDZ 방지)
let dropdownApi = null;

const SUMMARY_MAP = {
  "주식": ["(샘플) 요약/선정이유 영역입니다.", "실제 서버 요약으로 교체하세요."],
};

const ts3Root = document.getElementById('main3');
const ts3Canvas = document.getElementById('ts3LineCanvas');
const ts3KlistEl = ts3Root?.querySelector(".ts3-klist") ?? null;
const ts3WordTag = ts3Root?.querySelector('#ts3WordTag') ?? null;
const ts3DonutTag = ts3Root?.querySelector('#ts3DonutTag') ?? null;
const ts3DonutEl = ts3Root?.querySelector('#ts3Donut') ?? null;
const ts3CloudEl = ts3Root?.querySelector('#ts3WordCloud') ?? null;
const ts3Placeholder = ts3Root?.querySelector('.ts3-placeholder') ?? null;
const btns = ts3Root ? Array.from(ts3Root.querySelectorAll('.ts3-kbtn')) : [];
// #endregion

// #region ===== DOM =====
const rankListEl = document.getElementById("rankList");
const summaryKeywordEl = document.getElementById("summaryKeyword");
const summaryListEl = document.getElementById("summaryList");
const segmentedBtns = Array.from(document.querySelectorAll(".seg-btn"));
const startDateEl = document.getElementById("startDate");
const endDateEl = document.getElementById("endDate");
// #endregion

// #region ===== util =====
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseISO(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function normalize(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, days) {
  const x = normalize(d);
  x.setDate(x.getDate() + days);
  return x;
}
function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate(); // m: 0~11
}
function addYearsClamp(date, deltaYears) {
  const d = normalize(date);
  const y = d.getFullYear() + deltaYears;
  const m = d.getMonth();
  const day = d.getDate();
  const last = daysInMonth(y, m);
  return new Date(y, m, Math.min(day, last));
}
function addMonthsClamp(date, deltaMonths) {
  const d = normalize(date);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const target = new Date(y, m + deltaMonths, 1);
  const ty = target.getFullYear();
  const tm = target.getMonth();
  const last = daysInMonth(ty, tm);
  return new Date(ty, tm, Math.min(day, last));
}
function clearSegActive() {
  segmentedBtns.forEach((b) => {
    b.classList.remove("is-active");
    b.setAttribute("aria-selected", "false");
  });
}
function setSegActive(grain) {
  segmentedBtns.forEach((b) => {
    const on = b.dataset.grain === grain;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

// ===== mode 결정 =====
function getActiveMode() {
  // 버튼이 활성화면 day/week/month/year, 아니면 자유기간 range
  return document.querySelector(".seg-btn.is-active")?.dataset.grain || "range";
}
function getActiveGrainForChart() {
  // 차트 라벨은 seg 활성 기준으로, 없으면 "day"로 표시
  return document.querySelector(".seg-btn.is-active")?.dataset.grain || "day";
}
// #endregion

// #region ===== donut util =====
function getDonutWrap() {
  if (!ts3DonutEl) return null;
  return ts3DonutEl.closest(".ts3-donutwrap") || ts3DonutEl.parentElement;
}

function clearDonutLabels() {
  const wrap = getDonutWrap();
  if (!wrap) return;
  wrap.querySelectorAll(".donut-anno").forEach((el) => el.remove());
}

// ✅ 마지막 도넛 퍼센트(리사이즈 재배치용) - renderDonutPercentLabels 밖(전역/모듈 스코프)
let __lastDonutPcts = null;

// ✅ resize 연타 방지
let __donutRaf = 0;

// ✅ 리스너/옵저버 1회만 바인딩
let __donutBound = false;
let __donutRO = null;
let __donutMql = null;

function scheduleDonutLabelRerender() {
  if (!__lastDonutPcts) return;
  cancelAnimationFrame(__donutRaf);
  __donutRaf = requestAnimationFrame(() => {
    renderDonutPercentLabels(__lastDonutPcts.pos, __lastDonutPcts.neu, __lastDonutPcts.neg);
  });
}

function bindDonutLabelAutoRerenderOnce() {
  if (__donutBound) return;

  const wrap = getDonutWrap();
  if (!wrap) return; // wrap 아직 없으면(초기 렌더 타이밍) 다음 render에서 다시 시도됨

  __donutBound = true;

  window.addEventListener("resize", scheduleDonutLabelRerender, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleDonutLabelRerender);

  __donutMql = window.matchMedia("(max-width: 520px)");
  __donutMql.addEventListener?.("change", scheduleDonutLabelRerender);

  if (typeof ResizeObserver !== "undefined") {
    __donutRO = new ResizeObserver(() => scheduleDonutLabelRerender());
    __donutRO.observe(wrap);
  }
}

function renderDonutPercentLabels(pPos, pNeu, pNeg) {
  if (!ts3DonutEl) return;

  // 라벨 자동 재배치(리사이즈/컨테이너 변화)
  bindDonutLabelAutoRerenderOnce();

  const wrapEl = getDonutWrap();
  if (!wrapEl) return;

  // 기존 라벨 제거
  clearDonutLabels();

  const COLOR = { pos: "#0073ff", neu: "#8a97ad", neg: "#ff0000" };

  const segments = [
    { key: "pos", pct: Number(pPos) || 0, color: COLOR.pos },
    { key: "neu", pct: Number(pNeu) || 0, color: COLOR.neu },
    { key: "neg", pct: Number(pNeg) || 0, color: COLOR.neg },
  ].filter((s) => s.pct > 0);

  if (!segments.length) return;

  const wrapRect = wrapEl.getBoundingClientRect();
  const donutRect = ts3DonutEl.getBoundingClientRect();
  const w = wrapRect.width;
  const h = wrapRect.height;

  // 레이아웃 아직 0이면 다음 프레임에 재시도
  if (!w || !h || !donutRect.width || !donutRect.height) {
    requestAnimationFrame(() => renderDonutPercentLabels(pPos, pNeu, pNeg));
    return;
  }

  // 도넛 중심 좌표(랩 기준)
  const cx = donutRect.left - wrapRect.left + donutRect.width / 2;
  const cy = donutRect.top - wrapRect.top + donutRect.height / 2;
  const size = Math.min(donutRect.width, donutRect.height);
  const rOuter = size * 0.5;

  const isMobile = window.matchMedia("(max-width: 520px)").matches;

  // 모바일: 안쪽, PC: 바깥쪽
  const LABEL_MODE = isMobile ? "inside" : "outside";
  const OUTSIDE_GAP = isMobile ? 6 : 13;
  const INSIDE_RATIO = isMobile ? 0.80 : 0.84;

  const rDesired =
    LABEL_MODE === "inside" ? rOuter * INSIDE_RATIO : rOuter + OUTSIDE_GAP;

  // inside일 때만 “박스 밖으로 튀지 않게” 전역 상한 적용
  const margin = 10;
  const sideNudge = 6;

  const rMaxGlobal = Math.max(
    0,
    Math.min(
      cx - margin,
      (w - margin) - cx,
      cy - margin,
      (h - margin) - cy
    )
  );

  const rFixed =
    LABEL_MODE === "inside"
      ? Math.min(rDesired, rMaxGlobal)
      : rDesired; // PC outside는 반경 유지

  // wrapEl positioning
  const csWrap = getComputedStyle(wrapEl);
  if (csWrap.position === "static") wrapEl.style.position = "relative";
  wrapEl.style.overflow = (LABEL_MODE === "outside") ? "visible" : "hidden";

  // SVG 라벨 레이어
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("donut-anno");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";

  let acc = 0; // 누적 퍼센트
  segments.forEach((seg) => {
    const startDeg = acc * 3.6;
    const endDeg = (acc + seg.pct) * 3.6;
    const midDeg = (startDeg + endDeg) / 2;
    acc += seg.pct;

    const rad = (midDeg - 90) * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const isRight = cos >= 0;

    let x = cx + rFixed * cos;
    let y = cy + rFixed * sin;

    // 좌/우 살짝 밀어서 겹침 완화
    x += isRight ? sideNudge : -sideNudge;

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = `${seg.pct}%`;
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("text-anchor", isRight ? "start" : "end");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", "12");
    text.setAttribute("font-weight", "900");
    text.setAttribute("fill", seg.color);

    // 흰색 외곽선(가독성)
    text.setAttribute("paint-order", "stroke");
    text.setAttribute("stroke", "#ffffff");
    text.setAttribute("stroke-width", "3");

    svg.appendChild(text);
  });

  wrapEl.appendChild(svg);
}

// ===============================
// TS2 기사 상세 팝업 모달 (전역)
// ===============================
// #region ===== 랭킹 렌더 유틸 =====
function fmtRate(n) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num}%`;
}
function rateClass(n) {
  if (n === null || n === undefined) return "is-flat";
  const num = Number(n);
  if (num > 0) return "is-up";
  if (num < 0) return "is-down";
  return "is-flat";
}
function moveText(badge, rankChange) {
  if (!badge) return "-"; // range 등 비교 없음
  if (badge === "NEW") return "NEW";
  if (badge === "UP") return `▲${Math.abs(Number(rankChange || 0))}`;
  if (badge === "DOWN") return `▼${Math.abs(Number(rankChange || 0))}`;
  return "-";
}
function moveClassByBadge(badge) {
  if (!badge) return "is-flat";
  if (badge === "NEW") return "is-new";
  if (badge === "UP") return "is-up";
  if (badge === "DOWN") return "is-down";
  return "is-flat";
}
function renderRanking(selectedKeyword) {
  if (!rankListEl) return;
  rankListEl.innerHTML = "";

  const top = KEYWORDS.slice(0, 10);

  if (!top.length) {
    rankListEl.innerHTML = `
      <div class="rank-empty">
        <div class="rank-empty-title">해당 기간의 랭킹 데이터가 없어요</div>
        <div class="rank-empty-sub">기간을 바꿔 다시 시도해보세요.</div>
      </div>
    `;
    return;
  }

  top.forEach((k) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "rank-row rank-item" + (k.keyword === selectedKeyword ? " is-selected" : "");
    row.setAttribute("role", "listitem");

    row.innerHTML = `
      <div class="c-rank"><span class="rank-badge">${k.rank ?? "-"}</span></div>
      <div class="c-keyword">${k.keyword ?? "-"}</div>
      <div class="c-count">${k.count ?? "-"}</div>
      <div class="c-rate ${rateClass(k.change_rate)}">${fmtRate(k.change_rate)}</div>
      <div class="c-move ${moveClassByBadge(k.badge)}">${moveText(k.badge, k.rank_change)}</div>
    `;

    row.addEventListener("click", () => selectKeyword(k.keyword));
    rankListEl.appendChild(row);
  });
}

// ===== 요약 렌더링 =====
function renderSummary(keyword) {
  if (!summaryKeywordEl || !summaryListEl) return;

  summaryKeywordEl.textContent = keyword;
  summaryListEl.innerHTML = "";

  // 1) 랭킹 응답(KEYWORDS)에서 현재 키워드 item 찾기
  const item = (KEYWORDS || []).find(x => x.keyword === keyword);

  // 2) 서버가 내려주는 형태: item.summary (지금은 summary_text를 바로 넣는 중)
  const reasonRaw = String(item?.summary ?? "").trim();
  const mode = getActiveMode(); // day | week | month | year | range (모드 확인)

  // 3) 아직 없으면 안내 문구
  if (!reasonRaw) {
    const li = document.createElement("li");
    if (mode === "day") {
      li.textContent = "해당 날짜의 랭킹 키워드 선정 이유가 아직 생성되지 않았습니다.";
    } else {
      li.innerHTML = '랭킹 키워드 선정 이유는 <span class="highlight-blue">일별 선택</span> 시에만 제공됩니다.';
    }
    summaryListEl.appendChild(li);
    return;
  }

  // 4) 줄 단위로 쪼개되, 번호/불릿 제거해서 li에 넣기
  const lines = reasonRaw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^\s*(?:\d+[\.\)]|[-•▪■])\s*/, "").trim())
    .filter(Boolean);

  // 라인이 0이면 원문 그대로
  const finalLines = lines.length ? lines : [reasonRaw];

  finalLines.forEach((txt) => {
    const li = document.createElement("li");
    li.textContent = txt;
    summaryListEl.appendChild(li);
  });
}


// #region ===== 키워드 선택(랭킹/드롭다운 공통) =====
function selectKeyword(keyword) {
  if (!keyword) return;

  // 1) UI 동기화 (랭킹 리스트 & 드롭다운)
  renderRanking(keyword);
  dropdownApi?.setValue(keyword);

  // 2) 키워드 요약 영역 업데이트
  renderSummary(keyword);

  // 3) 뉴스 리스트(TS2) 업데이트
  if (window.ts2Api) window.ts2Api.setKeyword(keyword);

  // 4) 상세 분석(TS3) 업데이트
  if (window.ts3Api) window.ts3Api.setKeyword(keyword);
}
window.selectKeyword = selectKeyword;
// #endregion

// =====================================================
// 1) 키워드 드롭다운
// =====================================================
(function () {
  const root = document.getElementById("keywordDropdown");
  if (!root) return;

  const btn = root.querySelector(".cselect__btn");
  const list = root.querySelector(".cselect__list");
  const valueEl = root.querySelector(".cselect__value");
  const hidden = root.querySelector('input[type="hidden"]');

  let activeIndex = 0;

  if (!btn || !list || !valueEl) return;

  function close() {
    root.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  function toggle() {
    root.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", root.classList.contains("is-open") ? "true" : "false");
  }

  function getOptions() {
    return Array.from(list.querySelectorAll(".cselect__opt"));
  }

  function applyValue(v) {
    const options = getOptions();
    if (!options.length) return;

    options.forEach((o) => {
      const isMatch = (o.dataset.value ?? o.textContent.trim()) === v;
      o.classList.toggle("is-selected", isMatch);
      if (isMatch) o.setAttribute("aria-selected", "true");
      else o.removeAttribute("aria-selected");
    });

    valueEl.textContent = v;
    if (hidden) hidden.value = v;

    const idx = options.findIndex((o) => (o.dataset.value ?? o.textContent.trim()) === v);
    if (idx >= 0) activeIndex = idx;
  }

  list.addEventListener("click", (e) => {
    const opt = e.target.closest(".cselect__opt");
    if (!opt) return;
    const v = opt.dataset.value ?? opt.textContent.trim();
    applyValue(v);
    close();
    selectKeyword(v);
  });

  root.addEventListener("click", (e) => {
    if (e.target.closest(".cselect__btn")) {
      e.preventDefault();
      toggle();
    }
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) close();
  });

  dropdownApi = {
    setValue(v) {
      applyValue(v);
    },
  };

  const initial = (hidden?.value || valueEl.textContent || "주식").trim();
  applyValue(initial);
})();

// 드롭다운 옵션을 랭킹 키워드로 재생성
function rebuildKeywordDropdownFromRanking(items) {
  const root = document.getElementById("keywordDropdown");
  if (!root || !items.length) return;

  const list = root.querySelector(".cselect__list");
  const valueEl = root.querySelector(".cselect__value");
  if (!list) return;

  list.innerHTML = items
    .slice(0, 10)
    .map(
      (it, idx) => `
        <li class="cselect__opt ${idx === 0 ? "is-selected" : ""}"
            role="option"
            data-value="${it.keyword}"
            aria-selected="${idx === 0 ? "true" : "false"}">${it.keyword}</li>
      `
    )
    .join("");

  // 현재 값이 items에 없으면 1위로
  const currentValue = valueEl?.textContent?.trim();
  const exists = items.some((x) => x.keyword === currentValue);
  const targetValue = exists ? currentValue : items[0].keyword;

  dropdownApi?.setValue(targetValue);
}

// 초기 렌더
const bootKeyword = (
  document.querySelector('#keywordDropdown input[type="hidden"]')?.value ||
  document.querySelector("#keywordDropdown .cselect__value")?.textContent ||
  "주식"
).trim();
selectKeyword(bootKeyword);

// =====================================================
// 2) 랭킹 API fetch + UI 동기화
// =====================================================
async function fetchRankingAndRender({ keepSelected = true } = {}) {
  const range = window.getAppRange?.() || {};
  const mode = getActiveMode();
  const start = range.start;
  const end = range.end;
  if (!start || !end) return;

  const qs = new URLSearchParams({ mode, start, end, size: "10" });

  const res = await fetch(`/api/keywords/ranking?${qs.toString()}`, {
    method: "GET",
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    alert("랭킹 조회에 실패했습니다.");
    return;
  }

  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];

  KEYWORDS = items;

  // (1) 드롭다운 옵션 재생성
  rebuildKeywordDropdownFromRanking(items);

  // (2) TS3 키워드 버튼 재생성
  window.ts3Api?.rebuildButtons?.(items);

  // 선택 키워드 유지(없으면 1위)
  const prev = keepSelected ? summaryKeywordEl?.textContent?.trim() : null;
  const fallback = items[0]?.keyword || "선택된 키워드 없음";
  const currentSelected = prev && items.some((x) => x.keyword === prev) ? prev : fallback;

  selectKeyword(currentSelected);
}

document.addEventListener("app:rangechange", () => {
  fetchRankingAndRender({ keepSelected: true });
});

// ===== 증감률/변동 안내 툴팁 (공통: viewport 안으로 자동 배치) =====
(function () {
  const wraps = document.querySelectorAll(".has-tip");
  if (!wraps.length) return;

  function closeAll() {
    wraps.forEach((w) => {
      const btn = w.querySelector(".info-btn");
      const tip = w.querySelector(".tooltip");
      if (!btn || !tip) return;

      tip.hidden = true;
      btn.setAttribute("aria-expanded", "false");

      // 다음 오픈 때 CSS 기본값으로 시작하도록 정리(선택)
      tip.style.removeProperty("position");
      tip.style.removeProperty("left");
      tip.style.removeProperty("top");
      tip.style.removeProperty("right");
    });
  }

  function placeTooltip(btn, tip) {
    const GAP = 8;
    const MARGIN = 12;
    const ARROW = 10; // ::before size(너 CSS가 10px)

    const vv = window.visualViewport;
    const vw = vv?.width || window.innerWidth;
    const vh = vv?.height || window.innerHeight;

    const b = btn.getBoundingClientRect();
    const t = tip.getBoundingClientRect(); // tip이 visible 상태여야 값이 나옴

    // 기본: 버튼 중앙 아래
    let left = b.left + b.width / 2 - t.width / 2;
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - t.width));

    let top = b.bottom + GAP;

    // 아래로 못 놓으면 위로
    if (top + t.height + MARGIN > vh) {
      top = b.top - GAP - t.height;
    }
    top = Math.max(MARGIN, Math.min(top, vh - MARGIN - t.height));

    // fixed로 박아버리면 main-scroll/overflow 영향 안 받음
    tip.style.position = "fixed";
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.right = "auto";

    // 화살표를 버튼 중앙에 맞춤(툴팁 내부 좌표)
    const arrowLeft = b.left + b.width / 2 - left - ARROW / 2;
    tip.style.setProperty(
      "--arrow-left",
      `${Math.max(10, Math.min(arrowLeft, t.width - 20))}px`
    );
  }

  wraps.forEach((w) => {
    const btn = w.querySelector(".info-btn");
    const tip = w.querySelector(".tooltip");
    if (!btn || !tip) return;

    // 초기 상태 안전하게
    tip.hidden = true;
    btn.setAttribute("aria-expanded", "false");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      const willOpen = tip.hidden;
      closeAll();

      tip.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");

      if (willOpen) {
        requestAnimationFrame(() => placeTooltip(btn, tip));
      }
    });

    tip.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

  // 스크롤/리사이즈 시 닫기(고정툴팁 떠있는 느낌 방지)
  document.querySelector(".main-scroll")?.addEventListener("scroll", closeAll, { passive: true });
  window.addEventListener("resize", closeAll);
  window.visualViewport?.addEventListener("resize", closeAll);
})();


// ===============================
// TS2 기사 상세 팝업 모달 (전역)
// ===============================
(function initTS2Modal() {
  let root = document.getElementById("ts2ModalRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "ts2ModalRoot";
    root.innerHTML = `
    <div class="ts2m-backdrop" hidden>
        <div class="ts2m-panel" role="dialog" aria-modal="true" aria-label="기사 상세">
        <button type="button" class="ts2m-close js-ts2m-close" aria-label="닫기">×</button>

        <!-- 헤더(고정) -->
        <div class="ts2m-head">
            <div class="ts2m-press"></div>
            <div class="ts2m-title"></div>
            <div class="ts2m-meta"></div>
        </div>

        <!-- 본문 스크롤 영역 -->
        <div class="ts2m-body">
            <div class="ts2m-media" hidden>
            <img class="ts2m-img" alt="" loading="lazy" />
            </div>
            <div class="ts2m-summary"></div>
        </div>

        <!-- 하단 버튼(항상 보이게) -->
        <div class="ts2m-actions">
            <button type="button" class="ts2m-btn ts2m-btn-primary js-ts2m-open">원문 보기</button>
            <button type="button" class="ts2m-btn js-ts2m-close">닫기</button>
        </div>
        </div>
    </div>
    `;
    document.body.appendChild(root);
  }

  const backdrop = root.querySelector(".ts2m-backdrop");
  const elPress = root.querySelector(".ts2m-press");
  const elTitle = root.querySelector(".ts2m-title");
  const elMeta = root.querySelector(".ts2m-meta");
  const elSummary = root.querySelector(".ts2m-summary");
  const btnOpen = root.querySelector(".js-ts2m-open");
  const elMedia = root.querySelector(".ts2m-media");
  const elImg = root.querySelector(".ts2m-img");
  const elBody = root.querySelector(".ts2m-body");


  function close() {
    backdrop.hidden = true;
    document.body.classList.remove("is-modal-open");
  }

  // ✅ 닫기는 버튼으로만 (한 번만 등록)
  root.querySelectorAll(".js-ts2m-close").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", close);
  });

  // ✅ TS2에서 호출할 전역 함수
  window.openTS2Modal = function open(payload = {}) {
    const press = payload.press || "";
    const date = payload.date || "";
    const title = payload.title || "";
    const bodyOrSummary = payload.body || payload.summary || "";
    const url = payload.url || "";
    const imageUrl = (payload.image_url || payload.imageUrl || "").trim();

    elPress.textContent = press;
    elTitle.textContent = title;
    elMeta.textContent = date;
    elSummary.textContent = bodyOrSummary;

    // ✅ 내용 채운 뒤에 스크롤 맨 위로
    if (elBody) {
        elBody.scrollTop = 0;
        requestAnimationFrame(() => { elBody.scrollTop = 0; });
        }



    // ✅ 이미지 처리
    if (elMedia && elImg) {
      if (imageUrl) {
        elImg.src = imageUrl;
        elImg.alt = title ? `${title} 기사 이미지` : "기사 이미지";
        elMedia.hidden = false;

        elImg.onerror = () => {
          elImg.removeAttribute("src");
          elMedia.hidden = true;
        };
      } else {
        elImg.removeAttribute("src");
        elImg.alt = "";
        elMedia.hidden = true;
      }
    }

    btnOpen.disabled = !url;
    btnOpen.onclick = () => {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };

    backdrop.hidden = false;
    document.body.classList.add("is-modal-open");
  };
})();

// =====================================================
// main2 (TS2)
// =====================================================
(function TS2() {
  function hidePopularSortOptions() {
    document.querySelectorAll('.ts2-sort .cselect__opt[data-value="popular"]').forEach((opt) => {
      opt.remove(); // 아예 제거
    });
  }
  "use strict";

  // =========================
  // 옵션(원하면 조절)
  // =========================
  const UI_PAGE_SIZE = 10;      // 화면에 보여줄 개수
  const FETCH_PAGE_SIZE = 30;   // 서버에서 한 번에 가져올 개수(필터링 대비)
  const MAX_FETCH_PAGES = 6;    // 한 번 렌더링에 서버 페이지 최대 몇 번 더 끌어올지(과도 호출 방지)
  const ENABLE_KEYWORD_FILTER = false; // ✅ 키워드까지 맞추고 싶으면 true

  // =========================
  // util
  // =========================
  let PRESS_LOGO_MAP;
  async function PRESS_LOGO() {
    try {
      const r = await fetch("/api/PRESS_LOGO", {
        credentials: "same-origin"
      });

      if (!r.ok) {
        throw new Error(`PRESS_LOGO fetch failed: ${r.status}`);
      }

      PRESS_LOGO_MAP = await r.json();

    } catch (err) {
      PRESS_LOGO_MAP = {}; // fallback
    }
  }
  PRESS_LOGO()

  // ✅ TS2 컬럼(pos/neu/neg) -> ES sentiment.label 후보들
  const SENTIMENT_CANDIDATES = {
    pos: ["positive", "pos", "긍정"],
    neu: ["neutral", "neu", "중립"],
    neg: ["negative", "neg", "부정"],
  };

  // ✅ UI 정렬 -> py가 허용하는 orderby(latest|score)로만 매핑
  function mapOrderby(uiMode) {
    switch (uiMode) {
      case "recent": return "latest";
      case "old": return "old";
      case "trust_high": return "trust_high";
      case "trust_low": return "trust_low";
      // popular은 UI에서 제거했지만 혹시 남아있으면 폴백
      case "popular": return "latest";
      default: return "latest";
    }
  }

  function shouldShowTrustBadge(sent) {
    const mode = state.sortMode?.[sent] || "recent";
    // ✅ 최신순/오래된순에서는 신뢰도 숨김
    return mode === "trust_high" || mode === "trust_low";
  }

  function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* =========================
   요약(회원 전용) util
========================= */
const SUMMARY_CACHE = new Map();
const LOGIN_URL = "/login";    
async function fetchArticleSummary(docId) {
  if (!docId) return { ok: false, code: "NO_ID" };

  if (SUMMARY_CACHE.has(docId)) {
    return { ok: true, summary: SUMMARY_CACHE.get(docId) };
  }

  // ✅ 보통 이게 맞음 (/api 아래에 라우터 mount되어 있으면)
  const url = `/articles/${encodeURIComponent(docId)}/summary`;

  const r = await fetch(url, { credentials: "same-origin" });

  if (r.status === 401) return { ok: false, code: "LOGIN_REQUIRED" };
  if (!r.ok) return { ok: false, code: "API_ERROR" };

  const j = await r.json().catch(() => null);
  const text = (j?.summary ?? "").trim();

  SUMMARY_CACHE.set(docId, text);
  return { ok: true, summary: text };
}

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatDateOnly(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
    return s.slice(0, 10);
  }

  function parseSummaryToSections(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return null;

  // 기본 섹션
  const out = { claim: "", evidence: [] };

  // 1) 한 줄짜리 "핵심 주장: ... 근거: ..." 케이스도 대비
  //    "근거:" 기준으로 1차 분리
  const parts = raw.split(/(?:\n|\s)*근거\s*:\s*/);
  const left = parts[0] || "";
  const right = parts.slice(1).join("\n") || "";

  // claim: "핵심 주장:" 있으면 제거
  out.claim = left.replace(/^\s*핵심\s*주장\s*:\s*/g, "").trim();

  // 2) evidence: 줄 단위에서 "- " 시작을 우선 수집
  const lines = right.split("\n").map(s => s.trim()).filter(Boolean);

  const bullets = [];
  for (const ln of lines) {
    if (/^[-•▪■]\s*/.test(ln)) bullets.push(ln.replace(/^[-•▪■]\s*/, "").trim());
    else {
      // 불릿이 아니면 이전 불릿에 이어붙이기(긴 문장 줄바꿈 대응)
      if (bullets.length) bullets[bullets.length - 1] += " " + ln;
      else if (ln) bullets.push(ln); // 불릿이 아예 없으면 그냥 넣기
    }
  }
  out.evidence = bullets;

  return out;
}

function isStructuredSummary(text) {
  const t = String(text || "");
  // '핵심 주장:' / '근거:'가 있거나, 불릿(- •)이 여러 줄이면 구조화로 간주
  return /핵심\s*주장\s*:/i.test(t) || /근거\s*:/i.test(t) || /^\s*[-•▪■]\s+/m.test(t);
}

function renderSummaryBoxUI(containerEl, text) {
  if (!containerEl) return;

  const raw = String(text || "").trim();
  if (!raw) {
    containerEl.innerHTML = `<div class="ts2-sumplain">(요약이 비어 있어요)</div>`;
    return;
  }

  // ✅ preview처럼 구조화가 아니면: 그냥 텍스트로 보여주기
  if (!isStructuredSummary(raw)) {
    containerEl.innerHTML = `<div class="ts2-sumplain">${escapeHtml(raw)}</div>`;
    return;
  }

  // ✅ 구조화 요약이면: 기존 섹션 렌더
  const sec = parseSummaryToSections(raw);
  if (!sec) {
    containerEl.innerHTML = `<div class="ts2-sumplain">${escapeHtml(raw)}</div>`;
    return;
  }

  const claimHtml = sec.claim
    ? `<li>${escapeHtml(sec.claim)}</li>`
    : `<li>(핵심 주장이 비어 있어요)</li>`;

  const evidenceHtml = (sec.evidence && sec.evidence.length)
    ? sec.evidence.map(x => `<li>${escapeHtml(x)}</li>`).join("")
    : `<li>(근거가 비어 있어요)</li>`;

  containerEl.innerHTML = `
    <div class="ts2-sumsection">
      <div class="ts2-sumhead">핵심 주장</div>
      <ul class="ts2-sumlist">${claimHtml}</ul>
    </div>

    <div class="ts2-sumsection">
      <div class="ts2-sumhead">근거</div>
      <ul class="ts2-sumlist">${evidenceHtml}</ul>
    </div>
  `;
}



function getTrustInfo(a) {
    const sRaw = a?.trustScore ?? a?.score ?? null;
    if (sRaw == null) return { text: "", cls: "", title: "" };

    let s = Number(sRaw);
    if (!Number.isFinite(s)) return { text: "", cls: "", title: "" };

    // 0~1 또는 0~100 들어와도 대응
    if (s > 1 && s <= 100) s = s / 100;

    // ✅ 뱃지 텍스트는 score 자체
    const text = s.toFixed(2); // 예: 0.83

    // (선택) 색은 점수로만 구분
    const cls = s >= 0.7 ? "is-ok" : s >= 0.4 ? "is-warn" : "is-risk";

    return { text, cls, title: `trust.score: ${s.toFixed(4)}` };
  }

  function makeBadgeSvg(text) {
    const t = String(text || "NEWS").trim().slice(0, 2);
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72">
  <rect width="100%" height="100%" rx="12" ry="12" fill="#ffffff"/>
  <rect x="1" y="1" width="118" height="70" rx="12" ry="12" fill="none" stroke="#dfe8f7"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif"
        font-size="28" font-weight="800" fill="#2c3a52">${escapeHtml(t)}</text>
</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function hydratePressLogos(scopeEl) {
    if (!scopeEl) return;
    scopeEl.querySelectorAll("img.ts2-src__logo[data-press]").forEach((img) => {
      const press = (img.dataset.press || "").trim();
      const mapped = PRESS_LOGO_MAP[press];
      img.onerror = null;
      img.src = mapped || makeBadgeSvg(press);
      img.onerror = () => {
        img.onerror = null;
        img.src = makeBadgeSvg(press);
      };
    });
  }

  function px(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function applyFourCardScroll(listEl, visibleCount = 5) {
    if (!listEl) return;
    const cards = Array.from(listEl.querySelectorAll(".ts2-card"));
    const colbody = listEl.closest(".ts2-colbody");
    const pager = colbody?.querySelector(".ts2-pager");

    if (cards.length < visibleCount) {
      listEl.classList.remove("is-vscroll");
      listEl.style.removeProperty("--ts2-list-max");
      if (colbody) colbody.style.height = "";
      return;
    }

    const cs = getComputedStyle(listEl);
    const gap = px(cs.rowGap || cs.gap);
    const pt = px(cs.paddingTop);
    const pb = px(cs.paddingBottom);

    let h = pt + pb;
    for (let i = 0; i < visibleCount; i++) {
      h += cards[i].offsetHeight;
      if (i < visibleCount - 1) h += gap;
    }
    h = Math.ceil(h);

    listEl.classList.add("is-vscroll");
    listEl.style.setProperty("--ts2-list-max", `${h}px`);

    if (colbody) {
      const pagerH = pager ? pager.offsetHeight : 0;
      const bt = px(getComputedStyle(colbody).borderTopWidth);
      colbody.style.height = `${h + pagerH + bt}px`;
    }
  }

  function matchesKeyword(article, keyword) {
    if (!ENABLE_KEYWORD_FILTER) return true;
    const kw = String(keyword || "").trim();
    if (!kw) return true;
    const hay = `${article?.press || ""} ${article?.title || ""} ${article?.summary || ""}`.toLowerCase();
    return hay.includes(kw.toLowerCase());
  }

  function getRangeForTS2() {
    const r = window.getAppRange?.() || {};
    return { start: r.start, end: r.end };
  }


  // =========================
  // DOM
  // =========================
  const els = {
    pos: document.getElementById("ts2ListPos"),
    neu: document.getElementById("ts2ListNeu"),
    neg: document.getElementById("ts2ListNeg"),
  };

  function getPager(sent) {
    const listEl = els[sent];
    const colbody = listEl?.closest(".ts2-colbody");
    const pager = colbody?.querySelector(".ts2-pager");
    const btns = pager ? Array.from(pager.querySelectorAll(".ts2-pagebtn")) : [];
    const text = pager?.querySelector(".ts2-pagetext");
    return { pager, btnPrev: btns[0], btnNext: btns[1], text };
  }

  // =========================
  // state
  // =========================
  const state = {
    keyword: "주식",
    uiPage: { pos: 1, neu: 1, neg: 1 },
    sortMode: { pos: "recent", neu: "recent", neg: "recent" }, // recent|old|popular|trust_high|trust_low
    sentimentEndpoint: null,
    sentimentEndpointPromise: null,
    sentimentEndpointMissing: false,
  };

  // =========================
  // TS2 정렬 드롭다운 바인딩
  // =========================
  function initTS2SortDropdowns() {
    const roots = Array.from(document.querySelectorAll(".ts2-sort.cselect"));
    if (!roots.length) return;

    function closeAll(except) {
      roots.forEach((r) => {
        if (except && r === except) return;
        r.classList.remove("is-open");
        const btn = r.querySelector(".cselect__btn");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
    }

    roots.forEach((root) => {
      const btn = root.querySelector(".cselect__btn");
      const list = root.querySelector(".cselect__list");
      const valueEl = root.querySelector(".cselect__value");
      if (!btn || !list || !valueEl) return;

      const sent = root.dataset.sort; // pos | neu | neg

      // 버튼 클릭 → 열기/닫기
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const willOpen = !root.classList.contains("is-open");
        closeAll(root);

        root.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      // 옵션 클릭 → 정렬 변경
      list.addEventListener("click", (e) => {
        const opt = e.target.closest(".cselect__opt");
        if (!opt) return;

        const v = opt.dataset.value ?? opt.textContent.trim();
        valueEl.textContent = opt.textContent.trim();

        root.querySelectorAll(".cselect__opt").forEach((o) => {
          const isSel = o === opt;
          o.classList.toggle("is-selected", isSel);
          if (isSel) o.setAttribute("aria-selected", "true");
          else o.removeAttribute("aria-selected");
        });

        if (sent) {
          state.sortMode[sent] = v;
          state.uiPage[sent] = 1;
          loadOne(sent); // 🔥 해당 컬럼만 다시 로드
        }

        root.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("click", () => closeAll());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });
  }

  const SENTIMENT_ENDPOINT_OVERRIDE = null; // 예: "/api/articles/by-sentiment"

  async function discoverSentimentEndpoint() {
    if (SENTIMENT_ENDPOINT_OVERRIDE) return SENTIMENT_ENDPOINT_OVERRIDE;
    if (state.sentimentEndpoint) return state.sentimentEndpoint;
    if (state.sentimentEndpointMissing) throw new Error("sentiment endpoint missing");
    if (state.sentimentEndpointPromise) return state.sentimentEndpointPromise;

    state.sentimentEndpointPromise = (async () => {
      // 1) OpenAPI로 찾기
      const openapiUrls = ["/openapi.json", "/api/openapi.json"];
      for (const u of openapiUrls) {
        try {
          const r = await fetch(u, { credentials: "same-origin" });
          if (!r.ok) continue;
          const j = await r.json();
          const paths = Object.keys(j.paths || {});
          const hits = paths.filter((p) => /sentiment/i.test(p) && /article/i.test(p));
          const pick = hits.find((p) => /by[-_]?sentiment/i.test(p)) || hits[0];
          if (pick) {
            state.sentimentEndpoint = pick;
            return pick;
          }
        } catch (_) { }
      }

      // 2) 흔한 후보 probe
      const probeDate = getActiveDateForTS2();
      const qs = new URLSearchParams({
        sentiment: "positive",
        date: probeDate,
        page: "1",
        size: "1",
        orderby: "latest",
      }).toString();

      const candidates = ["/api/articles/by-sentiment", "/articles/by-sentiment"];
      for (const p of candidates) {
        try {
          const r = await fetch(`${p}?${qs}`, { credentials: "same-origin" });
          if (r.status !== 404) {
            state.sentimentEndpoint = p;
            return p;
          }
        } catch (_) { }
      }

      state.sentimentEndpointMissing = true;
      throw new Error("sentiment endpoint missing");
    })();

    try {
      return await state.sentimentEndpointPromise;
    } finally {
      state.sentimentEndpointPromise = null;
    }
  }

  // payload 형태 normalize
  function normalizeList(payload) {
    if (Array.isArray(payload)) return { items: payload, total: payload.length };

    const items =
      payload?.items ??
      payload?.articles ??
      payload?.data ??
      payload?.results ??
      payload?.rows ??
      payload?.docs ??
      payload?.hits?.hits ??
      [];

    const total =
      payload?.total ??
      payload?.total_count ??
      payload?.count ??
      payload?.totalCount ??
      payload?.hits?.total?.value ??
      payload?.hits?.total ??
      (Array.isArray(items) ? items.length : 0);

    return { items: Array.isArray(items) ? items : [], total: Number(total) || 0 };
  }

  // 기사 필드 normalize
  function normalizeArticle(a) {
    const raw = a || {};
    const src = raw._source || raw.source || raw.doc || raw.data || raw;

    const title = src?.title ?? src?.headline ?? src?.news_title ?? "";

    const docId =
        src?.doc_id ??
        src?.docId ??
        raw?.doc_id ??
        raw?.docId ??
        raw?._id ??
        "";

    // 본문: body
    const body =
      src?.body ??
      src?.content ??
      src?.news_content ??
      "";

    // 미리보기(비로그인용) - 백엔드 list에서 내려준 값
    const summaryPreview =
      src?.summary_preview ??
      src?.summaryPreview ??
      "";

    // 언론사: press_name
    const press =
      src?.press_name ??
      src?.press ??
      src?.publisher ??
      src?.media ??
      src?.source ??
      "";

    // URL
    const url = src?.url ?? src?.link ?? src?.news_url ?? "";

    // 날짜: published_at
    const date = src?.published_at ?? src?.date ?? src?.publishedAt ?? src?.pubDate ?? src?.datetime ?? "";

    // trust.score
    const trustScoreRaw =
      src?.trust?.score ??
      src?.trust_score ??
      src?.trustScore ??
      raw?.trust?.score ??
      raw?.trust_score ??
      raw?.trustScore ??
      null;

    let trustScore = trustScoreRaw == null ? null : Number(trustScoreRaw);
    if (!Number.isFinite(trustScore)) trustScore = null;

    const trustLabelRaw =
      src?.trust?.label ??
      src?.trust_label ??
      src?.trustLabel ??
      null;

    const trustLabel = trustLabelRaw == null ? null : (String(trustLabelRaw).trim() || null);

    // ✅ 대표 이미지 URL
    const imageUrl =
      src?.image_url ??
      src?.imageUrl ??
      src?.image ??
      src?.thumbnail ??
      "";

    return {docId, title, summaryPreview, body, press, url, date, trustScore, trustLabel, imageUrl, raw };
  }


  function setListMessage(listEl, msg) {
    if (!listEl) return;
    listEl.innerHTML = `<div class="ts2-empty" style="padding:14px;color:#6a7a93;">${escapeHtml(msg)}</div>`;
  }

  // ✅ 요약 토글(리스트당 한 번만 이벤트 위임)
function bindTS2ToggleOnce(listEl) {
  if (!listEl || listEl.dataset.boundToggle) return;
  listEl.dataset.boundToggle = "1";

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".js-ts2-toggle");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const card = btn.closest(".js-ts2-card");
    if (!card) return;

    const box = card.querySelector(".ts2-sumbox");
    const uiEl = box?.querySelector(".ts2-sumui");
    if (!box || !uiEl) return;

    const isOpen = !box.hasAttribute("hidden");
    if (isOpen) {
      box.setAttribute("hidden", "");
      box.classList.remove("is-locked");
      box.querySelector(".ts2-sumoverlay")?.remove();
      return;
    }

    box.removeAttribute("hidden");

    const preview = card.dataset.ts2SummaryPreview || "(요약 미리보기가 없습니다)";
    renderSummaryBoxUI(uiEl, preview);

    const docId = card.dataset.ts2Id || "";
    const res = await fetchArticleSummary(docId);

    if (!res.ok && res.code === "LOGIN_REQUIRED") {
      box.classList.add("is-locked");

      let overlay = box.querySelector(".ts2-sumoverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "ts2-sumoverlay";
        overlay.innerHTML = `
          <div class="ts2-sumoverlay__msg">
            기사 요약은 회원에게만 제공됩니다.<br/>로그인 후 열람 가능
          </div>
        `;
        box.appendChild(overlay);
      }

      if (!overlay.dataset.bound) {
        overlay.dataset.bound = "1";
        overlay.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.location.href = LOGIN_URL;
        });
      }
      return;
    }

    if (!res.ok) {
      box.classList.remove("is-locked");
      box.querySelector(".ts2-sumoverlay")?.remove();
      renderSummaryBoxUI(uiEl, "(요약을 불러오지 못했어요)");
      return;
    }

    box.classList.remove("is-locked");
    box.querySelector(".ts2-sumoverlay")?.remove();
    renderSummaryBoxUI(uiEl, res.summary || "(요약이 비어 있어요)");
  });
}

// ✅ 카드 클릭 → 모달 오픈 (한 번만 바인딩)
function bindTS2CardOpen(listEl) {
  if (!listEl) return;
  if (listEl.dataset.boundCardOpen) return;
  listEl.dataset.boundCardOpen = "1";

  function openFromCard(card) {
    if (!card) return;
    openTS2Modal({
      press: card.dataset.ts2Press || "",
      date: card.dataset.ts2Date || "",
      title: card.dataset.ts2Title || "",
      summary: card.dataset.ts2Body || card.dataset.ts2Summary || "",
      url: card.dataset.ts2Url || "",
      image_url: card.dataset.ts2Image || "",
    });
  }

  listEl.addEventListener("click", (e) => {
    if (e.target.closest(".js-ts2-toggle")) return; // ✅ 요약 버튼이면 모달 열지 않음
    const card = e.target.closest(".js-ts2-card");
    if (!card || !listEl.contains(card)) return;
    e.preventDefault();
    openFromCard(card);
  });

  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".js-ts2-card");
    if (!card || !listEl.contains(card)) return;
    e.preventDefault();
    openFromCard(card);
  });
}



function renderCards(sent, cards, page, totalPages) {
  const listEl = els[sent];
  if (!listEl) return;

  if (!cards.length) {
    setListMessage(listEl, "기사 데이터 없음");
  } else {
    listEl.innerHTML = cards.map((a) => {
      const press = String(a.press || "").trim();
      const title = String(a.title || "").trim();
      const body = String(a.body || "").trim();
      const url = String(a.url || "").trim();
      const dateOnly = formatDateOnly(a.date);
      const imageUrl = String(a.imageUrl || a.image_url || "").trim();
      const docId = String(a.docId || "").trim();
      const preview = String(a.summaryPreview || a.summary_preview || "").trim();
      const showTrust = shouldShowTrustBadge(sent);
      const trust = getTrustInfo(a);
      const trustChipHtml =
        (showTrust && trust.text)
          ? `<span class="ts2-chip ts2-chip--trust ${trust.cls}" title="${escapeHtml(trust.title)}">${escapeHtml(trust.text)}</span>`
          : "";

      return `
<article class="ts2-card js-ts2-card"
  role="button"
  tabindex="0"
  data-ts2-id="${escapeHtml(docId)}"
  data-ts2-summary-preview="${escapeHtml(preview)}"
  data-ts2-press="${escapeHtml(press)}"
  data-ts2-date="${escapeHtml(dateOnly)}"
  data-ts2-title="${escapeHtml(title || "제목 없음")}"
  data-ts2-body="${escapeHtml(body || "")}"
  data-ts2-url="${escapeHtml(url || "")}"
  data-ts2-image="${escapeHtml(imageUrl || "")}"
>
  <div class="ts2-card__top">
    <div class="ts2-src ts2-src--logoonly">
      <img class="ts2-src__logo" data-press="${escapeHtml(press)}" alt="${escapeHtml(press)} 로고">
      <span class="ts2-src__name">${escapeHtml(press || "언론사")}</span>
    </div>

    <div class="ts2-meta">
      ${trustChipHtml}
      ${dateOnly ? `<span class="ts2-chip ts2-chip--date">${escapeHtml(dateOnly)}</span>` : ""}
      <button type="button" class="ts2-chip ts2-chip--btn js-ts2-toggle">기사 요약</button>
    </div>
  </div>

  <div class="ts2-title">${escapeHtml(title || "제목 없음")}</div>

  <!-- ✅ 요약 박스: 기본은 숨김 -->
  <div class="ts2-sumbox" hidden>
    <div class="ts2-sumui"></div>
  </div>
</article>`;
    }).join("");

    hydratePressLogos(listEl);

    // ✅ 카드 클릭 모달(한 번만)
    bindTS2CardOpen(listEl);

    // ✅ 요약 토글(리스트당 한 번만 이벤트 위임)
    bindTS2ToggleOnce(listEl);
  }

  // ✅ pager 갱신은 renderCards 안에서!
  const { text, btnPrev, btnNext } = getPager(sent);
  if (text) text.textContent = `${page} / ${totalPages}`;
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= totalPages;
}

async function fetchSentiment(sent, page, size) {
    // ✅ pos/neu/neg -> 서버 sentiment 값
    const sentiment =
      sent === "pos" ? "positive" :
        sent === "neu" ? "neutral" :
          sent === "neg" ? "negative" :
            "all";

    const { start, end } = getRangeForTS2();
    if (!start || !end) throw new Error("range missing");

    const orderby = mapOrderby(state.sortMode[sent] || "recent");

    const qs = new URLSearchParams({
      keyword: state.keyword,
      start,
      end,
      sentiment,
      page: String(page),
      size: String(size),
      orderby,
    }).toString();

    const url = `/articles/list?${qs}`;

    const r = await fetch(url, { credentials: "same-origin" });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.success) {
      throw new Error(`[TS2] list failed ${r.status} ${url}`);
    }

    const { items, total } = normalizeList(j);
    return { items, total, url };
  }

  async function loadOne(sent) {
    const listEl = els[sent];
    if (!listEl) return;

    const page = state.uiPage[sent] || 1;
    const size = UI_PAGE_SIZE;

    setListMessage(listEl, "불러오는 중...");

    try {
      const res = await fetchSentiment(sent, page, size);
      const normalized = res.items.map(normalizeArticle);

      const filtered = normalized.filter((a) => matchesKeyword(a, state.keyword));
      const show = ENABLE_KEYWORD_FILTER && filtered.length > 0 ? filtered : normalized;

      const total = Number.isFinite(res.total) ? res.total : show.length;
      const totalPages = Math.max(1, Math.ceil(total / size));
      const clampedPage = Math.min(Math.max(1, page), totalPages);

      state.uiPage[sent] = clampedPage;
      renderCards(sent, show, clampedPage, totalPages);
    } catch (e) {
      setListMessage(listEl, "기사 API를 찾지 못했거나 응답이 없습니다(콘솔 로그 확인).");

      const { text, btnPrev, btnNext } = getPager(sent);
      if (text) text.textContent = "1 / 1";
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
    }
  }

  function bindPagerOnce(sent) {
    const { btnPrev, btnNext } = getPager(sent);

    if (btnPrev && !btnPrev.dataset.bound) {
      btnPrev.dataset.bound = "1";
      btnPrev.addEventListener("click", () => {
        state.uiPage[sent] = Math.max(1, (state.uiPage[sent] || 1) - 1);
        loadOne(sent);
      });
    }

    if (btnNext && !btnNext.dataset.bound) {
      btnNext.dataset.bound = "1";
      btnNext.addEventListener("click", () => {
        state.uiPage[sent] = (state.uiPage[sent] || 1) + 1;
        loadOne(sent);
      });
    }
  }

  ["pos", "neu", "neg"].forEach(bindPagerOnce);

  hidePopularSortOptions();
  initTS2SortDropdowns();
  ts2ReloadAll();

  function ts2ReloadAll() {
    return Promise.all(["pos", "neu", "neg"].map(loadOne));
  }

  window.ts2Api = {
    setKeyword(kw) {
      state.keyword = kw;
      state.uiPage = { pos: 1, neu: 1, neg: 1 };
      ts2ReloadAll();
    },
    refresh: ts2ReloadAll,
  };

  document.addEventListener("app:rangechange", () => {
    state.uiPage = { pos: 1, neu: 1, neg: 1 };
    ts2ReloadAll();
  });

  ts2ReloadAll();

  })();


// =====================================================
// main3 (TS3)
// =====================================================
const ts3Api = (function TS3() {
  if (!ts3Root) return null;

  // -------------------------
  // 공통 util
  // -------------------------
  const LINE_PALETTE = [
  "#4C7DFF", 
  "#1ECFA2", 
  "#FFB020", 
  "#FF5C5C", 
  "#9B6DFF", 
  "#3FD5FF", 
  "#FFD84D", 
  "#FF6FAE", 
  "#9EDB3A",
  "#7B7EFF" 
];
  const __kwColorMap = new Map();

  function hashStr(s) {
    s = String(s || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return Math.abs(h);
  }
  function colorFor(kw) {
    kw = String(kw || "").trim();
    if (!kw) return LINE_PALETTE[0];
    if (__kwColorMap.has(kw)) return __kwColorMap.get(kw);
    const c = LINE_PALETTE[hashStr(kw) % LINE_PALETTE.length];
    __kwColorMap.set(kw, c);
    return c;
  }
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function isoDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // -------------------------
  // 상태
  // -------------------------
  let baseKeyword = (document.querySelector("#keywordDropdown .cselect__value")?.textContent || "주식").trim();
  let compareSet = new Set(); // base 제외한 비교 키워드만

  // =========================================================
  // TS3: 워드클라우드
  // =========================================================
  // ✅ 요청 순서 관리(빠르게 기간 바꿀 때 이전 응답이 덮어쓰는 문제 방지)
let __cloudReqSeq = 0;
// ✅ 마지막 렌더 정보(리사이즈 재렌더용)
let __lastCloudState = { keyword: null, start: null, end: null };

// ------------------------------
// util: 캔버스를 컨테이너에 딱 맞게 + DPR 반영
// ------------------------------
function setupCanvasToFillBox(canvas, boxEl, fallbackW = 467, fallbackH = 220) {
  const rect = boxEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const cssW = rect.width || fallbackW;
  const cssH = rect.height || fallbackH;

  // 화면에 보이는 크기
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  // 실제 렌더 픽셀 크기(DPR 반영)
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));

  // (선택) 선명도/좌표계 안정화
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return { rect, dpr };
}

// ------------------------------
// util: 테두리에 픽셀이 닿았는지(=너무 꽉참/잘림 위험)
// ------------------------------
function hitEdge(canvas, margin = 2, step = 12) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;

  // top/bottom
  for (let x = 0; x < w; x += step) {
    if (img[((margin * w + x) * 4) + 3] > 0) return true;
    if (img[(((h - 1 - margin) * w + x) * 4) + 3] > 0) return true;
  }
  // left/right
  for (let y = 0; y < h; y += step) {
    if (img[((y * w + margin) * 4) + 3] > 0) return true;
    if (img[((y * w + (w - 1 - margin)) * 4) + 3] > 0) return true;
  }
  return false;
}

// ------------------------------
// 핵심: "박스 꽉 채우기" 자동 스케일 렌더
//  - k를 키우면 전체 폰트가 커짐
//  - 테두리에 닿으면 줄이고, 안 닿으면 키움(이진 탐색)
// ------------------------------
async function drawWordCloudFit(canvas, wordList, baseOpts) {
  if (document.fonts?.ready) await document.fonts.ready;

  const maxScore = Math.max(...wordList.map(w => w[1])) || 1;

  // k 범위(필요하면 조금 조정 가능)
  let lo = 0.18, hi = 0.90;

  // 여러 번 그려서 "거의 꽉" 차는 k를 찾는다
  for (let i = 0; i < 8; i++) {
    const k = (lo + hi) / 2;

    WordCloud(canvas, {
      ...baseOpts,
      weightFactor: (size) => (size / maxScore) * (canvas.height * k),
    });

    // WordCloud는 비동기라 잠깐 대기
    await new Promise(r => setTimeout(r, 90));

    const touched = hitEdge(canvas, 2, 12);
    if (touched) hi = k; // 너무 꽉참/잘림 위험
    else lo = k;         // 아직 여유 있음 -> 더 키워도 됨
  }

  // 최종 렌더(살짝 여유를 주면 잘림 방지)
  const finalK = lo * 0.97;

  WordCloud(canvas, {
    ...baseOpts,
    weightFactor: (size) => (size / maxScore) * (canvas.height * finalK),
  });
}

// =========================================================
// TS3: 워드클라우드 (완성본)
// =========================================================
async function renderCloud(keyword) {
  if (!ts3CloudEl) return;

  const r = window.getAppRange?.() || {};
  const start = r.start;
  const end = r.end || r.start;
  if (!start) return;

  // 최신 상태 저장(리사이즈 재렌더용)
  __lastCloudState = { keyword, start, end };

  const seq = ++__cloudReqSeq;
  ts3CloudEl.innerHTML = `<div class="ts3-cloud-inner">불러오는 중…</div>`;

  try {
    const url =
      `/api/issue_wordcloud?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&keyword=${encodeURIComponent(keyword)}`;

    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => null);

    if (seq !== __cloudReqSeq) return;

    if (!res.ok || !data?.success || !Array.isArray(data.sub_keywords) || data.sub_keywords.length === 0) {
      ts3CloudEl.innerHTML = `<div class="ts3-cloud-inner">데이터 없음</div>`;
      return;
    }

    // Wordcloud2.js 형식: [ [word, score], ... ]
    const wordList = data.sub_keywords
      .slice(0, 40)
      .map((x, i) => {
        let kw = "";
        let score = 0;

        if (typeof x === "string") {
          kw = x;
          score = 40 - i;
        } else {
          kw = (x.text ?? x.keyword ?? x.word ?? "").trim();
          score = Number(x.value ?? x.score ?? (40 - i));
        }

        // score 방어
        if (!Number.isFinite(score)) score = 1;
        return [kw, score];
      })
      .filter(it => it[0] && it[0] !== "[object Object]");

    if (wordList.length === 0) {
      ts3CloudEl.innerHTML = `<div class="ts3-cloud-inner">데이터 없음</div>`;
      return;
    }

    // 캔버스 생성
    ts3CloudEl.innerHTML = "";
    const canvas = document.createElement("canvas");
    ts3CloudEl.appendChild(canvas);

    // 컨테이너에 맞게 캔버스 세팅
    setupCanvasToFillBox(canvas, ts3CloudEl, 467, 220);

    // 옵션(여기만 취향대로 바꾸면 됨)
    const baseOpts = {
      list: wordList,
      // gridSize는 작을수록 촘촘히 들어가지만 느려질 수 있음
      gridSize: Math.max(6, Math.round(12 * canvas.width / 1024)),
      fontFamily: '"Lato", "Noto Sans KR", sans-serif',
      color: () => {
        const colors = ["#0B63CE", "#2A7BE4", "#6AA6F8", "#162C49", "#1F3C68"];
        return colors[(Math.random() * colors.length) | 0];
      },
      rotateRatio: 0.2,
      rotationSteps: 2,
      backgroundColor: "transparent",
      shuffle: true,
      ellipticity: 0.4,

      // 잘림 방지(지원되는 버전이면 도움)
      drawOutOfBound: false,
      shrinkToFit: true,
      clearCanvas: true,
    };

    // ✅ 박스에 "거의 꽉" 차게 자동 스케일 렌더
    await drawWordCloudFit(canvas, wordList, baseOpts);

  } catch (e) {
    if (seq !== __cloudReqSeq) return;
    ts3CloudEl.innerHTML = `<div class="ts3-cloud-inner">불러오기 실패</div>`;
  }
}

// =========================================================
// 리사이즈 재렌더: "한 번만" 등록 (중복 방지)
// =========================================================
(function bindCloudResizeOnce() {
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const { keyword } = __lastCloudState || {};
      if (keyword) renderCloud(keyword);
    }, 150);
  }, { passive: true });
})();



  // =========================================================
  // TS3: 도넛(감성 합계)
  // =========================================================
  let __donutReqSeq = 0;

  function setDonutByCounts(pos, neu, neg, meta = {}) {
    if (!ts3DonutEl) return;

    const total = (pos + neu + neg) || 0;

    if (total <= 0) {
      __lastDonutPcts = null;
      ts3DonutEl.style.background = "conic-gradient(#8a97ad 0 100%)";
      ts3DonutEl.setAttribute("aria-label", "감성 비율 도넛 차트 (데이터 없음)");
      clearDonutLabels();
      return;
    }

    const pPos = Math.floor((pos / total) * 100);
    const pNeu = Math.floor((neu / total) * 100);
    const pNeg = Math.max(0, 100 - pPos - pNeu);

    __lastDonutPcts = { pos: pPos, neu: pNeu, neg: pNeg };

    const a = pPos;
    const b = pPos + pNeu;

    ts3DonutEl.style.background = `conic-gradient(
  #0073ff 0 ${a}%,
  #e6e6e6 ${a}% ${b}%,
  #ff0000 ${b}% 100%
)`;

    ts3DonutEl.setAttribute(
      "aria-label",
      `감성 비율 도넛 차트 (${meta.keyword || ""} ${meta.start || ""}~${meta.end || ""})
      (긍정 ${pPos}%, 중립 ${pNeu}%, 부정 ${pNeg}%)
      | 건수(긍정 ${pos}, 중립 ${neu}, 부정 ${neg}, 합계 ${total})`
    );

    renderDonutPercentLabels(pPos, pNeu, pNeg);
  }

  async function renderDonut(keyword) {
    if (!ts3DonutEl) return;

    const r = window.getAppRange?.() || {};
    const start = r.start;
    const end = r.end;
    if (!start || !end) return;

    const seq = ++__donutReqSeq;

    ts3DonutEl.style.background = "conic-gradient(#eef2fb 0 100%)";
    ts3DonutEl.setAttribute("aria-label", "감성 비율 도넛 차트 (불러오는 중)");
    clearDonutLabels();

    try {
      const url = `/articles/sentiment-sum?keyword=${encodeURIComponent(keyword)}&start=${start}&end=${end}`;
      const res = await fetch(url, { credentials: "same-origin" });
      const data = await res.json().catch(() => null);

      if (seq !== __donutReqSeq) return;

      if (!res.ok || !data?.success) {
        setDonutByCounts(0, 0, 0);
        return;
      }

      const pos = Number(data.positive || 0);
      const neu = Number(data.neutral || 0);
      const neg = Number(data.negative || 0);

      setDonutByCounts(pos, neu, neg, { keyword, start, end });
    } catch (e) {
      if (seq !== __donutReqSeq) return;
      setDonutByCounts(0, 0, 0);
    }
  }

  // =========================================================
  // 기간(range) 관리 + 이벤트(app:rangechange)
  // =========================================================
  let __appRange = null;

  function clampEndToYesterdayISO(inputISO) {
    const yesterdayISO = toISO(addDays(new Date(), -1));
    return !inputISO || inputISO > yesterdayISO ? yesterdayISO : inputISO;
  }

  function calcPrevSameLength(start, end) {
    const msDay = 24 * 60 * 60 * 1000;
    const lenDays = Math.round((end - start) / msDay) + 1;; // start==end면 0
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(lenDays - 1));
    return { prevStart: toISO(prevStart), prevEnd: toISO(prevEnd) };
  }

  function getActiveGrain() {
    return document.querySelector(".seg-btn.is-active")?.dataset.grain || "day";
  }

  function calcStartByGrain(grain, end) {
    if (grain === "day") return new Date(end);
    if (grain === "week") return addDays(end, -7); // 7일
    if (grain === "month") return addMonthsClamp(end, -1);
    if (grain === "year") return addYearsClamp(end, -1);
    return new Date(end);
  }

  function emitRangeChange({ preset = false } = {}) {
    const grain = getActiveGrain();

    const yesterdayISO = toISO(addDays(new Date(), -1));
    if (endDateEl) endDateEl.max = yesterdayISO;

    const endISO = clampEndToYesterdayISO(endDateEl?.value);
    if (endDateEl) endDateEl.value = endISO;

    let end = normalize(parseISO(endISO) || addDays(new Date(), -1));

    let start;
    if (preset) {
      start = normalize(calcStartByGrain(grain, end));
      if (startDateEl) startDateEl.value = toISO(start);
    } else {
      start = normalize(parseISO(startDateEl?.value) || end);
    }

    if (start > end) {
      start = new Date(end);
      if (startDateEl) startDateEl.value = toISO(start);
    }

    if (startDateEl) startDateEl.max = toISO(end);
    if (endDateEl) endDateEl.min = toISO(start);

    const prev = calcPrevSameLength(start, end);

    __appRange = {
      grain,
      start: toISO(start),
      end: toISO(end),
      prevStart: prev.prevStart,
      prevEnd: prev.prevEnd,
    };

    document.dispatchEvent(new CustomEvent("app:rangechange", { detail: __appRange }));
  }

  window.getAppRange = () =>
    __appRange || {
      grain: getActiveGrain(),
      start: startDateEl?.value,
      end: endDateEl?.value,
      prevStart: null,
      prevEnd: null,
    };

  function onManualDateChange() {
  const s = (startDateEl?.value || "").trim();
  const e = (endDateEl?.value || "").trim();

  // 시작/종료가 모두 있고, 같은 날짜면 → '일별' 버튼 활성화
  if (s && e && s === e) {
    setSegActive("day");
    emitRangeChange({ preset: true });   // day 기준으로 start=end 유지
    return;
  }

  // 그 외(기간 범위) → 버튼 해제(자유기간)
  clearSegActive();
  emitRangeChange({ preset: false });
}

  startDateEl?.addEventListener("input", onManualDateChange);
  startDateEl?.addEventListener("change", onManualDateChange);
  endDateEl?.addEventListener("input", onManualDateChange);
  endDateEl?.addEventListener("change", onManualDateChange);

  segmentedBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setSegActive(btn.dataset.grain);
      emitRangeChange({ preset: true });
    });
  });

  emitRangeChange({ preset: true }); // 최초 로드도 프리셋으로

  // =========================================================
  // TS3: Line Chart (keyword_trend)
  // =========================================================
  let __trendReqSeq = 0;
  let chart = null;

  function bucketKey(dateObj, grain) {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);

    if (grain === "day") return isoDate(d);
    if (grain === "week") {
      const day = d.getDay(); // 0=일 ... 1=월
      const diffToMon = (day + 6) % 7;
      const mon = new Date(d);
      mon.setDate(d.getDate() - diffToMon);
      return isoDate(mon);
    }
    if (grain === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    if (grain === "year") return String(d.getFullYear());
    return isoDate(d);
  }

  function makeFullDateObjs(startISO, endISO) {
    const out = [];
    let s = new Date(startISO + "T00:00:00");
    let e = new Date(endISO + "T00:00:00");
    if (s > e) [s, e] = [e, s];

    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
  }

  function aggregateTrendToGrain(trend, grain, startISO, endISO) {
    const dates = Array.isArray(trend?.dates) ? trend.dates : [];
    const series = trend?.series || {};

    const fullDateObjs = makeFullDateObjs(startISO, endISO);
    const labels = [];
    const labelIndex = new Map();

    fullDateObjs.forEach((d) => {
      const key = bucketKey(d, grain);
      if (!labelIndex.has(key)) {
        labelIndex.set(key, labels.length);
        labels.push(key);
      }
    });

    const outSeries = {};
    Object.entries(series).forEach(([kw, arr]) => {
      const bucketed = new Array(labels.length).fill(0);
      dates.forEach((iso, i) => {
        const d = new Date(iso + "T00:00:00");
        const key = bucketKey(d, grain);
        const idx = labelIndex.get(key);
        if (idx != null) bucketed[idx] += arr?.[i] ?? 0;
      });
      outSeries[kw] = bucketed;
    });

    return { labels, series: outSeries };
  }

  async function fetchTrend(start, end, keywords) {
    const qs = new URLSearchParams({ start, end });
    (keywords || []).forEach((k) => qs.append("keywords", k));

    const res = await fetch(`/api/keyword_trend?${qs.toString()}`, {
      credentials: "same-origin",
    });

    if (!res.ok) throw new Error(`keyword_trend HTTP ${res.status}`);
    return await res.json();
  }

  function pickUniqueColor(kw, usedColors) {
    const base = hashStr(kw) % LINE_PALETTE.length;

    for (let step = 0; step < LINE_PALETTE.length; step++) {
      const idx = (base + step) % LINE_PALETTE.length;
      const c = LINE_PALETTE[idx];
      if (!usedColors.has(c)) {
        usedColors.add(c);
        return c;
      }
    }

    // 팔레트 다 썼으면 기본값
    return LINE_PALETTE[base];
  }

  async function renderLineChart() {
    if (!ts3Canvas || typeof Chart === "undefined") return;

    const { start, end } = window.getAppRange?.() || {};
    const grain = getActiveGrainForChart();
    if (!start || !end) return;

    const seq = ++__trendReqSeq;

    if (ts3Placeholder) {
      ts3Placeholder.style.display = "grid";
      ts3Placeholder.textContent = "불러오는 중...";
    }
    ts3Canvas.style.display = "none";

    try {
      const reqKeywords = [baseKeyword, ...Array.from(compareSet)];

      const trend = await fetchTrend(start, end, reqKeywords);

      if (seq !== __trendReqSeq) return;

      if (!trend?.success || !trend?.series) {
        if (ts3Placeholder) {
          ts3Placeholder.style.display = "grid";
          ts3Placeholder.textContent = "trend 데이터 없음";
        }
        return;
      }

      const agg = aggregateTrendToGrain(trend, grain, start, end);
      const labels = agg.labels;
      const seriesAll = agg.series;
      const seriesKeys = Object.keys(seriesAll);

      function resolveSeriesKey(uiKw) {
        const kw = String(uiKw).trim();
        if (seriesAll[kw]) return kw;
        return seriesKeys.find((k) => k.includes(kw) || kw.includes(k)) || null;
      }

      const kws = [baseKeyword, ...Array.from(compareSet)];
      const datasets = [];

      const usedColors = new Set(); // 차트 1회 렌더 기준

      for (const uiKw of kws) {
        const serverKw = resolveSeriesKey(uiKw);
        if (!serverKw) continue;

        const lineColor = pickUniqueColor(uiKw, usedColors);

        datasets.push({
          label: uiKw,
          data: seriesAll[serverKw] || new Array(labels.length).fill(0),
          borderColor: lineColor,
          backgroundColor: lineColor,
          borderWidth: uiKw === baseKeyword ? 3 : 2,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 4,
        });
      }

      if (!datasets.length) {
        if (ts3Placeholder) {
          ts3Placeholder.style.display = "grid";
          ts3Placeholder.textContent = `선택 키워드("${baseKeyword}")가 trend 데이터(series)에 없습니다.`;
        }
        ts3Canvas.style.display = "none";
        if (chart) {
          chart.destroy();
          chart = null;
        }
        return;
      }

      if (ts3Placeholder) ts3Placeholder.style.display = "none";
      ts3Canvas.style.display = "block";

      const ctx = ts3Canvas.getContext("2d");

      if (!chart) {
        chart = new Chart(ctx, {
          type: "line",
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: true, position: "top" },
              tooltip: { enabled: true },
            },
            scales: {
              x: { title: { display: true, text: "기간" }, ticks: { maxRotation: 0 } },
              y: { title: { display: true, text: "언급량" }, beginAtZero: true },
            },
          },
        });
      } else {
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.update();
      }
    } catch (e) {
      if (seq !== __trendReqSeq) return;

      if (ts3Placeholder) {
        ts3Placeholder.style.display = "grid";
        ts3Placeholder.textContent = "차트 불러오기 실패(콘솔 확인)";
      }
      ts3Canvas.style.display = "none";
    }
  }

  // =========================================================
  // TS3: 버튼(비교 토글) + baseKeyword 변경
  // =========================================================
  function syncButtons() {
    if (!ts3KlistEl) return;
    const btns = Array.from(ts3KlistEl.querySelectorAll(".ts3-kbtn"));
    btns.forEach((b) => {
      const kw = b.dataset.keyword;
      const isBase = kw === baseKeyword;
      const isCompare = compareSet.has(kw);

      b.classList.toggle("is-active", isBase || isCompare);
      b.setAttribute("aria-pressed", isBase || isCompare ? "true" : "false");
    });
  }

  function setBaseKeyword(next) {
    if (!next) return;

    baseKeyword = next;
    compareSet = new Set(); // 기준 바뀌면 비교 초기화 (원하면 유지로 바꿀 수 있음)

    if (ts3WordTag) ts3WordTag.textContent = baseKeyword;
    if (ts3DonutTag) ts3DonutTag.textContent = baseKeyword;

    syncButtons();
    renderCloud(baseKeyword);
    renderDonut(baseKeyword);
    renderLineChart();
  }

  function toggleCompareKeyword(kw) {
    if (!kw) return;
    if (kw === baseKeyword) return; // 기준은 제거 불가


    if (compareSet.has(kw)) compareSet.delete(kw);
    else compareSet.add(kw);

    syncButtons();
    renderLineChart();
  }

  ts3KlistEl?.addEventListener("click", (e) => {
    const btn = e.target.closest(".ts3-kbtn");
    if (!btn) return;
    const kw = btn.dataset.keyword;
    toggleCompareKeyword(kw);
  });

  function rebuildButtons(items) {
    if (!ts3KlistEl) return;

    const kws = items.slice(0, 10).map((x) => x.keyword);

    ts3KlistEl.innerHTML = kws
      .map(
        (kw) =>
          `<button type="button" class="ts3-kbtn" data-keyword="${kw}" role="tab" aria-selected="false">${kw}</button>`
      )
      .join("");

    if (kws.length && !kws.includes(baseKeyword)) {
      setBaseKeyword(kws[0]);
    } else {
      syncButtons();
      renderLineChart();
    }
  }

  // 초기 baseKeyword: 드롭다운과 동기화
  const init = (
    document.querySelector('#keywordDropdown input[type="hidden"]')?.value ||
    document.querySelector("#keywordDropdown .cselect__value")?.textContent ||
    "주식"
  ).trim();
  setBaseKeyword(init);

  // 기간 바뀌면 TS3 갱신
  document.addEventListener("app:rangechange", () => {
    renderLineChart();
    renderCloud(baseKeyword);
    renderDonut(baseKeyword);
  });

  return {
    setKeyword: setBaseKeyword,
    toggleCompareKeyword,
    rebuildButtons,
    getState: () => ({ baseKeyword, compare: Array.from(compareSet) }),
  };
})();

window.ts3Api = ts3Api;


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
