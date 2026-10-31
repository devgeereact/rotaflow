<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, ComplianceRules as R, Ctx, Db, FileStore, Flags, HttpError, Module, Notify, Scope, Str};

/**
 * Compliance (R2 slice S10, ported from SiteRelay's Compliance module): document types, staff documents and their review, the eligibility
 * service S12 consumes, and the expiry reminders.
 *
 * Rules:
 *  - An upload never counts until an owner or manager approves it. 'expired' is computed in the organisation's timezone: a document is
 *    valid up to and including its expiry date (R::status).
 *  - Four eyes: nobody reviews a document about themself (owners included), and a manager who uploaded a document for someone else cannot
 *    approve it; an owner can.
 *  - Replacing a document adds a row. When the new one is approved, earlier approved rows of that type become 'superseded'.
 *  - Files and details are visible only to the person and to owners and managers (delegates included). A platform support session gets
 *    nothing here: Super Admin has no role in compliance.
 *  - A document belongs to a staff record. "The person" is the login linked to that record.
 */
final class Compliance implements Module
{
    public const FLAG = 'staff_documents';
    public const MAX_BYTES = 10485760;
    private const LINK_SECONDS = 60;
    private const TYPE_LIMIT = 100;

    /**
     * UK examples, not legal advice. [name, description, requires_expiry, default_validity_months, required]
     * @var array<string, array{0:string,1:string,2:bool,3:?int,4:bool}>
     */
    public const PRESETS = [
        'right_to_work' => ['Right to work check', 'Evidence that the person may work in the UK, for example a Home Office online check (share code) or an eligible passport. Time-limited permission has an end date.', false, null, true],
        'dbs' => ['DBS check', 'Disclosure and Barring Service certificate at the level the role needs (basic, standard or enhanced, with or without a barred list check). Certificates have no fixed expiry, so many employers re-check periodically or use the Update Service.', false, null, true],
        'care_certificate' => ['Care Certificate', 'The agreed standards for new health and social care workers in England. Record the date it was completed.', false, null, false],
        'safeguarding' => ['Safeguarding training', 'Safeguarding adults (and children, where the role needs it) at the level the role needs.', false, 12, false],
        'moving_handling' => ['Moving and handling training', 'Training on moving people and loads safely.', false, 12, false],
        'first_aid' => ['First aid at work', 'First aid certificate. Record the expiry date shown on the certificate.', true, 36, false],
        'food_hygiene' => ['Food hygiene certificate', 'Food safety and hygiene training for anyone who prepares or serves food.', false, 36, false],
        'medication' => ['Medication training', 'Training and competency check for administering medicines.', false, 12, false],
    ];

    private readonly \PDO $pdo;

