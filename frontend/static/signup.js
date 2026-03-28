(() => {
    const $ = (sel) => document.querySelector(sel);

    // ===== Elements (signup.html 기준) =====
    const form = $("#joinForm");

    const jId = $("#jId");
    const jPw = $("#jPw");
    const jPw2 = $("#jPw2");
    const jName = $("#jName");
    const jBirth = $("#jBirth");
    const jPhone = $("#jPhone");
    const jEmail = $("#jEmail");
    const pwMatchMsg = document.querySelector("#pwMatchMsg");
    const pwRuleMsg = document.querySelector("#pwRuleMsg");

    const idMsg = $("#idMsg");
    const formErr = $("#formErr");

    const btnCheckId = $("#btnCheckId");
    const btnJoin = $("#btnJoin");

    // Layers
    const tsAvailLayer = $("#tsAvailLayer");
    const tsDupLayer = $("#tsDupLayer");
    const tsJoinAskLayer = $("#tsJoinAskLayer");

    const tsAvailBtn = $("#tsAvailBtn");
    const tsDupBtn = $("#tsDupBtn");
    const tsJoinAskBtn = $("#tsJoinAskBtn");

    // ===== Server routes (main.py 기준) =====
    const API_ID_CHECK = "/id_check";
    const API_REGISTER = "/register";

    // ===== Validation (user.py 기준) =====
    // 비밀번호: 영문 소문자 + 숫자 포함, 4~16자, [a-z0-9]만
    const PW_REGEX = /^(?=.*[a-z])(?=.*\d)[a-z\d]{4,16}$/;

    // 이메일 형식
    const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

    // 휴대전화(선택): 숫자 10~11자리
    const PHONE_REGEX = /^\d{10,11}$/;

    // ===== State =====
    let idChecked = false;    // 중복확인 버튼 눌렀는지
    let idAvailable = false;  // 사용 가능 판정인지

    // ===== UI helpers =====
    function showLayer(layerEl) {
        if (!layerEl) return;
        layerEl.setAttribute("aria-hidden", "false");
        layerEl.style.display = "block";
    }

    function hideLayer(layerEl) {
        if (!layerEl) return;
        layerEl.setAttribute("aria-hidden", "true");
        layerEl.style.display = "none";
    }

    function setIdMsg(text, ok) {
        if (!idMsg) return;
        idMsg.textContent = text || "";
        idMsg.style.display = text ? "block" : "none";
        idMsg.classList.toggle("ok", !!ok);
        idMsg.classList.toggle("bad", !ok);
    }

    function setFormErr(text) {
        if (!formErr) return;
        formErr.textContent = text || "";
        formErr.style.display = text ? "block" : "none";
    }

    function setPwMatchMsg(text, ok) {
        if (!pwMatchMsg) return;
        pwMatchMsg.textContent = text || "";
        pwMatchMsg.style.display = text ? "block" : "none";
        pwMatchMsg.classList.toggle("ok", !!ok);
        pwMatchMsg.classList.toggle("bad", !ok);
    }

    function updatePwMatchLive() {
      const pw = (jPw?.value || "").trim();
      const pw2 = (jPw2?.value || "").trim();

      // ===== 비밀번호 규칙 체크 =====
      if (!pw) {
        setPwRuleMsg("", true);
      } else if (PW_REGEX.test(pw)) {
        setPwRuleMsg("비밀번호 규칙을 만족합니다.", true);
      } else {
        setPwRuleMsg("비밀번호 규칙을 만족하지 않습니다.", false);
      }

      // ===== 비밀번호 일치 체크 =====
      if (!pw && !pw2) {
        setPwMatchMsg("", true);
        return;
      }

      if (pw && !pw2) {
        setPwMatchMsg("비밀번호 확인을 입력해주세요.", false);
        return;
      }

      if (!pw && pw2) {
        setPwMatchMsg("비밀번호를 먼저 입력해주세요.", false);
        return;
      }

      if (pw === pw2) {
        setPwMatchMsg("비밀번호가 일치합니다.", true);
      } else {
        setPwMatchMsg("비밀번호가 일치하지 않습니다.", false);
      }
    }


    function setPwRuleMsg(text, ok) {
      if (!pwRuleMsg) return;
      pwRuleMsg.textContent = text || "";
      pwRuleMsg.style.display = text ? "block" : "none";
      pwRuleMsg.classList.toggle("ok", !!ok);
      pwRuleMsg.classList.toggle("bad", !ok);
    }


    function getSelectedRadioValue(name) {
        const el = document.querySelector(`input[name="${name}"]:checked`);
        return el ? el.value : "";
    }

    function todayISO() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    function setupBirthMax() {
        if (!jBirth) return;
        jBirth.max = todayISO();
    }

    function normalizeDigitsOnly(inputEl) {
        if (!inputEl) return;
        inputEl.value = (inputEl.value || "").replace(/\D/g, "");
    }

    function resetIdCheckState() {
        idChecked = false;
        idAvailable = false;
        setIdMsg("", true);
        updateJoinButtonState();
    }

    function validateFields({ silent = false } = {}) {
        if (!silent) setFormErr("");

        const user_id = (jId?.value || "").trim();
        const pw = (jPw?.value || "").trim();
        const pw2 = (jPw2?.value || "").trim();
        const name = (jName?.value || "").trim();
        const birthday = (jBirth?.value || "").trim();
        const email = (jEmail?.value || "").trim();
        const phone = (jPhone?.value || "").trim();

        const gender = getSelectedRadioValue("gender");
        const eco_state = getSelectedRadioValue("eco_state"); // 선택

        // ✅ 아이디: 규칙 없음, "빈값만" 체크
        if (!user_id) return fail("아이디를 입력해주세요.", silent);

        // ✅ 필수값
        if (!pw) return fail("비밀번호를 입력해주세요.", silent);
        if (!pw2) return fail("비밀번호 확인을 입력해주세요.", silent);
        if (!name) return fail("이름을 입력해주세요.", silent);
        if (!gender) return fail("성별을 선택해주세요.", silent);
        if (!birthday) return fail("생년월일을 선택해주세요.", silent);
        if (!email) return fail("이메일을 입력해주세요.", silent);

        // ✅ 비밀번호 규칙(user.py)
        if (!PW_REGEX.test(pw)) {
            return fail("비밀번호는 영문 소문자와 숫자를 포함한 4~16자여야 합니다.", silent);
        }

        // ✅ 비밀번호 확인 일치
        if (pw !== pw2) {
            return fail("비밀번호가 일치하지 않습니다.", silent);
        }

        // ✅ 이메일 형식
        if (!EMAIL_REGEX.test(email)) {
            return fail("이메일 형식이 올바르지 않습니다.", silent);
        }

        // ✅ 생년월일 미래 금지(프론트 UX)
        const max = jBirth?.max || todayISO();
        if (birthday > max) {
            return fail("생년월일은 미래 날짜를 선택할 수 없습니다.", silent);
        }

        // ✅ 휴대전화(선택)
        if (phone && !PHONE_REGEX.test(phone)) {
            return fail("휴대전화 번호는 숫자만 10~11자리로 입력해주세요.", silent);
        }

        return {
            ok: true,
            data: { user_id, pw, name, gender, birthday, phone, email, eco_state }
        };

        function fail(msg, silentMode) {
            if (!silentMode) setFormErr(msg);
            return { ok: false, message: msg };
        }
    }

    function updateJoinButtonState() {
        const v = validateFields({ silent: true });
        // ✅ 필수값 OK + 중복확인 성공해야 가입 가능
        const enabled = v.ok && idChecked && idAvailable;
        if (btnJoin) btnJoin.disabled = !enabled;
    }

    // ===== Safe JSON fetch =====
    async function fetchJson(url, options) {
        const resp = await fetch(url, options);
        const text = await resp.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (e) {
            data = null;
        }
        return { resp, data, rawText: text };
    }

    // ===== 이벤트 등록 =====
    setupBirthMax(); // 생년월일 max 에 오늘 날짜 걸어서 미래 선택X
    updateJoinButtonState(); // 지금 입력 상태를 보고 가입하기 버튼 활성화 결정

    // phone 숫자만
    if (jPhone) {
        jPhone.addEventListener("input", () => {
            normalizeDigitsOnly(jPhone);
            updateJoinButtonState();
        });
    }

    // 아이디 바뀌면 중복확인 리셋
    // idChecked = false & idAvailable = false
    // 초기화 하고, 가입 버튼 잠금
    if (jId) {
        jId.addEventListener("input", () => {
            resetIdCheckState();
            updateJoinButtonState();
        });
    }

    // 다른 필드 변경 시 가입 버튼 상태 업데이트
    [jPw, jPw2, jName, jBirth, jEmail].forEach((el) => {
        if (!el) return;
        el.addEventListener("input", updateJoinButtonState);
        el.addEventListener("change", updateJoinButtonState);
    });

    if (jPw) jPw.addEventListener("input", updatePwMatchLive);
    if (jPw2) jPw2.addEventListener("input", updatePwMatchLive);


    // 라디오(성별/경제지식수준) 바뀌면 가입 버튼 업데이트
    document.addEventListener("change", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement)) return;
        if (t.type === "radio" && (t.name === "gender" || t.name === "eco_state")) {
            updateJoinButtonState();
        }
    });

    // 레이어 닫기 버튼
    if (tsAvailBtn) tsAvailBtn.addEventListener("click", () => hideLayer(tsAvailLayer));
    if (tsDupBtn) tsDupBtn.addEventListener("click", () => hideLayer(tsDupLayer));

    // 레이어 배경 클릭 시 닫기(선택)
    [tsAvailLayer, tsDupLayer, tsJoinAskLayer].forEach((layer) => {
        if (!layer) return;
        layer.addEventListener("click", (e) => {
            if (e.target === layer) hideLayer(layer);
        });
    });

    // ===== ID Check (POST /id_check) 서버 연동 =====
    // 중복 확인 버튼을 누르면?
    if (btnCheckId) {
        btnCheckId.addEventListener("click", async () => {
            setFormErr("");
            // 아이디 비었는지 체크
            const user_id = (jId?.value || "").trim();
            if (!user_id) {
                setIdMsg("아이디를 입력해주세요.", false);
                return;
            }

            btnCheckId.disabled = true;
            setIdMsg("중복 확인 중...", true);

            try {
                // 서버에 요청 보내기
                const fd = new FormData();
                fd.append("user_id", user_id);

                const { resp, data, rawText } = await fetchJson(API_ID_CHECK, {
                    method: "POST",
                    body: fd
                });


                // 서버가 기대하는 형태: { success: bool, message: str }
                const success = !!(data && typeof data.success === "boolean" ? data.success : false);
                const message = (data && data.message) ? String(data.message) : "";

                idChecked = true; // 중복 확인 버튼은 눌렀다.
                idAvailable = success; // success 가 true 면 사용 가능
                // 즉, 가입 가능 조건 = 필수 입력 OK + idChecked = true + idAvailable = success

                // 중복 확인 결과를 UI로 보여주고, 가입 버튼 상태 다시 계산
                if (success) {
                    setIdMsg(message || "사용 가능한 아이디입니다.", true);
                } else {
                    // 여기서 message가 "이미 사용 중"이 아니라
                    // "중복 확인 중 오류" 류로 오면 DB/서버쪽 문제일 가능성이 큼
                    setIdMsg(message || "이미 사용 중인 아이디입니다.", false);
                }

                updateJoinButtonState();
            } catch (e) { // 에러가 났을 때 안전 장치
                console.error("[id_check] network error:", e);
                idChecked = false;
                idAvailable = false;
                setIdMsg("네트워크 오류가 발생했습니다.", false);
                updateJoinButtonState();
            } finally {
                btnCheckId.disabled = false;
            }
        });
    }

    // ===== 가입 하기 -> 팝업 =====
    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            setFormErr("");

            const v = validateFields({ silent: false });
            if (!v.ok) {
                updateJoinButtonState();
                return;
            }

            if (!idChecked || !idAvailable) {
                setFormErr("아이디 중복확인을 먼저 완료해주세요.");
                return;
            }

            showLayer(tsJoinAskLayer);
        });
    }

    // ===== 팝업에서 확인 누르면 그때 /register 요청 =====
    if (tsJoinAskBtn) {
        tsJoinAskBtn.addEventListener("click", async () => {
            hideLayer(tsJoinAskLayer);
            setFormErr("");

            const v = validateFields({ silent: false });
            if (!v.ok) {
                updateJoinButtonState();
                return;
            }

            if (!idChecked || !idAvailable) {
                setFormErr("아이디 중복확인을 먼저 완료해주세요.");
                return;
            }

            const fd = new FormData();
            fd.append("user_id", v.data.user_id);
            fd.append("pw", v.data.pw);
            fd.append("email", v.data.email);
            fd.append("name", v.data.name);
            fd.append("birthday", v.data.birthday);
            fd.append("gender", v.data.gender);
            fd.append("phone", v.data.phone || "");
            fd.append("eco_state", v.data.eco_state || "");

            if (btnJoin) btnJoin.disabled = true;

            try {
                const { resp, data, rawText } = await fetchJson(API_REGISTER, {
                    method: "POST",
                    body: fd
                });


                if (!resp.ok) {
                    setFormErr("회원가입 요청 처리 중 오류가 발생했습니다. 입력값을 확인해주세요.");
                    updateJoinButtonState();
                    return;
                }

                const ok = !!(data && data.success === true);
                const msg = (data && data.msg) ? String(data.msg) : "회원가입 처리 결과를 확인할 수 없습니다.";

                if (ok) {
                    window.location.href = "/view/login.html";
                    return;
                }

                setFormErr(msg);
                updateJoinButtonState();
            } catch (e) {
                console.error("[register] network error:", e);
                setFormErr("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
                updateJoinButtonState();
            } finally {
                if (btnJoin) btnJoin.disabled = false;
                updateJoinButtonState();
            }
        });
    }
})();