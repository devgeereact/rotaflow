-- 014 platform announcements (the platform telling organisations something) and invoice credits (the billing ledger's corrections).
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md. A delivery is one row per organisation, never per person; the people are addressed through the
-- ordinary notification outbox, so every rule about channels, mutes and retries applies.

CREATE TABLE IF NOT EXISTS platform_announcements (
  id             CHAR(36)     NOT NULL,
  title          VARCHAR(200) NOT NULL,
  body           TEXT         NOT NULL,
  kind           ENUM('maintenance','incident','product','billing','policy') NOT NULL DEFAULT 'product',
  audience       ENUM('all','plans') NOT NULL DEFAULT 'all',
  audience_plans JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  status         ENUM('draft','scheduled','sent','cancelled') NOT NULL DEFAULT 'draft',
  scheduled_for  DATETIME     NULL,
  sent_at        DATETIME     NULL,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY platform_announcements_due (status, scheduled_for),
  CONSTRAINT platform_announcements_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT platform_announcements_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT platform_announcements_body CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  CONSTRAINT platform_announcements_plans CHECK (JSON_VALID(audience_plans) AND (audience <> 'plans' OR JSON_LENGTH(audience_plans) > 0)),
  CONSTRAINT platform_announcements_scheduled CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL),
  CONSTRAINT platform_announcements_sent CHECK (status <> 'sent' OR sent_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_announcement_deliveries (
  id              CHAR(36)     NOT NULL,
  announcement_id CHAR(36)     NOT NULL,
  org_id          CHAR(36)     NOT NULL,
  outbox_id       CHAR(36)     NULL,
  sent_at         DATETIME     NULL,
  failed_at       DATETIME     NULL,
  failure_reason  VARCHAR(500) NULL,
  read_at         DATETIME     NULL,
  read_by         CHAR(36)     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY platform_deliveries_once (announcement_id, org_id),
  KEY platform_deliveries_org (org_id, created_at),
  KEY platform_deliveries_outbox (outbox_id),
  CONSTRAINT platform_deliveries_announcement FOREIGN KEY (announcement_id) REFERENCES platform_announcements (id) ON DELETE CASCADE,
  CONSTRAINT platform_deliveries_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT platform_deliveries_outbox FOREIGN KEY (outbox_id) REFERENCES notification_outbox (id) ON DELETE SET NULL,
  CONSTRAINT platform_deliveries_reader FOREIGN KEY (read_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An organisation that does not want product, billing and policy announcements. Maintenance and incident notices ignore this.
CREATE TABLE IF NOT EXISTS platform_announcement_optouts (
  org_id       CHAR(36) NOT NULL,
  opted_out_by CHAR(36) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id),
  CONSTRAINT platform_optouts_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT platform_optouts_by FOREIGN KEY (opted_out_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A credit is a record against an invoice, in the invoice's own currency; it changes nothing else (no refund is made, no status moves).
CREATE TABLE IF NOT EXISTS invoice_credits (
  id              CHAR(36)     NOT NULL,
  invoice_id      CHAR(36)     NOT NULL,
  org_id          CHAR(36)     NOT NULL,
  amount_pence    INT UNSIGNED NOT NULL,
  currency        CHAR(3)      NOT NULL,
  reason          VARCHAR(1000) NOT NULL,
  idempotency_key VARCHAR(100) NULL,
  created_by      CHAR(36)     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY invoice_credits_once (invoice_id, idempotency_key),
  KEY invoice_credits_org (org_id),
  CONSTRAINT invoice_credits_invoice FOREIGN KEY (org_id, invoice_id) REFERENCES invoices (org_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_credits_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT invoice_credits_amount CHECK (amount_pence > 0),
  CONSTRAINT invoice_credits_currency CHECK (currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT invoice_credits_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