    public function __construct(private readonly Ctx $ctx)
    {
        $this->pdo = $ctx->pdo;
    }

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/document-types', $this->listTypes(...)],
            ['POST', '/orgs/{o}/document-types', $this->createType(...)],
            ['POST', '/orgs/{o}/document-types/presets', $this->addPreset(...)],
            ['POST', '/orgs/{o}/document-types/{t}/update', $this->updateType(...)],
            ['POST', '/orgs/{o}/document-types/{t}/archive', $this->archiveType(...)],
            ['GET', '/orgs/{o}/documents', $this->listDocuments(...)],
            ['POST', '/orgs/{o}/documents', $this->createDocument(...), '', '', 'upload-document'],
            ['GET', '/orgs/{o}/documents/queue', $this->queue(...)],
            ['POST', '/orgs/{o}/documents/{d}/submit', $this->submit(...)],
            ['POST', '/orgs/{o}/documents/{d}/review', $this->review(...)],
            ['POST', '/orgs/{o}/documents/{d}/withdraw', $this->withdraw(...)],
            ['GET', '/orgs/{o}/documents/{d}/link', $this->link(...)],
            ['GET', '/orgs/{o}/compliance/me', $this->mine(...)],
            ['GET', '/orgs/{o}/compliance/summary', $this->summary(...)],
            ['GET', '/document-files', $this->serve(...), 'public'],
        ];
    }

    // ---- access ---------------------------------------------------------------------------------------------------------------------------

    /**
     * Every organisation route here comes through this. A stranger gets 404 (membership), a support session 403 forbidden, and while the
     * `staff_documents` flag is off for the organisation everyone gets 403 feature_off: the slice is dark on the server, not only on screen.
     * The one exception is the plain read of documents (`GET documents`, $whileOff): it is what the documents table answered before S10,
     * and the rota builder, the staff list and the rota assistant read it for their expiring-document warnings with the flag off.
     * @return array<string,mixed> the membership
     */
    private function member(array $u, string $o, bool $whileOff = false): array
    {
        $m = Scope::membership($this->pdo, $u['id'], $o);
        if (($m['support'] ?? null) !== null) {
            throw HttpError::forbidden('Platform support has no access to staff documents');
        }
        if (!$whileOff && !Flags::enabledForOrg($this->pdo, self::FLAG, $o)) {
            throw new HttpError(403, 'feature_off', 'Staff documents are not switched on for this organisation yet.');
        }
        return $m;
    }

    private static function manages(array $m): bool
    {
        return in_array($m['effective_role'], Scope::MANAGERS, true);
    }

    private function requireManager(array $u, string $o): array
    {
        $m = $this->member($u, $o);
        if (!self::manages($m)) {
            throw HttpError::forbidden();
        }
        return $m;
    }

    // ---- eligibility (an internal service; S12 cover consumes it) -------------------------------------------------------------------------

    /** The organisation's timezone, or Europe/London if it is missing or not a real zone. */
    public static function tz(\PDO $pdo, string $o): string
    {
        $q = $pdo->prepare('SELECT timezone FROM organisations WHERE id = ?');
        $q->execute([$o]);
        $tz = $q->fetchColumn();
        return is_string($tz) && in_array($tz, \DateTimeZone::listIdentifiers(), true) ? $tz : 'Europe/London';
    }

    /**
     * Is this staff record cleared to work at this instant? Every active type marked required must be met by an APPROVED document that has
     * not expired on the organisation-local date of $atUtc. A row moved from before types existed counts when its free-text type is the
     * type's name. Unknown or inactive record, or bad input: ok=false with no names.
     * @return array{ok:bool, missing:list<string>}
     */
    public static function eligible(\PDO $pdo, string $o, string $staffProfileId, string $atUtc): array
    {
        $uuid = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';
        if (preg_match($uuid, $o) !== 1 || preg_match($uuid, $staffProfileId) !== 1) {
            return ['ok' => false, 'missing' => []];
        }
        $q = $pdo->prepare('SELECT 1 FROM staff_profiles WHERE org_id = ? AND id = ? AND active = 1');
        $q->execute([$o, $staffProfileId]);
        $date = R::localDate(self::tz($pdo, $o), $atUtc);
        if ($q->fetchColumn() === false || $date === null) {
            return ['ok' => false, 'missing' => []];
        }
        $q = $pdo->prepare(
            "SELECT t.name FROM document_types t
              WHERE t.org_id = ? AND t.status = 'active' AND t.required = 1
                AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.org_id = t.org_id AND d.staff_profile_id = ? AND d.status = 'approved'
                                AND (d.document_type_id = t.id OR (d.document_type_id IS NULL AND d.type = t.name))
                                AND (d.expires_at IS NULL OR d.expires_at >= ?))
              ORDER BY t.name"
        );
        $q->execute([$o, $staffProfileId, $date]);
        $missing = array_map('strval', $q->fetchAll(\PDO::FETCH_COLUMN));
        return ['ok' => $missing === [], 'missing' => $missing];
    }

    /**
     * Requirement states for every active staff record (or only those in $only) on a local date. Only required, active types are requirements.
     * @param ?list<string> $only staff profile ids
     * @return array<string, list<array{type_id:string, name:string, state:string, expires_at:?string}>>
     */
    public static function requirementStates(\PDO $pdo, string $o, string $today, ?array $only = null): array
    {
        $q = $pdo->prepare("SELECT id, name FROM document_types WHERE org_id = ? AND status = 'active' AND required = 1 ORDER BY name");
        $q->execute([$o]);
        $types = $q->fetchAll();
        $q = $pdo->prepare('SELECT id FROM staff_profiles WHERE org_id = ? AND active = 1 ORDER BY first_name, last_name, id');
        $q->execute([$o]);
        $people = array_values(array_filter($q->fetchAll(\PDO::FETCH_COLUMN), static fn (string $id): bool => $only === null || in_array($id, $only, true)));
        $docs = [];
        if ($types !== [] && $people !== []) {
            $q = $pdo->prepare("SELECT staff_profile_id, document_type_id, type, status, expires_at FROM documents WHERE org_id = ? AND status IN ('uploaded','awaiting_review','approved','rejected') ORDER BY created_at, id");
            $q->execute([$o]);
            $byName = [];
            foreach ($types as $t) {
                $byName[strtolower($t['name'])] = $t['id'];
            }
            foreach ($q->fetchAll() as $r) {
                $tid = $r['document_type_id'] ?? ($byName[strtolower((string) $r['type'])] ?? null);
                if ($tid !== null) {
                    $docs[$r['staff_profile_id']][$tid][] = ['status' => $r['status'], 'expires_at' => $r['expires_at']];
                }
            }
        }
        $out = [];
        foreach ($people as $sid) {
            $list = [];
            foreach ($types as $t) {
                [$state, $exp] = R::stateOf($docs[$sid][$t['id']] ?? [], $today);
                $list[] = ['type_id' => $t['id'], 'name' => $t['name'], 'state' => $state, 'expires_at' => $exp];
            }
            $out[$sid] = $list;
        }
        return $out;
    }

    // ---- document types ---------------------------------------------------------------------------------------------------------------------

    /** Every member reads the active types (to upload against them); owners and managers also see archived ones and the UK presets. */
    private function listTypes(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->member($u, $o);
        $manages = self::manages($m);
        $q = $this->pdo->prepare('SELECT id, name, description, requires_expiry, default_validity_months, required, preset_key, status, version FROM document_types WHERE org_id = ?' . ($manages ? '' : " AND status = 'active'") . ' ORDER BY status, name');
        $q->execute([$o]);
        $types = $q->fetchAll();
        $res = ['types' => array_map(self::typeOut(...), $types)];
        if ($manages) {
            $keys = array_filter(array_column($types, 'preset_key'));
            $names = array_map('strtolower', array_column(array_filter($types, static fn (array $t): bool => $t['status'] === 'active'), 'name'));
            $res['presets'] = [];
            foreach (self::PRESETS as $key => [$name, $desc, $exp, $valid, $req]) {
                $res['presets'][] = ['key' => $key, 'name' => $name, 'description' => $desc, 'requires_expiry' => $exp, 'default_validity_months' => $valid, 'required' => $req,
                    'added' => in_array($key, $keys, true) || in_array(strtolower($name), $names, true)];
            }
        }
        return [200, $res];
    }

    private static function typeOut(array $t): array
    {
        return ['id' => $t['id'], 'name' => $t['name'], 'description' => $t['description'], 'requires_expiry' => (int) $t['requires_expiry'] === 1,
            'default_validity_months' => $t['default_validity_months'] === null ? null : (int) $t['default_validity_months'],
            'required' => (int) $t['required'] === 1, 'preset_key' => $t['preset_key'], 'status' => $t['status'], 'version' => (int) $t['version']];
    }

    private function createType(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->requireManager($u, $o);
        Scope::requireWritable($m);
        $this->ctx->limits->hit('compliance-type', $u['id'], 60, 3600);
        return $this->insertType($u, $o, self::typeInput($in), null, $ip);
    }

    private function addPreset(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->requireManager($u, $o);
        Scope::requireWritable($m);
        $this->ctx->limits->hit('compliance-type', $u['id'], 60, 3600);
        $key = $in['key'] ?? null;
        if (!is_string($key) || !isset(self::PRESETS[$key])) {
            throw HttpError::invalid('Unknown example');
        }
        [$name, $desc, $exp, $valid, $req] = self::PRESETS[$key];
        return $this->insertType($u, $o, ['name' => $name, 'description' => $desc, 'requires_expiry' => $exp, 'default_validity_months' => $valid, 'required' => $req], $key, $ip);
    }

    private function insertType(array $u, string $o, array $v, ?string $preset, string $ip): array
    {
        $id = Db::uuid();
        $this->tx(function () use ($u, $o, $v, $preset, $id, $ip): void {
            $this->pdo->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE')->execute([$o]); // one name check at a time per organisation
            $this->assertNameFree($o, $v['name'], null);
            $n = $this->pdo->prepare("SELECT COUNT(*) FROM document_types WHERE org_id = ? AND status = 'active'");
            $n->execute([$o]);
            if ((int) $n->fetchColumn() >= self::TYPE_LIMIT) {
                throw HttpError::conflict('type_limit', 'An organisation can have up to 100 document types');
            }
            $this->pdo->prepare('INSERT INTO document_types (id, org_id, name, description, requires_expiry, default_validity_months, required, preset_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $v['name'], $v['description'], $v['requires_expiry'] ? 1 : 0, $v['default_validity_months'], $v['required'] ? 1 : 0, $preset, $u['id']]);
            Audit::log($this->pdo, $o, $u['id'], 'document_type.created', 'document_types', $id, $preset !== null ? ['preset' => $preset] : [], 'info', 'org', $ip);
        });
        return [201, ['type' => $this->typeRow($o, $id)]];
    }

    private function updateType(array $u, array $in, string $ip, string $o, string $t): array
    {
        $m = $this->requireManager($u, $o);
        Scope::requireWritable($m);
        $expected = self::expectedVersion($in);
        $v = self::typeInput($in);
        $this->tx(function () use ($u, $o, $t, $v, $expected, $ip): void {
            $row = $this->lockType($o, $t);
            if ((int) $row['version'] !== $expected) {
                throw HttpError::conflict('version_conflict', 'Someone else changed this document type. Reload and try again.');
            }
            if ($row['status'] !== 'active') {
                throw HttpError::conflict('archived', 'This document type is archived');
            }
            $this->assertNameFree($o, $v['name'], $t);
            $this->pdo->prepare('UPDATE document_types SET name = ?, description = ?, requires_expiry = ?, default_validity_months = ?, required = ?, version = version + 1 WHERE org_id = ? AND id = ?')
                ->execute([$v['name'], $v['description'], $v['requires_expiry'] ? 1 : 0, $v['default_validity_months'], $v['required'] ? 1 : 0, $o, $t]);
            Audit::log($this->pdo, $o, $u['id'], 'document_type.updated', 'document_types', $t, [], 'info', 'org', $ip);
        });
        return [200, ['type' => $this->typeRow($o, $t)]];
    }

    /** Archiving lifts the requirement and hides the type from uploads; its documents stay as they are. */
    private function archiveType(array $u, array $in, string $ip, string $o, string $t): array
    {
        $m = $this->requireManager($u, $o);
        Scope::requireWritable($m);
        $expected = self::expectedVersion($in);
        $this->tx(function () use ($u, $o, $t, $expected, $ip): void {
            $row = $this->lockType($o, $t);
            if ((int) $row['version'] !== $expected) {
                throw HttpError::conflict('version_conflict', 'Someone else changed this document type. Reload and try again.');
            }
            $this->pdo->prepare("UPDATE document_types SET status = 'archived', version = version + 1 WHERE org_id = ? AND id = ?")->execute([$o, $t]);
            Audit::log($this->pdo, $o, $u['id'], 'document_type.archived', 'document_types', $t, [], 'info', 'org', $ip);
        });
        return [200, ['type' => $this->typeRow($o, $t)]];
    }

    /** @return array{name:string, description:string, requires_expiry:bool, default_validity_months:?int, required:bool} */
    private static function typeInput(array $in): array
    {
        $exp = $in['requires_expiry'] ?? false;
        $req = $in['required'] ?? false;
        if (!is_bool($exp) || !is_bool($req)) {
            throw HttpError::invalid('requires_expiry and required must be true or false');
        }
        $valid = $in['default_validity_months'] ?? null;
        if ($valid !== null && (!is_int($valid) || $valid < 1 || $valid > 120)) {
            throw HttpError::invalid('Default validity must be 1 to 120 months');
        }
        return ['name' => self::text($in['name'] ?? null, 2, 100, 'Name'), 'description' => self::text($in['description'] ?? '', 0, 500, 'Description'),
            'requires_expiry' => $exp, 'default_validity_months' => $valid, 'required' => $req];
    }

    private function assertNameFree(string $o, string $name, ?string $except): void
    {
        $q = $this->pdo->prepare("SELECT id FROM document_types WHERE org_id = ? AND status = 'active' AND name = ?" . ($except !== null ? ' AND id <> ?' : ''));
        $q->execute($except !== null ? [$o, $name, $except] : [$o, $name]);
        if ($q->fetchColumn() !== false) {
            throw HttpError::conflict('duplicate_name', 'A document type with that name already exists');
        }
    }

    private function lockType(string $o, string $t): array
    {
        $q = $this->pdo->prepare('SELECT id, status, version FROM document_types WHERE org_id = ? AND id = ? FOR UPDATE');
        $q->execute([$o, $t]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function typeRow(string $o, string $t): array
    {
        $q = $this->pdo->prepare('SELECT id, name, description, requires_expiry, default_validity_months, required, preset_key, status, version FROM document_types WHERE org_id = ? AND id = ?');
        $q->execute([$o, $t]);
        return self::typeOut($q->fetch());
    }

    // ---- documents ----------------------------------------------------------------------------------------------------------------------------

    private const DOC_COLS = 'd.id, d.staff_profile_id, d.document_type_id, d.type, d.name, d.file_url, d.storage_path, d.mime, d.issued_at, d.expires_at, d.status,
        d.rejection_reason, d.uploaded_by, d.submitted_at, d.reviewed_by, d.reviewed_at, d.superseded_by, d.created_at, d.version';

    /** Owners and managers: one person's (?staff_profile_id=) or everyone's. Staff: their own only; asking for someone else's is 404. */
    private function listDocuments(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->member($u, $o, true);
        $want = $in['staff_profile_id'] ?? null;
        $mine = Scope::staffProfileId($this->pdo, $o, $u['id']);
        if (self::manages($m)) {
            $target = is_string($want) && $want !== '' ? $want : null;
        } else {
            if ((is_string($want) && $want !== '' && $want !== $mine) || $mine === null) {
                if ($mine === null && ($want === null || $want === '')) {
                    return [200, ['documents' => []]];
                }
                throw HttpError::notFound(); // never reveal whether someone else's documents exist
            }
            $target = $mine;
        }
        return [200, ['documents' => self::documentsFor($this->pdo, $o, $target, R::today(self::tz($this->pdo, $o)))]];
    }

    /** Full rows, for the person themself or owners and managers only. @return list<array<string,mixed>> */
    public static function documentsFor(\PDO $pdo, string $o, ?string $staffProfileId, string $today): array
    {
        $q = $pdo->prepare('SELECT ' . self::DOC_COLS . ' FROM documents d WHERE d.org_id = ?' . ($staffProfileId !== null ? ' AND d.staff_profile_id = ?' : '') . ' ORDER BY d.created_at DESC, d.id LIMIT 500');
        $q->execute($staffProfileId !== null ? [$o, $staffProfileId] : [$o]);
        return array_map(static fn (array $r): array => self::docOut($r, $today), $q->fetchAll());
    }

    private static function docOut(array $r, string $today): array
    {
        $r['stored_status'] = $r['status'];
        $r['status'] = R::status($r['status'], $r['expires_at'], $today);
        $r['version'] = (int) $r['version'];
        $r['stored'] = $r['storage_path'] !== null;
        unset($r['storage_path']); // the path is the store's business; the file is opened through a signed link
        foreach (['submitted_at', 'reviewed_at', 'created_at'] as $k) {
            $r[$k] = $r[$k] === null ? null : str_replace(' ', 'T', substr((string) $r[$k], 0, 19)) . 'Z';
        }
        return $r;
    }

    private function createDocument(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->member($u, $o);
        Scope::requireWritable($m);
        $this->ctx->limits->hit('compliance-doc', $u['id'], 60, 3600);
        $mine = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $target = $in['staff_profile_id'] ?? $mine;
        if (!is_string($target) || preg_match('/^[0-9a-f-]{36}$/', $target) !== 1) {
            throw HttpError::invalid('Choose whose document this is');
        }
        if ($target !== $mine && !self::manages($m)) {
            throw HttpError::forbidden('You can only add your own documents');
        }
        $q = $this->pdo->prepare('SELECT id FROM staff_profiles WHERE org_id = ? AND id = ? AND active = 1');
        $q->execute([$o, $target]);
        if ($q->fetchColumn() === false) {
            throw HttpError::invalid('Documents can only be added for active staff');
        }
        $typeId = $in['document_type_id'] ?? null;
        $type = null;
        if (is_string($typeId) && preg_match('/^[0-9a-f-]{36}$/', $typeId) === 1) {
            $q = $this->pdo->prepare("SELECT id, name, requires_expiry, default_validity_months FROM document_types WHERE org_id = ? AND id = ? AND status = 'active'");
            $q->execute([$o, $typeId]);
            $type = $q->fetch() ?: null;
        }
        if ($type === null) {
            throw HttpError::invalid('Choose a document type');
        }
        $name = array_key_exists('name', $in) && $in['name'] !== null && $in['name'] !== '' ? self::text($in['name'], 1, 200, 'Name') : (string) $type['name'];
        [$issued, $expires] = self::dates($in, $type, R::today(self::tz($this->pdo, $o)));
        $submit = $in['submit'] ?? true;
        if (!is_bool($submit)) {
            throw HttpError::invalid('submit must be true or false');
        }
        $data = $in['data'] ?? null;
        $bytes = is_string($data) ? base64_decode($data, true) : false;
        if ($bytes === false || $bytes === '') {
            throw HttpError::invalid('data must be the file, base64 encoded');
        }
        if (strlen($bytes) > self::MAX_BYTES) {
            throw new HttpError(413, 'document_too_large', 'A document can be at most 10 MB');
        }
        $mime = R::sniff($bytes);
        if ($mime === null) {
            throw new HttpError(415, 'document_type', 'A document must be a PDF, JPEG, PNG, WebP or HEIC file');
        }
        $id = Db::uuid();
        $path = "$o/$target/" . bin2hex(random_bytes(12)) . '.' . R::EXTENSIONS[$mime];
        $store = FileStore::forCtx($this->ctx);
        $store->put(FileStore::DOCUMENTS, $path, $bytes);
        try {
            $this->tx(function () use ($u, $o, $id, $target, $type, $name, $path, $mime, $issued, $expires, $submit, $ip): void {
                $this->pdo->prepare('INSERT INTO documents (id, org_id, staff_profile_id, document_type_id, type, name, storage_path, mime, issued_at, expires_at, status, uploaded_by, submitted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ' . ($submit ? 'UTC_TIMESTAMP(6)' : 'NULL') . ')')
                    ->execute([$id, $o, $target, $type['id'], $type['name'], $name, $path, $mime, $issued, $expires, $submit ? 'awaiting_review' : 'uploaded', $u['id']]);
                Audit::log($this->pdo, $o, $u['id'], 'document.uploaded', 'documents', $id, ['type_id' => $type['id'], 'on_behalf' => $target !== Scope::staffProfileId($this->pdo, $o, $u['id'])], 'info', 'org', $ip);
                if ($submit) {
                    $this->notifySubmitted($o, $id, $target, (string) $type['name'], $u['id']);
                }
            });
        } catch (\Throwable $e) {
            $store->delete(FileStore::DOCUMENTS, $path, false); // no orphan on a failure
            throw $e;
        }
        return [201, ['document' => $this->docRow($o, $id)]];
    }

    /** @return array{0:?string, 1:?string} issued_at, expires_at; the type's default validity fills a missing expiry from the issue date */
    private static function dates(array $in, array $type, string $today): array
    {
        $issued = self::date($in['issued_at'] ?? null, 'Issue date');
        $expires = self::date($in['expires_at'] ?? null, 'Expiry date');
        if ($issued !== null && ($issued > $today || $issued < '1950-01-01')) {
            throw HttpError::invalid($issued > $today ? 'The issue date cannot be in the future' : 'Check the issue date');
        }
        if ($expires === null && $issued !== null && $type['default_validity_months'] !== null) {
            $expires = (new \DateTimeImmutable($issued, new \DateTimeZone('UTC')))->modify('+' . (int) $type['default_validity_months'] . ' months')->modify('-1 day')->format('Y-m-d');
        }
        if ($expires === null && (int) $type['requires_expiry'] === 1) {
            throw HttpError::invalid('This document type needs an expiry date');
        }
        if ($expires !== null && $issued !== null && $expires < $issued) {
            throw HttpError::invalid('The expiry date must be after the issue date');
        }
        if ($expires !== null && $expires < $today) {
            throw HttpError::invalid('This document has already expired');
        }
        if ($expires !== null && $expires > R::addDays($today, 365 * 50)) {
            throw HttpError::invalid('Check the expiry date');
        }
        return [$issued, $expires];
    }

    /** The person sends a saved draft for review. */
    private function submit(array $u, array $in, string $ip, string $o, string $d): array
    {
        $m = $this->member($u, $o);
        Scope::requireWritable($m);
        $this->tx(function () use ($u, $m, $o, $d, $in, $ip): void {
            $doc = $this->lockDoc($o, $d, $u, $m);
            self::checkVersion($in, $doc);
            if ($doc['status'] !== 'uploaded') {
                throw HttpError::conflict('wrong_status', 'Only a saved draft can be sent for review');
            }
            if ($doc['expires_at'] !== null && $doc['expires_at'] < R::today(self::tz($this->pdo, $o))) {
                throw HttpError::conflict('document_expired', 'This document has expired. Upload a current one.');
            }
            $this->pdo->prepare("UPDATE documents SET status = 'awaiting_review', submitted_at = UTC_TIMESTAMP(6), version = version + 1 WHERE org_id = ? AND id = ?")->execute([$o, $d]);
            Audit::log($this->pdo, $o, $u['id'], 'document.submitted', 'documents', $d, [], 'info', 'org', $ip);
            $this->notifySubmitted($o, $d, $doc['staff_profile_id'], (string) $doc['type'], $u['id']);
        });
        return [200, ['document' => $this->docRow($o, $d)]];
    }

    /** Owners and managers approve or reject, under the four-eyes rule. Approving supersedes the person's earlier approved row of that type. */
    private function review(array $u, array $in, string $ip, string $o, string $d): array
    {
        $m = $this->requireManager($u, $o);
        Scope::requireWritable($m);
        $decision = $in['decision'] ?? null;
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw HttpError::invalid('decision must be approve or reject');
        }
        $reason = $decision === 'reject' ? self::text($in['reason'] ?? null, 3, 500, 'Reason') : null;
        $expected = self::expectedVersion($in);
        $this->tx(function () use ($u, $m, $o, $d, $decision, $reason, $expected, $ip): void {
            $doc = $this->lockDoc($o, $d, $u, $m);
            if ((int) $doc['version'] !== $expected) {
                throw HttpError::conflict('version_conflict', 'This document changed since you opened it. Reload and try again.');
            }
            if ($doc['staff_profile_id'] === Scope::staffProfileId($this->pdo, $o, $u['id'])) {
                throw HttpError::forbidden('Someone else must review your own documents');
            }
            if ($decision === 'approve' && $doc['uploaded_by'] === $u['id'] && $m['role'] !== 'owner') {
                throw HttpError::forbidden('Someone else must approve a document you uploaded');
            }
            if ($doc['status'] !== 'awaiting_review') {
                throw HttpError::conflict('wrong_status', 'This document is not awaiting review');
            }
            if ($decision === 'approve' && $doc['expires_at'] !== null && $doc['expires_at'] < R::today(self::tz($this->pdo, $o))) {
                throw HttpError::conflict('document_expired', 'This document has expired and cannot be approved');
            }
            if ($decision === 'approve' && $doc['document_type_id'] !== null) {
                $this->pdo->prepare("UPDATE documents SET status = 'superseded', superseded_by = ?, version = version + 1 WHERE org_id = ? AND staff_profile_id = ? AND document_type_id = ? AND status = 'approved' AND id <> ?")
                    ->execute([$d, $o, $doc['staff_profile_id'], $doc['document_type_id'], $d]);
            }
            $this->pdo->prepare('UPDATE documents SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), version = version + 1 WHERE org_id = ? AND id = ?')
                ->execute([$decision === 'approve' ? 'approved' : 'rejected', $reason, $u['id'], $o, $d]);
            Audit::log($this->pdo, $o, $u['id'], $decision === 'approve' ? 'document.approved' : 'document.rejected', 'documents', $d, [], 'info', 'org', $ip);
            $person = Notify::userOfStaff($this->pdo, $doc['staff_profile_id']);
            if ($person !== null) {
                Notify::enqueue($this->pdo, $o, $decision === 'approve' ? 'compliance/approved' : 'compliance/rejected', [$person], 'document',
                    $decision === 'approve' ? "Your {$doc['type']} was approved" : "Your {$doc['type']} was not accepted",
                    $decision === 'approve' ? null : 'Reason: ' . $reason . '. Upload a new copy from your profile.');
            }
        });
        return [200, ['document' => $this->docRow($o, $d)]];
    }

    /** The person: their own drafts, pending or rejected documents. Owners and managers: any live document. Kept as history either way. */
    private function withdraw(array $u, array $in, string $ip, string $o, string $d): array
    {
        $m = $this->member($u, $o);
        Scope::requireWritable($m);
        $this->tx(function () use ($u, $m, $o, $d, $in, $ip): void {
            $doc = $this->lockDoc($o, $d, $u, $m);
            self::checkVersion($in, $doc);
            $allowed = self::manages($m) ? R::LIVE : ['uploaded', 'awaiting_review', 'rejected'];
            if (!in_array($doc['status'], $allowed, true)) {
                throw $doc['status'] === 'approved' ? HttpError::forbidden('Ask a manager to remove an approved document') : HttpError::conflict('wrong_status', 'This document cannot be withdrawn');
            }
            $this->pdo->prepare("UPDATE documents SET status = 'withdrawn', version = version + 1 WHERE org_id = ? AND id = ?")->execute([$o, $d]);
            Audit::log($this->pdo, $o, $u['id'], 'document.withdrawn', 'documents', $d, ['was' => $doc['status']], 'info', 'org', $ip);
        });
        return [200, ['document' => $this->docRow($o, $d)]];
    }

    /** Owners and managers: documents awaiting review, oldest first, with the person's name. */
    private function queue(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->requireManager($u, $o);
        $today = R::today(self::tz($this->pdo, $o));
        $mine = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $q = $this->pdo->prepare('SELECT ' . self::DOC_COLS . ", TRIM(CONCAT(sp.first_name, ' ', sp.last_name)) AS staff_name
            FROM documents d JOIN staff_profiles sp ON sp.org_id = d.org_id AND sp.id = d.staff_profile_id
            WHERE d.org_id = ? AND d.status = 'awaiting_review' AND sp.active = 1 ORDER BY d.submitted_at, d.created_at, d.id LIMIT 200");
        $q->execute([$o]);
        return [200, ['documents' => array_map(static fn (array $r): array => self::docOut($r, $today) + [
            'own' => $r['staff_profile_id'] === $mine,
            'can_approve' => $r['staff_profile_id'] !== $mine && ($r['uploaded_by'] !== $u['id'] || $m['role'] === 'owner'),
        ], $q->fetchAll())]];
    }

    /** A link to open the file, good for a minute; a moved row's pasted link is returned as it is. */
    private function link(array $u, array $in, string $ip, string $o, string $d): array
    {
        $m = $this->member($u, $o);
        $q = $this->pdo->prepare('SELECT staff_profile_id, storage_path, file_url FROM documents WHERE org_id = ? AND id = ?');
        $q->execute([$o, $d]);
        $doc = $q->fetch();
        if ($doc === false || (!self::manages($m) && $doc['staff_profile_id'] !== Scope::staffProfileId($this->pdo, $o, $u['id']))) {
            throw HttpError::notFound();
        }
        if ($doc['storage_path'] === null) {
            return [200, ['url' => $doc['file_url'], 'expires_at' => null]];
        }
        $exp = time() + self::LINK_SECONDS;
        $sig = Photos::sign($this->ctx->config, FileStore::DOCUMENTS, $doc['storage_path'], $exp);
        $url = rtrim($this->ctx->appUrl, '/') . '/api/document-files?' . http_build_query(['p' => $doc['storage_path'], 'e' => $exp, 's' => $sig]);
        return [200, ['url' => $url, 'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $exp)]];
    }

    /** Public, because a new tab cannot send a sign-in; authorised by the signature, the expiry, and the file still belonging to a document. */
    private function serve(?array $user, array $in, string $ip): array
    {
        $p = $in['p'] ?? null;
        $e = $in['e'] ?? null;
        $sig = $in['s'] ?? null;
        if (!is_string($p) || !is_string($e) || !ctype_digit($e) || !is_string($sig) || (int) $e < time() || !FileStore::validObject($p)
            || !hash_equals(Photos::sign($this->ctx->config, FileStore::DOCUMENTS, $p, (int) $e), $sig)) {
            throw HttpError::notFound();
        }
        $q = $this->pdo->prepare('SELECT mime FROM documents WHERE org_id = ? AND storage_path = ?');
        $q->execute([explode('/', $p)[0], $p]);
        $known = $q->fetchColumn();
        $bytes = $known === false ? null : FileStore::forCtx($this->ctx)->get(FileStore::DOCUMENTS, $p);
        $mime = $bytes === null ? null : R::sniff($bytes);
        if ($bytes === null || $mime === null) {
            throw HttpError::notFound();
        }
        return [200, ['__raw' => ['mime' => $mime, 'body' => $bytes, 'cache' => 'private, no-store', 'filename' => 'document.' . R::EXTENSIONS[$mime]]]];
    }

    /** "My documents": what is required of me, its state, my history. A member with no staff record has nothing required. */
    private function mine(array $u, array $in, string $ip, string $o): array
    {
        $this->member($u, $o);
        $today = R::today(self::tz($this->pdo, $o));
        $sid = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $reqs = $sid === null ? [] : (self::requirementStates($this->pdo, $o, $today, [$sid])[$sid] ?? []);
        return [200, ['today' => $today, 'staff_profile_id' => $sid, 'requirements' => $reqs, 'counts' => R::counts($reqs),
            'documents' => $sid === null ? [] : self::documentsFor($this->pdo, $o, $sid, $today)]];
    }

    /**
     * Owners and managers: organisation-wide numbers, the same by type, and each active person's eligibility (the rota builder's chip).
     * Staff: their own numbers only.
     */
    private function summary(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->member($u, $o);
        $today = R::today(self::tz($this->pdo, $o));
        if (!self::manages($m)) {
            $sid = Scope::staffProfileId($this->pdo, $o, $u['id']);
            $reqs = $sid === null ? [] : (self::requirementStates($this->pdo, $o, $today, [$sid])[$sid] ?? []);
            return [200, ['scope' => 'me', 'today' => $today, 'counts' => R::counts($reqs)]];
        }
        $q = $this->pdo->prepare("SELECT COUNT(*) FROM documents d JOIN staff_profiles sp ON sp.org_id = d.org_id AND sp.id = d.staff_profile_id AND sp.active = 1 WHERE d.org_id = ? AND d.status = 'awaiting_review'");
        $q->execute([$o]);
        $out = ['awaiting_review' => (int) $q->fetchColumn(), 'expiring' => 0, 'expired' => 0, 'missing' => 0, 'not_eligible' => 0, 'people' => 0];
        $byType = [];
        $people = [];
        foreach (self::requirementStates($this->pdo, $o, $today) as $sid => $reqs) {
            $n = R::counts($reqs);
            $out['people']++;
            $out['expiring'] += $n['expiring'];
            $out['expired'] += $n['expired'];
            $out['missing'] += $n['missing'];
            $out['not_eligible'] += $n['eligible'] ? 0 : 1;
            foreach ($reqs as $r) {
                $byType[$r['type_id']] ??= ['type_id' => $r['type_id'], 'name' => $r['name'], 'approved' => 0, 'expiring' => 0, 'expired' => 0, 'awaiting_review' => 0, 'missing' => 0];
                $key = in_array($r['state'], ['approved', 'expiring', 'expired', 'awaiting_review'], true) ? $r['state'] : 'missing';
                $byType[$r['type_id']][$key]++;
            }
            $people[] = ['staff_profile_id' => $sid, 'eligible' => $n['eligible'],
                'missing' => array_values(array_map(static fn (array $r): string => $r['name'], array_filter($reqs, static fn (array $r): bool => !in_array($r['state'], ['approved', 'expiring'], true)))),
                'expiring' => array_values(array_map(static fn (array $r): array => ['name' => $r['name'], 'expires_at' => $r['expires_at']], array_filter($reqs, static fn (array $r): bool => $r['state'] === 'expiring')))];
        }
        return [200, ['scope' => 'org', 'today' => $today, 'counts' => $out, 'by_type' => array_values($byType), 'people' => $people]];
    }

    private function notifySubmitted(string $o, string $docId, string $staffProfileId, string $typeName, string $actor): void
    {
        $q = $this->pdo->prepare("SELECT TRIM(CONCAT(first_name, ' ', last_name)) FROM staff_profiles WHERE org_id = ? AND id = ?");
        $q->execute([$o, $staffProfileId]);
        $who = (string) ($q->fetchColumn() ?: 'A team member');
        $to = array_values(array_diff(Notify::managers($this->pdo, $o), [$actor]));
        Notify::enqueue($this->pdo, $o, 'compliance/submitted', $to, 'document', "$who: $typeName is awaiting review", 'Review it on the Compliance page.');
    }

    /** Locks a document the caller may act on: owners and managers any in the organisation, others only their own. Else 404. */
    private function lockDoc(string $o, string $d, array $u, array $m): array
    {
        $q = $this->pdo->prepare('SELECT id, staff_profile_id, document_type_id, type, uploaded_by, status, expires_at, version FROM documents WHERE org_id = ? AND id = ? FOR UPDATE');
        $q->execute([$o, $d]);
        $doc = $q->fetch();
        if ($doc === false || (!self::manages($m) && $doc['staff_profile_id'] !== Scope::staffProfileId($this->pdo, $o, $u['id']))) {
            throw HttpError::notFound();
        }
        return $doc;
    }

    private function docRow(string $o, string $d): array
    {
        $q = $this->pdo->prepare('SELECT ' . self::DOC_COLS . ' FROM documents d WHERE d.org_id = ? AND d.id = ?');
        $q->execute([$o, $d]);
        return self::docOut($q->fetch(), R::today(self::tz($this->pdo, $o)));
    }

    // ---- expiry reminders (cron) -----------------------------------------------------------------------------------------------------------

    /**
     * On the quarter-hour: bin/cron.php beats every minute, and this job runs at most once in any fifteen minutes (a stamp in the cache folder).
     * It is idempotent either way; the gate only keeps the work to what the old 15-minute schedule did.
     */
    public static function cron(Ctx $ctx, int $now = 0): string
    {
        $now = $now ?: time();
        $stamp = rtrim($ctx->privateRoot, '/') . '/cache/compliance-reminders.stamp';
        $last = is_file($stamp) ? (int) file_get_contents($stamp) : 0;
        if ($now - $last < 15 * 60 - 30 && $now >= $last) {
            return 'expiry reminders: not due';
        }
        $n = self::runReminders($ctx->pdo, gmdate('Y-m-d\TH:i:s\Z', $now));
        if (is_dir(dirname($stamp))) {
            file_put_contents($stamp, (string) $now, LOCK_EX);
        }
        return "expiry reminders sent for $n document stage(s)";
    }

    /**
     * Sends each stage at most once per document (document_reminders' primary key): 30, 14 and 7 days before the expiry date, then 'expired'
     * the first local day after it, all in the organisation's timezone. Missed runs send only the most urgent stage due. The person is told
     * (if they have a login) and so are the owners and managers: this is the expiring-document alert of the old 0093 job, folded in here.
     * Approved documents only, of active staff, of an active type or moved from before types existed. @return int stages sent
     */
    public static function runReminders(\PDO $pdo, string $nowUtc): int
    {
        $sent = 0;
        foreach ($pdo->query("SELECT id, timezone FROM organisations WHERE status = 'active'")->fetchAll() as $org) {
            $tz = in_array($org['timezone'], \DateTimeZone::listIdentifiers(), true) ? (string) $org['timezone'] : 'Europe/London';
            $today = R::localDate($tz, $nowUtc);
            if ($today === null) {
                continue;
            }
            $q = $pdo->prepare(
                "SELECT d.id, d.staff_profile_id, d.expires_at, d.type, sp.user_id, TRIM(CONCAT(sp.first_name, ' ', sp.last_name)) AS who
                   FROM documents d
                   JOIN staff_profiles sp ON sp.org_id = d.org_id AND sp.id = d.staff_profile_id AND sp.active = 1
                   LEFT JOIN document_types t ON t.org_id = d.org_id AND t.id = d.document_type_id
                  WHERE d.org_id = ? AND d.status = 'approved' AND d.expires_at IS NOT NULL AND d.expires_at BETWEEN ? AND ?
                    AND (d.document_type_id IS NULL OR t.status = 'active')
                    AND NOT EXISTS (SELECT 1 FROM document_reminders r WHERE r.document_id = d.id AND r.stage = 'expired')
                  LIMIT 2000"
            );
            $q->execute([$org['id'], R::addDays($today, -60), R::addDays($today, max(R::REMINDER_DAYS))]);
            foreach ($q->fetchAll() as $doc) {
                $stage = R::stageFor($doc['expires_at'], $today);
                if ($stage === null) {
                    continue;
                }
                $pdo->beginTransaction();
                try {
                    $ins = $pdo->prepare('INSERT IGNORE INTO document_reminders (org_id, document_id, stage) VALUES (?, ?, ?)');
                    $ins->execute([$org['id'], $doc['id'], $stage]);
                    if ($ins->rowCount() === 1) {
                        self::remind($pdo, $org['id'], $doc, $stage, $today);
                        $sent++;
                    }
                    $pdo->commit();
                } catch (\Throwable $e) {
                    if ($pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    throw $e;
                }
            }
        }
        return $sent;
    }

    private static function remind(\PDO $pdo, string $o, array $doc, string $stage, string $today): void
    {
        $date = (new \DateTimeImmutable((string) $doc['expires_at']))->format('j F Y');
        $type = (string) $doc['type'];
        $who = (string) $doc['who'];
        $key = 'document_reminder:' . $doc['id'] . ':' . $stage;
        $managers = Notify::managers($pdo, $o);
        if ($stage === 'expired') {
            if ($doc['user_id'] !== null) {
                Notify::enqueue($pdo, $o, 'compliance/expired', [$doc['user_id']], 'document', "Your $type expired on $date", 'Upload a current one from your profile.', $key . ':person');
            }
            Notify::enqueue($pdo, $o, 'compliance/expired', array_values(array_diff($managers, [$doc['user_id']])), 'document', "$type has expired for $who",
                "Expired on $date. Check whether they are eligible to work before they are rostered again.", $key . ':managers');
            return;
        }
        $left = R::daysBetween($today, (string) $doc['expires_at']);
        $in = $left === 0 ? 'today' : ($left === 1 ? 'tomorrow' : "in $left days");
        if ($doc['user_id'] !== null) {
            Notify::enqueue($pdo, $o, 'compliance/expiring', [$doc['user_id']], 'document', "Your $type expires $in", "It expires on $date. Upload the renewed one from your profile.", $key . ':person');
        }
        Notify::enqueue($pdo, $o, 'compliance/expiring', array_values(array_diff($managers, [$doc['user_id']])), 'document', "$type expires $in for $who",
            "It expires on $date. Book the renewal before it blocks a shift.", $key . ':managers');
    }

    // ---- small helpers ----------------------------------------------------------------------------------------------------------------------

    public static function text(mixed $v, int $min, int $max, string $label): string
    {
        if (!is_string($v)) {
            throw HttpError::invalid("$label is required");
        }
        $v = trim($v);
        if (preg_match('//u', $v) !== 1 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $v) === 1) {
            throw HttpError::invalid("$label contains characters that are not allowed");
        }
        $len = Str::len($v);
        if ($len < $min || $len > $max) {
            throw HttpError::invalid($min > 0 ? "$label must be $min to $max characters" : "$label must be at most $max characters");
        }
        return $v;
    }

    private static function date(mixed $v, string $label): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $p) !== 1 || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
            throw HttpError::invalid("$label must be a real date (YYYY-MM-DD)");
        }
        return $v;
    }

    private static function expectedVersion(array $in): int
    {
        $v = $in['expected_version'] ?? null;
        if (!is_int($v) || $v < 1) {
            throw HttpError::invalid('expected_version is required');
        }
        return $v;
    }

    /** An optional expected_version, for the person's own actions (submit, withdraw). */
    private static function checkVersion(array $in, array $doc): void
    {
        if (array_key_exists('expected_version', $in) && $in['expected_version'] !== (int) $doc['version']) {
            throw HttpError::conflict('version_conflict', 'This document changed since you opened it. Reload and try again.');
        }
    }

    private function tx(callable $fn): void
    {
        $this->pdo->beginTransaction();
        try {
            $fn();
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }
}
