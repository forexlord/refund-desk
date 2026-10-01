-- Refund Desk schema
-- Mock CRM (customers, orders, order_items, prior refunds) + refund workflow tables.

CREATE TABLE customers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  tier            TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'gold', 'platinum')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set by the risk team. A flagged account is never auto-approved.
  risk_flag       BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT
);

-- Credentials are kept out of CRM/customer data and are never returned by CRM queries.
-- password_changed_at doubles as the session epoch: sessions issued before it are rejected.
CREATE TABLE customer_accounts (
  customer_id         TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  password_hash       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_customers_email_ci ON customers (LOWER(email));

-- Support agents who review escalated requests. Resolutions reference agents.id, never a typed name.
CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agents_email_ci ON agents (LOWER(email));

CREATE TABLE agent_accounts (
  agent_id            TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  password_hash       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DEMO ONLY: plaintext passwords of the synthetic seeded accounts, so the sign-in pickers can fill them.
-- Written by provisioning, never read for authentication, served only when DEMO_ACCOUNTS=true, and deleted
-- as soon as the account's password is changed or reset. A real deployment leaves this table empty.
CREATE TABLE demo_credentials (
  customer_id  TEXT UNIQUE REFERENCES customer_accounts(customer_id) ON DELETE CASCADE,
  agent_id     TEXT UNIQUE REFERENCES agent_accounts(agent_id) ON DELETE CASCADE,
  password     TEXT NOT NULL,
  CONSTRAINT ck_demo_credentials_one_account CHECK ((customer_id IS NULL) <> (agent_id IS NULL))
);

-- Single-use password reset tokens. Only a SHA-256 of the emailed token is stored.
CREATE TABLE password_resets (
  token_hash   BYTEA PRIMARY KEY,
  customer_id  TEXT REFERENCES customer_accounts(customer_id) ON DELETE CASCADE,
  agent_id     TEXT REFERENCES agent_accounts(agent_id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_password_resets_one_account CHECK ((customer_id IS NULL) <> (agent_id IS NULL))
);

CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customers(id),
  placed_at           TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('processing', 'shipped', 'delivered', 'cancelled')),
  expected_delivery   TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  signature_on_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  total               NUMERIC(10,2) NOT NULL,
  CONSTRAINT uq_orders_id_customer UNIQUE (id, customer_id)
);

CREATE TABLE order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  final_sale  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Refunds recorded by the CRM before Refund Desk existed. Refund Desk's own refunds are approved rows in
  -- refund_request_items; an item counts as refunded if either says so.
  legacy_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_order_items_id_order UNIQUE (id, order_id)
);

-- Refunds already issued before this system existed (history for abuse detection).
CREATE TABLE past_refunds (
  id           SERIAL PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  order_id     TEXT NOT NULL REFERENCES orders(id),
  amount       NUMERIC(10,2) NOT NULL,
  reason       TEXT NOT NULL,
  refunded_at  TIMESTAMPTZ NOT NULL
);

-- Every refund request submitted through the system.
CREATE TABLE refund_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        TEXT NOT NULL,
  order_id           TEXT NOT NULL,
  customer_message   TEXT NOT NULL,
  decision           TEXT NOT NULL CHECK (decision IN ('APPROVED', 'DENIED', 'ESCALATED')),
  -- Where the request currently stands. Escalations stay 'pending_review' until an agent resolves them.
  status             TEXT NOT NULL CHECK (status IN ('closed', 'pending_review', 'resolved_approved', 'resolved_denied')),
  -- Derived from refund_request_items in the same transaction: approved total, or the amount at stake while
  -- pending review, or 0 when denied.
  refund_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason_category    TEXT,
  customer_reply     TEXT NOT NULL,
  -- Structured AI output, rule evaluations and guard results, kept for auditing.
  ai_assessment      JSONB,
  rule_results       JSONB NOT NULL DEFAULT '[]',
  security_flags     JSONB NOT NULL DEFAULT '[]',
  ai_mode            TEXT NOT NULL CHECK (ai_mode IN ('llm', 'fallback')),
  ai_model           TEXT,
  policy_version     TEXT NOT NULL,
  latency_ms         INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ,
  resolved_by_agent_id TEXT REFERENCES agents(id),
  resolution_note    TEXT,
  CONSTRAINT ck_refund_requests_nonnegative_amount CHECK (refund_amount >= 0),
  CONSTRAINT uq_refund_requests_id_order UNIQUE (id, order_id),
  CONSTRAINT fk_refund_requests_order_customer FOREIGN KEY (order_id, customer_id)
    REFERENCES orders (id, customer_id),
  CONSTRAINT ck_refund_requests_state CHECK (
    (status = 'pending_review' AND decision = 'ESCALATED') OR
    (status = 'closed' AND decision IN ('APPROVED', 'DENIED')) OR
    (status IN ('resolved_approved', 'resolved_denied') AND decision = 'ESCALATED')
  ),
  CONSTRAINT ck_refund_requests_resolution CHECK (
    (status IN ('pending_review', 'closed') AND resolved_at IS NULL AND resolved_by_agent_id IS NULL) OR
    (status IN ('resolved_approved', 'resolved_denied') AND resolved_at IS NOT NULL AND resolved_by_agent_id IS NOT NULL)
  )
);

-- The items a request is about. `amount` is the line value (unit_price * quantity) when linked; `approved`
-- marks the items actually refunded. The composite foreign keys make the request and the item belong to the
-- same order.
CREATE TABLE refund_request_items (
  refund_request_id UUID NOT NULL,
  order_id          TEXT NOT NULL,
  order_item_id     TEXT NOT NULL,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  approved          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (refund_request_id, order_item_id),
  CONSTRAINT fk_refund_request_items_request_order FOREIGN KEY (refund_request_id, order_id)
    REFERENCES refund_requests (id, order_id) ON DELETE CASCADE,
  CONSTRAINT fk_refund_request_items_item_order FOREIGN KEY (order_item_id, order_id)
    REFERENCES order_items (id, order_id)
);

-- An item can be refunded at most once across all requests. Enforced by the database, so two concurrent
-- approvals can't both succeed even if application checks race.
CREATE UNIQUE INDEX ux_refund_request_items_one_approval ON refund_request_items (order_item_id) WHERE approved;

-- Keyset pagination: (created_at, id) is the page order for every list.
CREATE INDEX idx_refund_requests_created ON refund_requests (created_at, id);
CREATE INDEX idx_refund_requests_status_created ON refund_requests (status, created_at, id);
CREATE INDEX idx_refund_requests_customer_order_created ON refund_requests (customer_id, order_id, created_at, id);
CREATE INDEX idx_refund_requests_order ON refund_requests (order_id);

-- Append-only audit trail for every step of every request.
CREATE TABLE audit_events (
  id           BIGSERIAL PRIMARY KEY,
  request_id   UUID NOT NULL REFERENCES refund_requests(id),
  event_type   TEXT NOT NULL,
  actor        TEXT NOT NULL,
  detail       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_request ON audit_events (request_id, id);
