-- trendscope DB 스키마 초기화
-- 실행: mysql -u web_user -ppass trendscope < docs/schema_init.sql

SET NAMES utf8mb4;

-- ───────────────────────────────────────────────
-- roles
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    role_id   INT          NOT NULL AUTO_INCREMENT,
    role_name VARCHAR(50)  NOT NULL,
    PRIMARY KEY (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO roles (role_id, role_name) VALUES
    (1, 'user'),
    (2, 'admin');

-- ───────────────────────────────────────────────
-- users
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    user_id       VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email         VARCHAR(100) NOT NULL,
    name          VARCHAR(50)  NOT NULL,
    birthday      DATE         NULL,
    phone         VARCHAR(20)  NULL,
    eco_state     VARCHAR(20)  NULL,
    gender        VARCHAR(10)  NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- user_roles
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(50) NOT NULL,
    role_id INT         NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- login_log
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_log (
    log_id    BIGINT      NOT NULL AUTO_INCREMENT,
    user_id   VARCHAR(50) NOT NULL,
    result    VARCHAR(10) NOT NULL COMMENT 'SUCCESS | FAIL',
    create_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    INDEX idx_login_log_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- economic_terms
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS economic_terms (
    term_id     VARCHAR(100) NOT NULL,
    term        VARCHAR(200) NOT NULL,
    description TEXT         NULL,
    state       VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE | DISABLED',
    event_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (term_id),
    INDEX idx_economic_terms_term (term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- user_term_bookmarks
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_term_bookmarks (
    user_id  VARCHAR(50)  NOT NULL,
    term_id  VARCHAR(100) NOT NULL,
    state    VARCHAR(10)  NOT NULL DEFAULT 'ADD' COMMENT 'ADD | CANCEL',
    event_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, term_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (term_id) REFERENCES economic_terms(term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- batch_runs
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_runs (
    run_id     BIGINT       NOT NULL AUTO_INCREMENT,
    job_name   VARCHAR(100) NOT NULL,
    work_at    DATE         NOT NULL,
    start_at   DATETIME     NULL,
    end_at     DATETIME     NULL,
    state_code INT          NOT NULL DEFAULT 0 COMMENT '100:시작 200:성공 300:실패',
    message    TEXT         NULL,
    PRIMARY KEY (run_id),
    INDEX idx_batch_runs_work_at (work_at),
    INDEX idx_batch_runs_state_code (state_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────────────────────────────
-- analysis_task
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_task (
    job_id    VARCHAR(100) NOT NULL,
    status    VARCHAR(20)  NOT NULL DEFAULT 'pending',
    progress  INT          NOT NULL DEFAULT 0,
    work_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
