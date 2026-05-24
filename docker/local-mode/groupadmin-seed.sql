-- Local-mode admin seed for gemma-rest auth.
--
-- Runs AFTER gemma-rest has booted and Flyway has applied all migrations
-- against a fresh ``gemd`` schema. Creates the three baseline user
-- groups (Administrators / Users / Agent) and a single ``groupadmin``
-- user bound to Administrators with HTTP-Basic-resolvable password
-- ``groupadmin``.
--
-- Bcrypt hash below is for the literal password ``groupadmin`` (10
-- rounds). Regenerate with:
--   python3 -c "import bcrypt; print('{bcrypt}'+bcrypt.hashpw(b'<pw>', bcrypt.gensalt(rounds=10)).decode())"
--
-- All statements are idempotent (INSERT IGNORE) so reruns are no-ops.
-- The init container in docker-compose.yml polls for Flyway completion
-- before invoking this script.

-- Baseline groups (id values match Gemma's H2 V3 seed for consistency).
INSERT IGNORE INTO AUDIT_TRAIL (ID) VALUES (1), (2), (3);

INSERT IGNORE INTO USER_GROUP (ID, AUDIT_TRAIL_FK, NAME, DESCRIPTION) VALUES
  (1, 1, 'Administrators', 'System administrators'),
  (2, 2, 'Users',          'Regular users'),
  (3, 3, 'Agent',          'Programmatic agents');

INSERT IGNORE INTO GROUP_AUTHORITY (ID, GROUP_FK, AUTHORITY) VALUES
  (1, 1, 'ADMIN'),
  (2, 2, 'USER'),
  (3, 3, 'AGENT');

-- The groupadmin user. Bcrypt of 'groupadmin' (10 rounds).
INSERT IGNORE INTO CONTACT (class, USER_NAME, PASSWORD, ENABLED, NAME) VALUES (
  'User',
  'groupadmin',
  '{bcrypt}$2b$10$N.xjqpmHQG5aVTE53Bl5/Oaw4jib0X2ke4NViAsaWEI1dT05HnxFS',
  1,
  'Local-mode admin'
);

-- Bind groupadmin to the Administrators group. Use a SELECT so we
-- don't depend on auto-increment having yielded a specific CONTACT.ID.
INSERT IGNORE INTO GROUP_MEMBERS (USER_GROUPS_FK, GROUP_MEMBERS_FK)
SELECT 1, c.ID FROM CONTACT c WHERE c.USER_NAME = 'groupadmin';
