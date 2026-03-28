from fastapi import HTTPException, Request


def admin_required(request: Request) -> None:
    """Require a logged-in admin session."""
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401, detail="Login required")
    if request.session.get("user_role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
