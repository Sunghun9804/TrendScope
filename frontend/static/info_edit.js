// /static/info_edit.js  (페이지 전용: 회원정보 로드/수정/모달)
$(function () {
  const ENDPOINT_LOAD = "/my_page_load/data";
  const ENDPOINT_UPDATE = "/info_update";
  const ENDPOINT_VERIFY_PW = "/mypage/password_check";

  const $form = $("#editForm");
  const $reviseBtn = $("button.revise");

  const $pw = $("#password");
  const $pw2 = $("#confirmPassword");
  const $pwMsg = $("#passwordError");

  const $updateModal = $("#updateModal");
  const $updateModalText = $("#updateModal .modal-content p");
  const $withdrawModal = $("#withdrawModal");

  let pendingSubmit = false; // ✅ 비번 확인 후 자동 저장 플래그

  // ===== 모달 전역 (HTML onclick에서 호출) =====
  window.closeUpdateModal = () => {
    $updateModal.hide().attr("aria-hidden", "true");
    location.href = "/my_page";
  };

  window.openModal = () => $withdrawModal.css("display", "flex");
  window.closeModal = () => $withdrawModal.hide();
  window.confirmWithdraw = () => {
    alert("현재 백엔드에 '탈퇴 API'가 없어 실제 탈퇴는 불가능합니다.");
    closeModal();
  };

  function setReviseEnabled(enabled) {
    $reviseBtn.prop("disabled", !enabled).attr("aria-disabled", String(!enabled));
  }

  function validatePasswordMatch() {
    const pw = ($pw.val() || "").trim();
    const confirm = ($pw2.val() || "").trim();

    // 비번 변경 안 하면 OK(빈칸 2개)
    if (pw === "" && confirm === "") {
      $pwMsg.text("").removeClass("success");
      setReviseEnabled(true);
      return true;
    }

    if (pw === "" || confirm === "") {
      $pwMsg.text("비밀번호를 변경하려면 동일하게 2번 입력해 주세요.").removeClass("success");
      setReviseEnabled(false);
      return false;
    }

    if (pw !== confirm) {
      $pwMsg.text("비밀번호가 일치하지 않습니다.").removeClass("success");
      setReviseEnabled(false);
      return false;
    }

    $pwMsg.text("비밀번호가 일치합니다.").addClass("success");
    setReviseEnabled(true);
    return true;
  }

  $pw.on("input", validatePasswordMatch);
  $pw2.on("input", validatePasswordMatch);

  // ===== AJAX =====
  function requestLoad() {
    return $.ajax({
      url: ENDPOINT_LOAD,
      method: "GET",
      dataType: "json",
      timeout: 10000,
      xhrFields: { withCredentials: true },
    });
  }

  function requestUpdate(payload) {
    return $.ajax({
      url: ENDPOINT_UPDATE,
      method: "POST",
      dataType: "json",
      data: payload,
      timeout: 10000,
      xhrFields: { withCredentials: true },
    });
  }

  // RedirectResponse라 text로 받아서 “JSON이면 실패 / 아니면 성공” 처리
  function requestVerifyPassword(pw) {
    return $.ajax({
      url: ENDPOINT_VERIFY_PW,
      method: "POST",
      dataType: "text",
      data: { pw },
      timeout: 10000,
      xhrFields: { withCredentials: true },
    });
  }

  function fillForm(res) {
    const data = res.data || {};

    $form[0].elements.name.value = data.name ?? "";
    $form[0].elements.email.value = data.email ?? "";
    $form[0].elements.birthday.value = data.birthday ?? "";
    $form[0].elements.phone.value = data.phone ?? "";

    const genderMap = { "남": "M", "여": "F", "M": "M", "F": "F" };
    const genderVal = genderMap[(data.gender || "").trim()] || "M";
    $form.find('input[name="gender"]').prop("checked", false);
    $form.find(`input[name="gender"][value="${genderVal}"]`).prop("checked", true);

    const ecoMap = {
      "상": "HIGH", "중상": "MID_HIGH", "중": "MID", "중하": "MID_LOW", "하": "LOW",
      "HIGH": "HIGH", "MID_HIGH": "MID_HIGH", "MID": "MID", "MID_LOW": "MID_LOW", "LOW": "LOW",
    };
    const ecoVal = ecoMap[(data.eco_state || "").trim()] || "MID_HIGH";
    $form.find('input[name="eco_state"]').prop("checked", false);
    $form.find(`input[name="eco_state"][value="${ecoVal}"]`).prop("checked", true);
  }

  function buildPayload() {
    const payload = {
      email: ($form.find('input[name="email"]').val() || "").trim(),
      name: ($form.find('input[name="name"]').val() || "").trim(),
      birthday: $form.find('input[name="birthday"]').val(),
      phone: ($form.find('input[name="phone"]').val() || "").trim(),
      eco_state: $form.find('input[name="eco_state"]:checked').val(),
      gender: $form.find('input[name="gender"]:checked').val(),
    };

    const newPw = ($pw.val() || "").trim();
    const newPw2 = ($pw2.val() || "").trim();

    // 비번 변경 X → verifiedPw를 채워서 POST 요구사항 만족
    if (newPw === "" && newPw2 === "") {
      const verifiedPw = sessionStorage.getItem("verifiedPw") || "";
      if (!verifiedPw) throw new Error("비밀번호 확인이 필요합니다.");
      payload.pw = verifiedPw;
      payload.pw_confirm = verifiedPw;
    } else {
      payload.pw = newPw;
      payload.pw_confirm = newPw2;
    }

    return payload;
  }

  // ===== 비번 확인 모달 =====
  function tryParseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function mountPwVerifyModalOnce() {
    if ($("#pwVerifyModal").length) return;

    $("head").append(`
      <style id="pwVerifyModalStyle">
        #pwVerifyModal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;}
        #pwVerifyModal .box{width:min(420px,calc(100vw - 40px));margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(15,40,90,.22);}
        #pwVerifyModal .hd{padding:14px 16px;font-weight:900;border-bottom:1px solid #eef2fb;color:#1d2b42;}
        #pwVerifyModal .bd{padding:14px 16px;display:flex;flex-direction:column;gap:10px;}
        #pwVerifyModal input{width:100%;padding:12px;border-radius:12px;border:1px solid #dfe8f7;outline:none;}
        #pwVerifyModal input:focus{border-color:#a6c8ef;box-shadow:0 0 0 3px rgba(4,98,210,.12);}
        #pwVerifyModal .msg{font-size:12px;font-weight:800;color:#e53935;min-height:16px;}
        #pwVerifyModal .ft{padding:12px 16px 16px;display:flex;gap:10px;justify-content:flex-end;}
        #pwVerifyModal .btn{border:none;border-radius:12px;padding:10px 14px;font-weight:900;cursor:pointer;}
        #pwVerifyModal .btn-cancel{background:#f1f5fb;color:#6a7a93;}
        #pwVerifyModal .btn-ok{background:#0462D2;color:#fff;}
        #pwVerifyModal .btn-ok:disabled{opacity:.6;cursor:not-allowed;}
      </style>
    `);

    $("body").append(`
      <div id="pwVerifyModal" aria-hidden="true">
        <div class="box" role="dialog" aria-modal="true" aria-labelledby="pwVerifyTitle">
          <div class="hd" id="pwVerifyTitle">비밀번호 확인</div>
          <div class="bd">
            <div style="font-size:12px;font-weight:800;color:#6a7a93;">
              회원정보 수정을 위해 비밀번호 확인이 필요합니다.
            </div>
            <input type="password" id="pwVerifyInput" placeholder="비밀번호를 입력해 주세요." />
            <div class="msg" id="pwVerifyMsg"></div>
          </div>
          <div class="ft">
            <button type="button" class="btn btn-cancel" id="pwVerifyCancel">취소</button>
            <button type="button" class="btn btn-ok" id="pwVerifyOk">확인</button>
          </div>
        </div>
      </div>
    `);

    $("#pwVerifyCancel").on("click", () => {
      $("#pwVerifyModal").hide().attr("aria-hidden", "true");
      location.href = "/my_page";
    });

    $("#pwVerifyOk").on("click", () => {
      const pw = ($("#pwVerifyInput").val() || "").trim();
      if (!pw) {
        $("#pwVerifyMsg").text("비밀번호를 입력해주세요.");
        $("#pwVerifyInput").focus();
        return;
      }

      $("#pwVerifyMsg").text("");
      $("#pwVerifyOk").prop("disabled", true).text("확인 중...");

      requestVerifyPassword(pw)
        .done((text) => {
          const json = tryParseJson(text);
          if (json && json.success === false) {
            $("#pwVerifyMsg").text(json.message || "비밀번호가 올바르지 않습니다.");
            return;
          }

          sessionStorage.setItem("verifiedPw", pw);

          $("#pwVerifyModal").hide().attr("aria-hidden", "true");
          $("#pwVerifyInput").val("");

          // ✅ 저장하려다 비번 확인을 띄운 거면, 확인 후 자동 저장
          if (pendingSubmit) {
            pendingSubmit = false;
            doUpdate(buildPayload());
          } else {
            attemptLoad();
          }
        })
        .fail(() => $("#pwVerifyMsg").text("서버 오류가 발생했습니다."))
        .always(() => $("#pwVerifyOk").prop("disabled", false).text("확인"));
    });

    $(document).on("keydown", (e) => {
      if ($("#pwVerifyModal").is(":visible") && e.key === "Enter") {
        e.preventDefault();
        $("#pwVerifyOk").click();
      }
    });
  }

  function openPwVerifyModal() {
    mountPwVerifyModalOnce();
    $("#pwVerifyModal").css("display", "flex").attr("aria-hidden", "false");
    $("#pwVerifyMsg").text("");
    $("#pwVerifyInput").val("").focus();
  }

  function doUpdate(payload) {
    const originalText = $reviseBtn.text();
    $reviseBtn.text("저장 중...").prop("disabled", true);

    requestUpdate(payload)
      .done((res) => {
        if (!res.success) {
          $pwMsg.text(res.message || "저장 실패").removeClass("success");
          setReviseEnabled(false);
          return;
        }
        $updateModalText.text("회원정보가 수정되었습니다.");
        $updateModal.css("display", "flex").attr("aria-hidden", "false");
      })
      .fail((xhr) => {
        const msg =
          (xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.detail)) ||
          "저장에 실패했습니다.";

        // 비번 확인 요구면 모달 → 확인 후 자동 저장까지 이어감
        if (String(msg).includes("비밀번호 확인")) {
          pendingSubmit = true;
          openPwVerifyModal();
          return;
        }

        alert(msg);
      })
      .always(() => {
        $reviseBtn.text(originalText);
        validatePasswordMatch();
      });
  }

  $form.on("submit", (e) => {
    e.preventDefault();

    if (!validatePasswordMatch()) {
      $pw2.focus();
      return;
    }

    try {
      doUpdate(buildPayload());
    } catch {
      pendingSubmit = true;
      openPwVerifyModal();
    }
  });

  function attemptLoad() {
    requestLoad()
      .done((res) => {
        if (res.success === false) {
          const msg = res.message || "";
          if (msg.includes("로그인")) return (location.href = "/login");
          if (msg.includes("비밀번호 확인")) return (location.href = "/my_page");
          alert(msg || "접근할 수 없습니다.");
          return (location.href = "/my_page");
        }
        fillForm(res);
      })
      .fail(() => (location.href = "/login"))
      .always(() => validatePasswordMatch());
  }

  setReviseEnabled(false);
  attemptLoad();
});