-- LOCAL TEST ONLY. Added to a live-shaped source older than 0164 (backend/tests/datamove/run-live.php): the cases whose
-- meaning changed in 0157-0164 and that production, at 0156, can hold. Live had none of these on 1 Nov 2026 (0 emergency
-- contacts, 0 documents, 0 data-protection requests); the rehearsal proves the move would do the safe thing if it did.
--   * emergency contacts with medical notes (0164 purges the column): never moved;
--   * an erasure case closed before 0162, whose login therefore stayed: the person becomes unlinkable (0162's rule);
--     the same for an owner, which 0162 would have refused to close, reported; a person who signed up again with the
--     same address after the case closed is left alone;
--   * a document that is a pasted link (before 0159 there was no private store): moved as the link it is;
--   * an object in a Storage bucket of its own (before 0159 nothing points at stored files): counted, not copied.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
SET TIME ZONE 'UTC';
CREATE FUNCTION pg_temp.u(kind int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT (lpad(to_hex(kind), 8, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

INSERT INTO public.emergency_contacts (id, org_id, staff_profile_id, name, relationship, phone, secondary_phone, medical_notes, created_at, updated_at) VALUES
  (pg_temp.u(12, 1), pg_temp.u(2, 1), pg_temp.u(10, 2), 'Pat Two', 'Partner', '+44 7700 900111', NULL, 'Asthma; inhaler in the blue bag', now(), now()),
  (pg_temp.u(12, 2), pg_temp.u(2, 1), pg_temp.u(10, 3), 'Lee Three', NULL, '+44 7700 900112', NULL, 'Epilepsy', now(), now()),
  (pg_temp.u(12, 3), pg_temp.u(2, 1), pg_temp.u(10, 4), 'Kim Four', 'Parent', '+44 7700 900113', '+44 20 7946 0001', '   ', now(), now());

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at) VALUES
  (pg_temp.u(1, 3), 'authenticated', 'authenticated', 'erased-at-0156@live-shape.test', '2026-08-05+00', '2026-08-05+00', '2026-08-05+00'),
  (pg_temp.u(1, 4), 'authenticated', 'authenticated', 'second-owner@live-shape.test', '2026-08-06+00', '2026-08-06+00', '2026-08-06+00'),
  (pg_temp.u(1, 5), 'authenticated', 'authenticated', 'came-back@live-shape.test', '2026-10-01+00', '2026-10-01+00', '2026-10-01+00');
INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
SELECT id, email, initcap(split_part(email, '@', 1)), created_at, updated_at FROM auth.users WHERE id IN (pg_temp.u(1, 3), pg_temp.u(1, 4), pg_temp.u(1, 5));
INSERT INTO public.memberships (id, org_id, user_id, role, status, created_at, updated_at) VALUES
  (pg_temp.u(3, 3), pg_temp.u(2, 1), pg_temp.u(1, 3), 'staff', 'active', now(), now()),
  (pg_temp.u(3, 4), pg_temp.u(2, 1), pg_temp.u(1, 4), 'owner', 'active', now(), now()),
  (pg_temp.u(3, 5), pg_temp.u(2, 1), pg_temp.u(1, 5), 'staff', 'active', now(), now());
INSERT INTO public.gdpr_requests (id, org_id, subject_email, subject_name, kind, status, received_on, due_on, closed_at, outcome_note, created_at, updated_at) VALUES
  (pg_temp.u(42, 1), pg_temp.u(2, 1), 'erased-at-0156@live-shape.test', 'Erased', 'erasure', 'completed', '2026-09-01', '2026-10-01', '2026-09-10+00', 'Erased', now(), now()),
  (pg_temp.u(42, 2), pg_temp.u(2, 1), 'second-owner@live-shape.test', 'Owner Two', 'erasure', 'completed', '2026-09-01', '2026-10-01', '2026-09-11+00', 'Erased', now(), now()),
  (pg_temp.u(42, 3), NULL, 'came-back@live-shape.test', 'Came Back', 'erasure', 'completed', '2026-08-01', '2026-09-01', '2026-08-20+00', 'Erased; signed up again later', now(), now()),
  (pg_temp.u(42, 4), NULL, 'owner@live-shape.test', NULL, 'access', 'received', '2026-10-20', '2026-11-20', NULL, NULL, now(), now());

INSERT INTO public.documents (id, org_id, staff_profile_id, type, name, file_url, issued_at, expires_at, created_at, updated_at) VALUES
  (pg_temp.u(29, 1), pg_temp.u(2, 1), pg_temp.u(10, 5), 'DBS', 'DBS certificate', 'https://docs.example.com/dbs-scan.pdf', '2026-01-01', '2029-01-01', now(), now());
INSERT INTO storage.buckets (id, name, public) VALUES ('legacy-files', 'legacy-files', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name, metadata, created_at) VALUES ('legacy-files', 'scan.pdf', '{"mimetype":"application/pdf","size":10}', now());

SET session_replication_role = DEFAULT;
