-- LOCAL TEST ONLY. Gives six synthetic source people the Clerk DEVELOPMENT test-mode addresses the local-live walk signs in
-- with (scripts/walk.sh; code 424242), so the walk can run against data that came through the data move instead of
-- seed-demo.php (scripts/datamove-test.sh walk-db). Owner and manager of Acme, two staff, the platform owner, no organisation.
SET session_replication_role = replica;
CREATE TEMP TABLE walk_ids (n int, email text);
INSERT INTO walk_ids VALUES (1, 'owner+clerk_test@example.com'), (2, 'manager+clerk_test@example.com'), (20, 'staff+clerk_test@example.com'),
  (22, 'staff2+clerk_test@example.com'), (50, 'admin+clerk_test@example.com'), (49, 'noorg+clerk_test@example.com');
UPDATE auth.users u SET email = w.email FROM walk_ids w WHERE u.id = (lpad(to_hex(1), 8, '0') || '-0000-4000-8000-' || lpad(w.n::text, 12, '0'))::uuid;
UPDATE public.profiles p SET email = w.email FROM walk_ids w WHERE p.id = (lpad(to_hex(1), 8, '0') || '-0000-4000-8000-' || lpad(w.n::text, 12, '0'))::uuid;
UPDATE public.staff_profiles s SET email = w.email FROM walk_ids w WHERE s.user_id = (lpad(to_hex(1), 8, '0') || '-0000-4000-8000-' || lpad(w.n::text, 12, '0'))::uuid;
-- The synthetic photo and avatar addresses do not resolve; the walk fails any screen with a failed request, so they go.
UPDATE public.staff_profiles SET photo_url = NULL WHERE photo_url LIKE 'https://images.example/%';
UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url IS NOT NULL;
-- No Storage files are copied for the walk (the files step has its own test), so no photo may point at one.
UPDATE public.staff_profiles SET photo_path = NULL WHERE photo_path IS NOT NULL;
SET session_replication_role = DEFAULT;
