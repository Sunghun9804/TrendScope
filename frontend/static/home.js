(() => {
  const slider = document.querySelector(".product-slider");
  const track = document.querySelector(".product-slider__track");
  const cards = Array.from(document.querySelectorAll(".feature-row .mini-card"));
  const row = document.querySelector(".feature-row");

  if (!slider || !track || cards.length === 0 || !row) return;

  // ---- real slides 가져오기 ----
  let realSlides = Array.from(track.querySelectorAll(".product-slider__slide"));
  if (realSlides.length === 0) return;

  // data-idx 자동 부여 (CSS nth-of-type 대체)
  realSlides.forEach((s, i) => (s.dataset.idx = String(i)));

  // ---- 무한루프용 clone (앞/뒤 1개씩) ----
  if (!track.dataset.loop) {
    const firstClone = realSlides[0].cloneNode(true);
    const lastClone = realSlides[realSlides.length - 1].cloneNode(true);
    firstClone.dataset.clone = "1";
    lastClone.dataset.clone = "1";

    track.insertBefore(lastClone, realSlides[0]); // 맨 앞
    track.appendChild(firstClone);                // 맨 뒤
    track.dataset.loop = "1";
  }

  // clone 포함한 전체 slides
  const slides = Array.from(track.querySelectorAll(".product-slider__slide"));
  const realCount = realSlides.length;          // 진짜 개수
  const lastRealIndex = realCount - 1;

  // 트랙 인덱스: [0]=lastClone, [1..realCount]=real, [realCount+1]=firstClone
  let currentRealIndex = 0;
  let currentTrackIndex = 1; // 시작은 첫 real

  // 이미지 드래그 고스트 방지
  slides.forEach((img) => {
    img.draggable = false;
    img.addEventListener("dragstart", (e) => e.preventDefault());
  });

  const TRANSITION = "transform 520ms cubic-bezier(.2,.9,.2,1)";

  function setAnimating(on) {
    slider.classList.toggle("is-animating", !!on);
  }

  function updateUI(realIndex, trackIndexForActive) {
    slides.forEach((el, i) => el.classList.toggle("is-active", i === trackIndexForActive));

    cards.forEach((el, i) => {
      const active = i === realIndex;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
      el.tabIndex = active ? 0 : -1;
    });
  }

  function goTrack(trackIndex, { animate = true, uiRealIndex = currentRealIndex } = {}) {
    currentTrackIndex = trackIndex;
    if (animate) setAnimating(true);

    track.style.transition = animate ? TRANSITION : "none";

    // transition이 none→on 바뀌는 타이밍에서 끊기는 것 방지
    if (animate) {
      requestAnimationFrame(() => {
        track.style.transform = `translate3d(-${trackIndex * 100}%, 0, 0)`;
      });
    } else {
      track.style.transform = `translate3d(-${trackIndex * 100}%, 0, 0)`;
    }

    updateUI(uiRealIndex, trackIndex);
  }

  function goReal(realIndex, { animate = true } = {}) {
    currentRealIndex = realIndex;
    goTrack(realIndex + 1, { animate, uiRealIndex: realIndex });
  }

  // 초기 위치: 첫 real
  const initialReal = (() => {
    const idx = cards.findIndex((c) => c.classList.contains("is-active"));
    return idx >= 0 ? Math.min(idx, lastRealIndex) : 0;
  })();
  goReal(initialReal, { animate: false });

  // ---- wrap 처리: clone에 도착하면 진짜로 순간이동 ----
  track.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;

    setAnimating(false);

    // 맨 뒤 firstClone(= realCount+1)에 도착했다면 → 진짜 첫 real(=1)로 순간이동
    if (currentTrackIndex === realCount + 1) {
      track.style.transition = "none";
      currentTrackIndex = 1;
      track.style.transform = `translate3d(-${currentTrackIndex * 100}%, 0, 0)`;
      currentRealIndex = 0;
      updateUI(0, 1);
    }

    // 맨 앞 lastClone(=0)에 도착했다면 → 진짜 마지막 real(=realCount)로 순간이동
    if (currentTrackIndex === 0) {
      track.style.transition = "none";
      currentTrackIndex = realCount;
      track.style.transform = `translate3d(-${currentTrackIndex * 100}%, 0, 0)`;
      currentRealIndex = lastRealIndex;
      updateUI(lastRealIndex, realCount);
    }
  });

  function next() {
    if (currentRealIndex === lastRealIndex) {
      // 마지막 real → firstClone로 한 칸 이동(부드럽게)
      currentRealIndex = 0; // UI는 미리 0으로 보여도 자연스러움
      goTrack(realCount + 1, { animate: true, uiRealIndex: 0 });
    } else {
      goReal(currentRealIndex + 1, { animate: true });
    }
  }

  function prev() {
    if (currentRealIndex === 0) {
      // 첫 real → lastClone로 한 칸 이동(부드럽게)
      currentRealIndex = lastRealIndex;
      goTrack(0, { animate: true, uiRealIndex: lastRealIndex });
    } else {
      goReal(currentRealIndex - 1, { animate: true });
    }
  }

  // 카드 클릭(위임)
  row.addEventListener("click", (e) => {
    const card = e.target.closest(".mini-card");
    if (!card) return;
    const idx = Number.parseInt(card.dataset.slide ?? "", 10);
    if (!Number.isNaN(idx)) goReal(Math.min(idx, lastRealIndex), { animate: true });
  });

  // 키보드
  row.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
      return;
    }

    const card = e.target.closest(".mini-card");
    if (!card) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const idx = Number.parseInt(card.dataset.slide ?? "", 10);
      if (!Number.isNaN(idx)) goReal(Math.min(idx, lastRealIndex), { animate: true });
    }
  });

  /* =========================
     Drag / Swipe
     ========================= */
  let isDown = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let didDrag = false;

  const getWidth = () => slider.getBoundingClientRect().width || 1;

  function applyDrag(dx) {
    const w = getWidth();
    const base = -(currentTrackIndex * w);
    track.style.transform = `translate3d(${base + dx}px, 0, 0)`;
  }

  function dragStart(x, y) {
    isDown = true;
    isDragging = false;
    didDrag = false;
    startX = x;
    startY = y;
    lastX = x;

    slider.classList.add("is-dragging");
    track.style.transition = "none";
    setAnimating(false);
  }

  function dragMove(x, y, prevent) {
    if (!isDown) return;

    const dx = x - startX;
    const dy = y - startY;

    if (!isDragging) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      isDragging = true;
    }

    if (prevent) prevent();
    didDrag = true;
    lastX = x;
    applyDrag(dx);
  }

  function dragEnd() {
    if (!isDown) return;

    isDown = false;
    slider.classList.remove("is-dragging");

    const dx = lastX - startX;
    const w = getWidth();
    const threshold = w * 0.18;

    if (isDragging && Math.abs(dx) > threshold) {
      dx < 0 ? next() : prev();
    } else {
      // 원위치 스냅
      goTrack(currentTrackIndex, { animate: true, uiRealIndex: currentRealIndex });
    }

    isDragging = false;
  }

  if (window.PointerEvent) {
    slider.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragStart(e.clientX, e.clientY);
      slider.setPointerCapture?.(e.pointerId);
    }, { passive: false });

    slider.addEventListener("pointermove", (e) => {
      dragMove(e.clientX, e.clientY, () => {
        if (e.pointerType !== "mouse") e.preventDefault();
      });
    }, { passive: false });

    slider.addEventListener("pointerup", dragEnd);
    slider.addEventListener("pointercancel", dragEnd);
    slider.addEventListener("lostpointercapture", dragEnd);
  }

  // 드래그 후 클릭 튐 방지
  slider.addEventListener("click", (e) => {
    if (!didDrag) return;
    e.preventDefault();
    e.stopPropagation();
    didDrag = false;
  }, true);
})();