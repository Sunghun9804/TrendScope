from typing import Optional

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

import apps.core.user.auth.user as user

router = APIRouter(tags=["user"])


def _require_text(value: str, message: str):
    if not value.strip():
        return {"success": False, "message": message}
    return None


@router.post("/login_check")
def login_check(request: Request, user_id: str = Form(...), pw: str = Form(...)):
    result = user.login(user_id, pw, request.session)
    if result.get("success"):
        return {"success": True, "msg": "로그인 성공"}
    return {"success": False, "msg": result.get("message"), "count": result.get("count")}


@router.get("/logout")
def logout(request: Request):
    user.logout(request.session)
    return RedirectResponse("/view/home.html")


@router.post("/register")
def register(
    user_id: str = Form(...),
    pw: str = Form(...),
    email: str = Form(...),
    name: str = Form(...),
    birthday: str = Form(...),
    phone: Optional[str] = Form(None),
    eco_state: Optional[str] = Form(None),
    gender: str = Form(...),
):
    result = user.signup(
        user_id=user_id,
        pw=pw,
        email=email,
        name=name,
        birthday=birthday,
        phone=phone or "",
        eco_state=eco_state or "",
        gender=gender,
    )
    return {"success": result.get("success"), "msg": result.get("message")}


@router.post("/id_check")
def id_check(user_id: str = Form(...)):
    return user.check_user_id(user_id)


@router.post("/get_id")
def get_id(name: str = Form(...), email: str = Form(...)):
    name_error = _require_text(name, "이름을 입력해주세요.")
    if name_error:
        return name_error

    email_error = _require_text(email, "이메일을 입력해주세요.")
    if email_error:
        return email_error

    return user.find_id(name, email)


@router.post("/password_check")
def password_check(
    request: Request,
    user_id: str = Form(...),
    name: str = Form(...),
    email: str = Form(...),
):
    for value, message in [
        (user_id, "아이디를 입력해주세요."),
        (name, "이름을 입력해주세요."),
        (email, "이메일을 입력해주세요."),
    ]:
        error = _require_text(value, message)
        if error:
            return error

    result = user.find_pw(user_id, name, email)
    if result.get("success"):
        request.session["pw_reset_user"] = user_id
    return result


@router.post("/new_pw")
def new_pw(request: Request, new_pw: str = Form(...), new_pw_confirm: str = Form(...)):
    user_id = request.session.get("pw_reset_user")
    if not user_id:
        return {
            "success": False,
            "message": "비밀번호 변경 권한이 없습니다. 비밀번호 찾기를 다시 진행해주세요.",
        }

    new_pw_error = _require_text(new_pw, "새 비밀번호를 입력해주세요.")
    if new_pw_error:
        return new_pw_error

    confirm_error = _require_text(new_pw_confirm, "비밀번호 확인을 입력해주세요.")
    if confirm_error:
        return confirm_error

    if new_pw != new_pw_confirm:
        return {"success": False, "message": "비밀번호가 일치하지 않습니다."}

    result = user.change_pw(user_id, new_pw)
    if result.get("success"):
        request.session.pop("pw_reset_user", None)
    return result


@router.post("/mypage/password_check")
def mypage_password_check(request: Request, pw: str = Form(...)):
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse("/view/login.html")

    error = _require_text(pw, "비밀번호를 입력해주세요.")
    if error:
        return error

    result = user.check_my_page_pw(user_id, pw)
    if result.get("success"):
        request.session["my_page_verified"] = True
        return RedirectResponse("/view/info_edit.html")
    return {"success": False, "message": result.get("message")}


@router.get("/my_page_load/data")
def my_page_load_data(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return {"success": False, "message": "로그인이 필요합니다."}
    if not request.session.get("my_page_verified"):
        return {"success": False, "message": "비밀번호 확인이 필요합니다."}
    return user.get_my_page(user_id)


@router.post("/info_update")
def info_update(
    request: Request,
    pw: str = Form(...),
    pw_confirm: str = Form(...),
    email: str = Form(...),
    name: str = Form(...),
    birthday: str = Form(...),
    phone: str = Form(...),
    eco_state: str = Form(...),
    gender: str = Form(...),
):
    user_id = request.session.get("user_id")
    if not user_id:
        return {"success": False, "message": "로그인이 필요합니다."}
    if not request.session.get("my_page_verified"):
        return {"success": False, "message": "비밀번호 확인이 필요합니다."}

    result = user.update_my_page_info(
        user_id,
        {
            "pw": pw,
            "pw_confirm": pw_confirm,
            "email": email,
            "name": name,
            "birthday": birthday,
            "phone": phone,
            "eco_state": eco_state,
            "gender": gender,
        },
    )
    if result.get("success"):
        request.session.pop("my_page_verified", None)
    return result


@router.get("/api/session")
def session_info(request: Request):
    return {
        "logged_in": bool(request.session.get("user_id")),
        "admin_in": bool(request.session.get("user_role") == "admin"),
    }
