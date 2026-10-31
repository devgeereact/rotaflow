-- 019 two-way swaps (R2 slice S12d, owner decision 31 Oct 2026): a swap may ask for one of the colleague's shifts in return.
-- Additive: two nullable columns on shift_swaps, an index and a same-organisation foreign key. An ordinary (one-way) swap leaves them NULL,
-- so every existing row and screen is unchanged. take_fingerprint is the S12 shift fingerprint of the shift asked for, recorded when the
-- swap is raised and never returned. The feature ships dark behind its own flag (and needs cover_tools on as well): while either is off a
-- swap cannot ask for a shift in return and the options route answers 403 feature_off.
ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS take_shift_id CHAR(36) NULL AFTER shift_id;
ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS take_fingerprint CHAR(64) CHARACTER SET ascii NULL AFTER shift_fingerprint;
ALTER TABLE shift_swaps ADD INDEX IF NOT EXISTS shift_swaps_take (org_id, take_shift_id);
ALTER TABLE shift_swaps ADD CONSTRAINT shift_swaps_take_shift FOREIGN KEY IF NOT EXISTS (org_id, take_shift_id) REFERENCES shifts (org_id, id) ON DELETE CASCADE;

INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('two_way_swaps', 'Two-way swaps', 'A swap may ask for one of the colleague''s shifts in return; approving moves both shifts in one transaction, with eligibility checked both ways and the swap cancelled if either shift changes or starts. Needs cover_tools on as well. Off until the platform turns it on.', 0, 0, 0, JSON_ARRAY());
