-- Rooted Predictions — Admin Roles, Usernames & Audit Log
-- Run ONCE against your database. Safe to inspect before running.

-- 1. Add username + admin_role to users
ALTER TABLE users
  ADD COLUMN username   VARCHAR(50)  NULL                                        AFTER name,
  ADD COLUMN admin_role ENUM('superadmin','editor','viewer') NULL DEFAULT NULL   AFTER role;

CREATE UNIQUE INDEX idx_users_username ON users (username);

-- 2. Add created_by / updated_by to predictions
ALTER TABLE predictions
  ADD COLUMN created_by INT NULL AFTER updated_at,
  ADD COLUMN updated_by INT NULL AFTER created_by;

-- 3. Audit log table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id     INT          NOT NULL,
  admin_name   VARCHAR(100) NOT NULL,
  admin_role   VARCHAR(20)  NOT NULL DEFAULT 'superadmin',
  action       VARCHAR(30)  NOT NULL,       -- create | update | delete | password_change | login
  entity_type  VARCHAR(50)  NULL,           -- prediction | blog_post | user | admin_account
  entity_id    INT          NULL,
  entity_label VARCHAR(255) NULL,           -- human-readable e.g. "Arsenal vs Chelsea (2026-06-15)"
  details      JSON         NULL,           -- snapshot of submitted payload
  ip_address   VARCHAR(45)  NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin    (admin_id),
  INDEX idx_created  (created_at DESC),
  INDEX idx_entity   (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
