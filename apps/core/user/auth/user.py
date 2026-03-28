import hashlib
import re

from apps.shared.infra.db import get_db
import apps.core.user.repository.user_repo as user_repo

PASSWORD_PATTERN = r"^(?=.*[a-z])(?=.*\d)[a-z\d]{4,16}$"
EMAIL_PATTERN = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def is_valid_password(pw: str) -> bool:
    return bool(re.match(PASSWORD_PATTERN, pw))


def is_valid_email(email: str) -> bool:
    return bool(re.match(EMAIL_PATTERN, email))


def _required_message(field_name: str) -> dict:
    return {"success": False, "message": f"{field_name}은(는) 필수 입력 항목입니다."}


def login(user_id: str, pw: str, session) -> dict:
    db = get_db()
    try:
        fail_count = user_repo.login_count(db, user_id)["fail_cnt"]
        if fail_count >= 5:
            return {
                "success": False,
                "message": "로그인 5회 실패로 계정이 잠겼습니다.",
                "count": fail_count,
            }

        result = user_repo.login_check(db, {"user_id": user_id, "password_hash": hash_pw(pw)})
        if result["is_valid"]:
            user_repo.insert_login_log(db, user_id, "SUCCESS")
            session["user_id"] = user_id
            session["user_role"] = user_repo.get_user_role(db, user_id)
            db.commit()
            return {"success": True}

        if user_repo.user_exists(db, user_id):
            user_repo.insert_login_log(db, user_id, "FAIL")
            db.commit()

        return {
            "success": False,
            "message": "아이디 또는 비밀번호가 올바르지 않습니다.",
            "count": fail_count + 1,
        }
    except Exception as exc:
        db.rollback()
        return {"success": False, "message": f"로그인 처리 중 오류: {exc}"}
    finally:
        db.close()


def logout(session) -> dict:
    if not session.get("user_id"):
        return {"success": False, "message": "로그인 상태가 아닙니다."}
    session.clear()
    return {"success": True, "message": "로그아웃 되었습니다."}


def signup(
    user_id: str,
    pw: str,
    email: str,
    name: str,
    birthday: str,
    phone: str,
    eco_state: str,
    gender: str,
) -> dict:
    required_fields = {
        "아이디": user_id,
        "비밀번호": pw,
        "이메일": email,
        "이름": name,
        "생년월일": birthday,
        "성별": gender,
    }
    for field_name, value in required_fields.items():
        if not value or not str(value).strip():
            return _required_message(field_name)

    if not is_valid_password(pw):
        return {
            "success": False,
            "message": "비밀번호는 영문 소문자와 숫자를 포함한 4~16자여야 합니다.",
        }

    if not is_valid_email(email):
        return {"success": False, "message": "이메일 형식이 올바르지 않습니다."}

    db = get_db()
    try:
        if user_repo.user_exists(db, user_id) == 1:
            return {"success": False, "message": "이미 사용 중인 아이디입니다."}

        user_repo.register_user(
            db,
            {
                "user_id": user_id,
                "password_hash": hash_pw(pw),
                "email": email,
                "name": name,
                "birthday": birthday,
                "phone": phone,
                "eco_state": eco_state,
                "gender": gender,
            },
        )
        db.commit()
        return {"success": True, "message": "등록 성공."}
    except Exception as exc:
        db.rollback()
        contain = {exc.orig.args[1].split("for key '")[-1].rstrip("'")} if getattr(exc, "orig", None) else set()
        if "uq_users_email" in contain:
            return {"success": False, "message": "중복된 이메일입니다."}
        return {"success": False, "message": "등록 실패."}
    finally:
        db.close()


def check_user_id(user_id: str):
    if not user_id or not user_id.strip():
        return {"success": False, "message": "아이디를 입력해주세요."}

    db = get_db()
    try:
        state = user_repo.user_exists(db, user_id)
        if state == 1:
            return {"success": False, "message": "이미 사용 중인 아이디입니다."}
        return {"success": True, "message": "사용 가능한 아이디입니다."}
    except Exception:
        return {"success": False, "message": "아이디 중복 확인 중 오류가 발생했습니다."}
    finally:
        db.close()


