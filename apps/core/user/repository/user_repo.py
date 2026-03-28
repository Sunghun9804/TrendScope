from sqlalchemy import text


def login_count(db, user_id):
    return db.execute(
        text(
            """
            SELECT COUNT(*) AS fail_cnt
            FROM login_log
            WHERE user_id = :user_id
              AND result = 'FAIL'
              AND create_at >= GREATEST(
                    NOW() - INTERVAL 24 HOUR,
                    COALESCE(
                        (
                            SELECT MAX(create_at)
                            FROM login_log
                            WHERE user_id = :user_id
                              AND result = 'SUCCESS'
                        ),
                        '1970-01-01'
                    )
                )
            """
        ),
        {"user_id": user_id},
    ).mappings().fetchone()


def insert_login_log(db, user_id, result):
    db.execute(
        text("INSERT INTO login_log (user_id, result) VALUES (:user_id, :result)"),
        {"user_id": user_id, "result": result},
    )


def get_user_role(db, user_id):
    result = db.execute(
        text(
            """
            SELECT ur.role_id, role_name
            FROM roles r
            JOIN user_roles ur ON r.role_id = ur.role_id
            JOIN users u ON ur.user_id = u.user_id
            WHERE ur.user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().fetchone()
    return result["role_name"]


def register_user(db, info):
    result = db.execute(
        text(
            """
            INSERT INTO users (user_id, password_hash, email, name, birthday, phone, eco_state, gender)
            VALUES (:user_id, :password_hash, :email, :name, :birthday, :phone, :eco_state, :gender)
            """
        ),
        info,
    )
    if result.rowcount:
        db.execute(
            text("INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, '1')"),
            {"user_id": info["user_id"]},
        )


def login_check(db, info):
    return db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM users
                WHERE user_id = :user_id
                  AND password_hash = :password_hash
            ) AS is_valid
            """
        ),
        {"user_id": info["user_id"], "password_hash": info["password_hash"]},
    ).mappings().fetchone()


def user_exists(db, user_id):
    result = db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM users
                WHERE user_id = :user_id
            ) AS is_exist
            """
        ),
        {"user_id": user_id},
    ).mappings().fetchone()
    return result["is_exist"]


def find_user_id(db, name, email):
    return db.execute(
        text("SELECT user_id FROM users WHERE name = :name AND email = :email"),
        {"name": name, "email": email},
    ).mappings().fetchone()


def find_user_pw(db, user_id, name, email):
    return db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM users
                WHERE user_id = :user_id AND name = :name AND email = :email
            ) AS is_valid
            """
        ),
        {"user_id": user_id, "name": name, "email": email},
    ).mappings().fetchone()["is_valid"]


def change_user_pw(db, user_id, new_pw):
    result = db.execute(
        text(
            """
            UPDATE users
            SET password_hash = :password_hash
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id, "password_hash": new_pw},
    )
    return result.rowcount


def check_user_pw(db, user_id, pw):
    result = db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM users
                WHERE user_id = :user_id
                  AND password_hash = :password_hash
            ) AS is_valid
            """
        ),
        {"user_id": user_id, "password_hash": pw},
    ).mappings().fetchone()
    return result["is_valid"]


def get_user_info(db, user_id):
    return db.execute(
        text(
            """
            SELECT name, gender, birthday, phone, email, eco_state
            FROM users
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().fetchone()


def update_user_info(db, info):
    result = db.execute(
        text(
            """
            UPDATE users
            SET password_hash = :password_hash,
                email = :email,
                name = :name,
                birthday = :birthday,
                phone = :phone,
                eco_state = :eco_state,
                gender = :gender
            WHERE user_id = :user_id
            """
        ),
        info,
    )
    return result.rowcount
