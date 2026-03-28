async function mountSidebar() {
  const mount = document.getElementById("sidebarMount");
  if (!mount) return;

  const res = await fetch("/view/sidebar.html", { cache: "no-cache" });
  const html = await res.text();
  mount.innerHTML = html;
  window.__initMobileSidebarToggle?.();
  window.SidebarRoleBridge?.refresh?.();
  window.SidebarRoleBridge?.apply?.();

  // 모달 레이어를 body로 빼기: fixed가 viewport 기준으로 동작하게
  const layer = mount.querySelector("#tsNeedLoginLayer");
  if (layer) {
    // 혹시 중복 방지(같은 페이지에서 재마운트하는 경우 대비)
    const already = document.body.querySelector("#tsNeedLoginLayer");
    if (!already) document.body.appendChild(layer);
  }

  window.__initSidebarAndAnchors?.();
  window.__initRequireLoginModal?.();
}

document.addEventListener("DOMContentLoaded", () => {
  mountSidebar();
});

window.__initRoleBasedMenu?.();