def find_id(name: str, email: str):
    db = get_db()
    try:
        result = user_repo.find_user_id(db, name, email)
        if result:
            return {"success": True, "user_id": result["user_id"]}
        return {"success": False, "user_id": "일치하는 정보가 없습니다."}
    except Exception:
        return {"success": False, "user_id": "오류 발생"}
    finally:
        db.close()


def find_pw(user_id: str, name: str, email: str) -> dict:
    db = get_db()
    try:
        result = user_repo.find_user_pw(db, user_id, name, email)
        if result:
            return {"success": True, "message": "본인 확인이 완료되었습니다."}
        return {"success": False, "message": "입력한 정보와 일치하는 회원이 없습니다."}
    except Exception:
        return {"success": False, "message": "비밀번호 찾기 중 오류가 발생했습니다."}
    finally:
        db.close()


def change_pw(user_id: str, new_pw: str):
    if not new_pw or len(new_pw) < 8:
        return {"success": False, "message": "비밀번호는 8자 이상이어야 합니다."}

    db = get_db()
    try:
        result = user_repo.change_user_pw(db, user_id=user_id, new_pw=hash_pw(new_pw))
        db.commit()
        if result:
            return {"success": True, "message": "비밀번호가 변경되었습니다."}
        return {"success": False, "message": "비밀번호 변경에 실패했습니다."}
    except Exception:
        db.rollback()
        return {"success": False, "message": "비밀번호 변경 중 오류가 발생했습니다."}
    finally:
        db.close()


def check_my_page_pw(user_id: str, pw: str):
    db = get_db()
    try:
        state = user_repo.check_user_pw(db, user_id, hash_pw(pw))
        if state == 0:
            return {"success": False, "message": "비밀번호가 올바르지 않습니다."}
        return {"success": True, "message": "비밀번호 확인이 완료되었습니다."}
    except Exception:
        return {"success": False, "message": "비밀번호 확인 중 오류가 발생했습니다."}
    finally:
        db.close()


def get_my_page(user_id: str) -> dict:
    db = get_db()
    try:
        result = user_repo.get_user_info(db, user_id)
        if result is None:
            return {"success": False, "message": "회원 정보를 찾을 수 없습니다."}
        return {
            "success": True,
            "data": {
                "name": result.get("name"),
                "gender": result.get("gender"),
                "birthday": result.get("birthday"),
                "phone": result.get("phone"),
                "email": result.get("email"),
                "eco_state": result.get("eco_state"),
            },
        }
    except Exception:
        return {"success": False, "message": "회원 정보 조회 중 오류가 발생했습니다."}
    finally:
        db.close()


def update_my_page_info(user_id: str, info: dict):
    required_fields = ["pw", "pw_confirm", "email", "name", "birthday", "gender"]
    for field in required_fields:
        if not info.get(field) or not str(info.get(field)).strip():
            return {"success": False, "message": "필수 항목을 모두 입력해주세요."}

    if info["pw"] != info["pw_confirm"]:
        return {"success": False, "message": "비밀번호가 일치하지 않습니다."}

    db = get_db()
    try:
        result = user_repo.update_user_info(
            db,
            {
                "user_id": user_id,
                "password_hash": hash_pw(info["pw"]),
                "email": info["email"],
                "name": info["name"],
                "birthday": info["birthday"],
                "gender": info["gender"],
                "phone": info.get("phone"),
                "eco_state": info.get("eco_state"),
            },
        )
        if result == 1:
            db.commit()
            return {"success": True, "message": "회원정보가 수정되었습니다."}

        db.rollback()
        return {"success": False, "message": "회원정보 수정에 실패했습니다."}
    except Exception:
        db.rollback()
        return {"success": False, "message": "회원정보 수정 중 오류가 발생했습니다."}
    finally:
        db.close()
