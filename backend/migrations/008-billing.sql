-- 008 billing: the price list, an organisation's subscription, invoices, and the Stripe event ledger. Stripe stays in TEST mode
-- until the owner switches it (private config stripe.mode); a subscription row records which mode created it and the two never mix.
-- Also adds the organisation columns the earlier slices left out (contact details, time zone, suspension reason).
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS industry         VARCHAR(100) NULL;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS country          VARCHAR(100) NOT NULL DEFAULT 'United Kingdom';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS timezone         VARCHAR(64)  NOT NULL DEFAULT 'Europe/London';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_email    VARCHAR(255) NULL;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_phone    VARCHAR(40)  NULL;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(500) NULL;

CREATE TABLE IF NOT EXISTS plans (
  code                 ENUM('starter','professional','business','enterprise') NOT NULL,
  name                 VARCHAR(80)  NOT NULL,
  monthly_price_pence  INT UNSIGNED NOT NULL,
  currency             CHAR(3)      NOT NULL DEFAULT 'GBP',
  seat_limit           INT UNSIGNED NULL,
  location_limit       INT UNSIGNED NULL,
  description          VARCHAR(300) NOT NULL DEFAULT '',
  sort_order           INT          NOT NULL DEFAULT 0,
  features             JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  stripe_price_id      VARCHAR(100) NULL,
  stripe_test_price_id VARCHAR(100) NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  CONSTRAINT plans_features_json CHECK (JSON_VALID(features))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A null limit means unlimited. features are the entitlements a plan really gates (gps_clock_in is part of every plan, so it is not one).
INSERT IGNORE INTO plans (code, name, monthly_price_pence, seat_limit, location_limit, description, sort_order, features) VALUES
  ('starter',      'Starter',       2900,   15,    1, 'One site, up to 15 staff.',                             1, JSON_ARRAY()),
  ('professional', 'Professional', 12900,   60,    5, 'Up to five sites and 60 staff.',                        2, JSON_ARRAY('advanced_reporting')),
  ('business',     'Business',     29900,  200,   20, 'Up to twenty sites and 200 staff.',                     3, JSON_ARRAY('advanced_reporting', 'ai_rota_assistant')),
  ('enterprise',   'Enterprise',   79000, NULL, NULL, 'Unlimited sites and staff, with hands-on onboarding.',  4, JSON_ARRAY('advanced_reporting', 'ai_rota_assistant'));

-- One subscription per organisation. grace_until runs 14 days from the first failed payment (set by Billing::setStatus).
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 CHAR(36)     NOT NULL,
  org_id             CHAR(36)     NOT NULL,
  plan               ENUM('starter','professional','business','enterprise') NOT NULL DEFAULT 'starter',
  status             ENUM('trialing','active','past_due','canceled') NOT NULL DEFAULT 'trialing',
  provider           VARCHAR(20)  NULL,
  provider_ref       VARCHAR(100) NULL,
  stripe_customer_id VARCHAR(100) NULL,
  stripe_mode        ENUM('test','live') NOT NULL DEFAULT 'live',
  price_pence        INT UNSIGNED NULL,
  currency           CHAR(3)      NOT NULL DEFAULT 'GBP',
  started_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end DATETIME     NULL,
  trial_ends_at      DATETIME     NULL,
  canceled_at        DATETIME     NULL,
  past_due_since     DATETIME     NULL,
  grace_until        DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY subscriptions_org (org_id),
  KEY subscriptions_ref (provider_ref),
  CONSTRAINT subscriptions_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id                 CHAR(36)     NOT NULL,
  org_id             CHAR(36)     NOT NULL,
  number             VARCHAR(100) NOT NULL,
  period_start       DATE         NOT NULL,
  period_end         DATE         NOT NULL,
  amount_pence       INT UNSIGNED NOT NULL,
  tax_pence          INT UNSIGNED NOT NULL DEFAULT 0,
  currency           CHAR(3)      NOT NULL DEFAULT 'GBP',
  status             ENUM('draft','open','paid','past_due','refunded','void') NOT NULL DEFAULT 'open',
  issued_on          DATE         NOT NULL,
  due_on             DATE         NOT NULL,
  paid_at            DATETIME     NULL,
  refunded_at        DATETIME     NULL,
  failure_reason     VARCHAR(500) NULL,
  attempts           INT UNSIGNED NOT NULL DEFAULT 0,
  provider           VARCHAR(20)  NULL,
  provider_ref       VARCHAR(100) NULL,
  hosted_invoice_url VARCHAR(2048) NULL,
  invoice_pdf        VARCHAR(2048) NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY invoices_number (number),
  UNIQUE KEY invoices_org_id (org_id, id),
  KEY invoices_org (org_id, issued_on),
  KEY invoices_ref (provider, provider_ref),
  CONSTRAINT invoices_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT invoices_period CHECK (period_end >= period_start),
  CONSTRAINT invoices_due CHECK (due_on >= issued_on),
  CONSTRAINT invoices_paid_time CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT invoices_refunded_time CHECK (status <> 'refunded' OR refunded_at IS NOT NULL),
  CONSTRAINT invoices_docs_are_stripe CHECK (
    (hosted_invoice_url IS NULL OR hosted_invoice_url REGEXP '^https://(invoice|pay)\\.stripe\\.com/[^[:space:]]*$')
    AND (invoice_pdf IS NULL OR invoice_pdf REGEXP '^https://(invoice|pay)\\.stripe\\.com/[^[:space:]]*$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per Stripe event, per mode: the ledger that makes a webhook idempotent. processed_at NULL means "not yet done" and a redelivery re-runs it.
CREATE TABLE IF NOT EXISTS billing_events (
  id               CHAR(36)     NOT NULL,
  provider         VARCHAR(20)  NOT NULL DEFAULT 'stripe',
  mode             ENUM('test','live') NOT NULL,
  event_id         VARCHAR(100) NOT NULL,
  event_type       VARCHAR(100) NOT NULL,
  org_id           CHAR(36)     NULL,
  event_created_at DATETIME     NULL,
  received_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at     DATETIME     NULL,
  deliveries       INT UNSIGNED NOT NULL DEFAULT 1,
  last_error       VARCHAR(2000) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY billing_events_identity (provider, mode, event_id),
  KEY billing_events_org (org_id),
  CONSTRAINT billing_events_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
