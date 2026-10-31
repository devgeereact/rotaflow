<?php
declare(strict_types=1);

// Compliance (R2 slice S10): document types, staff documents with review, the four-eyes rule, supersede on approval, eligibility in the
// organisation's timezone, signed file links, and the d30/d14/d7/expired reminders. Ported from SiteRelay's 060-compliance suite and re-made
// for RotaFlow's roles (owner, manager, staff) and its staff records.
use RotaFlow\{ComplianceRules as R, Db, FileStore};
use RotaFlow\Mod\{Compliance, Photos};

$api = test_api($pdo);
$LON = 'Europe/London';
$today = R::today($LON);
$day = static fn (int $n): string => R::addDays($today, $n);
$noon = static fn (string $date): string => $date . 'T12:00:00Z'; // 12:00 UTC is the same calendar day in London all year
$PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
$JPEG = "\xFF\xD8\xFF\xE0" . str_repeat('J', 64);

// ---- pure rules ------------------------------------------------------------------------------------------------------------------------------
check('rules: valid through the expiry date, expired the next day', R::status('approved', '2026-11-10', '2026-11-10') === 'approved' && R::status('approved', '2026-11-10', '2026-11-11') === 'expired' && R::status('rejected', '2026-11-10', '2026-12-01') === 'rejected' && R::status('awaiting_review', '2026-11-10', '2026-11-11') === 'expired' && R::status('superseded', '2026-11-10', '2026-12-01') === 'superseded');
check('rules: expiry state', R::expiryState(null, '2026-11-01') === 'none' && R::expiryState('2026-12-01', '2026-11-01') === 'expiring' && R::expiryState('2026-12-02', '2026-11-01') === 'valid' && R::expiryState('2026-10-31', '2026-11-01') === 'expired' && R::expiryState('2026-11-01', '2026-11-01') === 'expiring');
check('rules: London local date across the clock change; Auckland ahead of UTC', R::localDate($LON, '2026-10-24T23:30:00Z') === '2026-10-25' && R::localDate($LON, '2026-10-25T23:30:00Z') === '2026-10-25' && R::localDate('Pacific/Auckland', '2027-03-10T11:00:00Z') === '2027-03-11' && R::localDate($LON, 'tomorrow') === null && R::localDate('Not/AZone', '2026-01-01T00:00:00Z') === null);
check('rules: requirement state picks the best approved row, then pending, then the last outcome', R::stateOf([], '2026-11-01') === ['missing', null]
    && R::stateOf([['status' => 'approved', 'expires_at' => '2027-06-01']], '2026-11-01') === ['approved', '2027-06-01']
    && R::stateOf([['status' => 'approved', 'expires_at' => '2026-11-20']], '2026-11-01') === ['expiring', '2026-11-20']
    && R::stateOf([['status' => 'approved', 'expires_at' => '2026-10-01'], ['status' => 'awaiting_review', 'expires_at' => null]], '2026-11-01') === ['awaiting_review', null]
    && R::stateOf([['status' => 'rejected', 'expires_at' => null]], '2026-11-01') === ['rejected', null]
    && R::stateOf([['status' => 'approved', 'expires_at' => '2026-10-01']], '2026-11-01') === ['expired', '2026-10-01']
    && R::stateOf([['status' => 'withdrawn', 'expires_at' => null], ['status' => 'superseded', 'expires_at' => null]], '2026-11-01') === ['missing', null]);
check('rules: counts and eligibility', R::counts([['state' => 'approved'], ['state' => 'expiring']])['eligible'] === true && R::counts([['state' => 'approved'], ['state' => 'rejected']]) === ['required' => 2, 'approved' => 1, 'expiring' => 0, 'expired' => 0, 'awaiting_review' => 0, 'missing' => 1, 'eligible' => false] && R::counts([])['eligible'] === true);
check('rules: reminder stages', R::stageFor('2026-12-31', '2026-11-30') === null && R::stageFor('2026-12-31', '2026-12-01') === 'd30' && R::stageFor('2026-12-31', '2026-12-17') === 'd14' && R::stageFor('2026-12-31', '2026-12-24') === 'd7' && R::stageFor('2026-12-31', '2026-12-31') === 'd7' && R::stageFor('2026-12-31', '2027-01-01') === 'expired');
check('rules: the file type comes from the bytes', R::sniff($PDF) === 'application/pdf' && R::sniff($JPEG) === 'image/jpeg' && R::sniff("\x00\x00\x00\x18ftypheic" . str_repeat('h', 20)) === 'image/heic' && R::sniff('<html><script>alert(1)</script>') === null && R::sniff("just text\n") === null && R::sniff('') === null);

// ---- the organisation ----------------------------------------------------------------------------------------------------------------------
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Care Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
foreach (['mark' => 'manager', 'mia' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'nora' => 'staff'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $r, "$n@example.test"]);
}
$uid = static fn (string $n): string => (string) $pdo->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();

// Local-live walk (31 Oct 2026): the R2 gate says every slice is dark ON THE SERVER while its flag is off (403 feature_off after the
// membership check), but these routes answered with the flag off; only the screens were hidden. Off, every organisation route here refuses.
$compRoutes = [['GET', '/document-types'], ['POST', '/document-types'], ['POST', '/document-types/presets'], ['POST', '/documents'],
    ['GET', '/documents/queue'], ['GET', '/compliance/me'], ['GET', '/compliance/summary']];
$offCodes = [];
foreach ($compRoutes as [$verb, $path]) {
    [$st, $body] = call($api, 'olga', $verb, "/orgs/$org$path", $verb === 'POST' ? ['name' => 'x'] : []);
    $offCodes[] = "$verb $path " . $st . ' ' . ($body['error']['code'] ?? '');
}
check('flag off: every compliance route but the plain read answers 403 feature_off', $offCodes === array_map(static fn (array $r): string => "{$r[0]} {$r[1]} 403 feature_off", $compRoutes), implode('; ', $offCodes));
check('flag off: a stranger still gets 404, not the flag', call($api, 'zed', 'GET', "/orgs/$org/documents/queue")[0] === 404);
// The plain read stays, as before S10: the rota builder and the staff list read it for expiring-document warnings with the flag off.
check('flag off: GET documents still answers (the pre-S10 read the warnings use)', call($api, 'olga', 'GET', "/orgs/$org/documents")[0] === 200);
$pdo->exec("UPDATE feature_flags SET enabled = 1, rollout = 100 WHERE flag_key = 'staff_documents'");
$staff = ['olga' => RotaFlow\Scope::staffProfileId($pdo, $org, $uid('olga'))];
foreach (['mark', 'sam', 'pat'] as $n) { // nora is a member with no staff record
    $staff[$n] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($n), 'last_name' => 'Smith', 'email' => "$n@example.test"])[1]['id'];
}
$staff['ivy'] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Ivy', 'last_name' => 'Nologin'])[1]['id'];
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
check('fixtures: staff records linked to their logins', count(array_filter($staff)) === 5 && $pdo->query("SELECT user_id FROM staff_profiles WHERE id = '{$staff['sam']}'")->fetchColumn() === $uid('sam'));
$outbox = static function (string $event, string $who, ?string $about = null) use ($pdo, $uid): int {
    $n = 0;
    foreach ($pdo->query("SELECT payload FROM notification_outbox WHERE event_name = " . $pdo->quote($event))->fetchAll(PDO::FETCH_COLUMN) as $p) {
        $j = json_decode((string) $p, true);
        if (in_array($uid($who), $j['userIds'], true) && ($about === null || str_contains((string) $j['title'], $about))) { $n++; }
    }
    return $n;
};
$audit = static fn (string $action, string $id): int => (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = '$action' AND entity_id = '$id'")->fetchColumn();

// ---- document types --------------------------------------------------------------------------------------------------------------------------
$T = "/orgs/$org/document-types";
$typeBody = ['name' => 'COSHH training', 'description' => 'Chemicals', 'requires_expiry' => true, 'required' => true];
check('types: staff cannot create (403); a stranger gets 404; anonymous 401', call($api, 'sam', 'POST', $T, $typeBody)[0] === 403 && call($api, 'zed', 'POST', $T, $typeBody)[0] === 404 && call($api, 'zed', 'GET', $T)[0] === 404 && call($api, '', 'GET', $T)[0] === 401);
check('types: name too short or with control characters', call($api, 'mark', 'POST', $T, ['name' => 'X'] + $typeBody)[0] === 422 && call($api, 'mark', 'POST', $T, ['name' => "COSHH\x07"] + $typeBody)[0] === 422 && call($api, 'mark', 'POST', $T, ['name' => ['a']] + $typeBody)[0] === 422);
check('types: flags must be booleans; validity 1 to 120 months', call($api, 'mark', 'POST', $T, ['requires_expiry' => 'yes'] + $typeBody)[0] === 422 && call($api, 'mark', 'POST', $T, ['required' => 1] + $typeBody)[0] === 422 && call($api, 'mark', 'POST', $T, ['default_validity_months' => 0] + $typeBody)[0] === 422 && call($api, 'mark', 'POST', $T, ['default_validity_months' => 121] + $typeBody)[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', $T, $typeBody);
check('types: a manager creates a required type', $s === 201 && $r['type']['required'] === true && $r['type']['requires_expiry'] === true && $r['type']['version'] === 1, json_encode($r));
$tCoshh = $r['type'];
check('types: duplicate active name is 409, whoever asks', call($api, 'olga', 'POST', $T, $typeBody)[0] === 409 && call($api, 'olga', 'POST', $T, ['name' => 'coshh training'] + $typeBody)[0] === 409);
[$s, $r] = call($api, 'mark', 'POST', "$T/presets", ['key' => 'right_to_work']);
check('presets: one click adds a UK example, required', $s === 201 && $r['type']['name'] === 'Right to work check' && $r['type']['required'] === true && $r['type']['preset_key'] === 'right_to_work');
$tRtw = $r['type'];
check('presets: unknown key 422, a second time 409, staff 403', call($api, 'mark', 'POST', "$T/presets", ['key' => 'nope'])[0] === 422 && call($api, 'mark', 'POST', "$T/presets", ['key' => 'right_to_work'])[0] === 409 && call($api, 'sam', 'POST', "$T/presets", ['key' => 'dbs'])[0] === 403);
$tAid = call($api, 'mark', 'POST', "$T/presets", ['key' => 'first_aid'])[1]['type']; // not required for anyone
$list = call($api, 'mark', 'GET', $T)[1];
$pre = array_column($list['presets'], 'added', 'key');
check('presets: listed for managers with an "added" flag', $pre['right_to_work'] === true && $pre['first_aid'] === true && $pre['dbs'] === false && count($list['types']) === 3);
check('presets: not offered to staff, who still see the active types', !isset(call($api, 'sam', 'GET', $T)[1]['presets']) && count(call($api, 'sam', 'GET', $T)[1]['types']) === 3);
$U = "$T/{$tCoshh['id']}/update";
check('types: update needs the current version (422 without, 409 when stale)', call($api, 'mark', 'POST', $U, $typeBody)[0] === 422 && call($api, 'mark', 'POST', $U, $typeBody + ['expected_version' => 9])[0] === 409);
[$s, $r] = call($api, 'mark', 'POST', $U, ['description' => 'Cleaning chemicals'] + $typeBody + ['expected_version' => 1]);
check('types: updated with the right version', $s === 200 && $r['type']['version'] === 2 && $r['type']['description'] === 'Cleaning chemicals');
check('types: another organisation\'s type is 404 from there; staff cannot update', call($api, 'zed', 'POST', "/orgs/$other/document-types/{$tCoshh['id']}/update", $typeBody + ['expected_version' => 2])[0] === 404 && call($api, 'sam', 'POST', $U, $typeBody + ['expected_version' => 2])[0] === 403);
check('audit: type created and updated', $audit('document_type.created', $tCoshh['id']) === 1 && $audit('document_type.updated', $tCoshh['id']) === 1);
$tCoshh = $r['type'];

// ---- uploads -----------------------------------------------------------------------------------------------------------------------------------
$D = "/orgs/$org/documents";
$add = static fn (string $who, array $body, ?string $bytes = null, ?string $o = null) => call($GLOBALS['api'], $who, 'POST', '/orgs/' . ($o ?? $GLOBALS['org']) . '/documents', $body + ['data' => base64_encode($bytes ?? $GLOBALS['PDF'])]);
$base = ['document_type_id' => $tRtw['id']];
check('upload: a script, HTML or text is refused whatever it is called (415)', $add('sam', $base, '<?php system($_GET["c"]);')[0] === 415 && $add('sam', $base, '<html><script>alert(1)</script></html>')[0] === 415 && $add('sam', $base, "plain\n")[0] === 415);
check('upload: over 10 MB is 413; not base64 is 422', $add('sam', $base, '%PDF-1.4' . str_repeat('A', 10485761))[0] === 413 && call($api, 'sam', 'POST', $D, $base + ['data' => '!!!'])[0] === 422 && call($api, 'sam', 'POST', $D, $base)[0] === 422);
check('upload: the API takes a body that big on this route only', $add('sam', $base, '%PDF-1.4' . str_repeat('A', 10485760 - 9))[0] === 201 && call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo", ['data' => str_repeat('A', 4000000)])[0] === 413);
$pdo->exec('DELETE FROM documents'); // the big one was only to prove the limit
$pdo->exec('DELETE FROM notification_outbox');
check('documents: issue date in the future, impossible dates, expiry before issue, already expired', $add('sam', ['issued_at' => $day(1)] + $base)[0] === 422 && $add('sam', ['issued_at' => '2026-02-30'] + $base)[0] === 422 && $add('sam', ['expires_at' => '26-12-01'] + $base)[0] === 422 && $add('sam', ['issued_at' => $day(-10), 'expires_at' => $day(-20)] + $base)[0] === 422 && $add('sam', ['expires_at' => $day(-1)] + $base)[0] === 422);
check('documents: a type that needs an expiry date', $add('sam', ['document_type_id' => $tCoshh['id']])[0] === 422);
$tB = call($api, 'zed', 'POST', "/orgs/$other/document-types", ['name' => 'Bravo licence', 'required' => true])[1]['type'];
check('documents: unknown type, or another organisation\'s, is refused', $add('sam', ['document_type_id' => $other])[0] === 422 && $add('sam', ['document_type_id' => $tB['id']])[0] === 422 && $add('sam', [])[0] === 422);
check('documents: staff cannot add a document for someone else (403)', $add('sam', ['staff_profile_id' => $staff['pat']] + $base)[0] === 403);
check('documents: a member with no staff record cannot upload for themself', $add('nora', $base)[0] === 422);
check('documents: not for another organisation\'s staff record', $add('mark', ['staff_profile_id' => $zStaff] + $base)[0] === 422);
check('documents: nothing was created by the refused attempts, and no file was left behind', (int) $pdo->query('SELECT COUNT(*) FROM documents')->fetchColumn() === 0);
[$s, $r] = $add('sam', ['issued_at' => $day(-30), 'name' => 'Share code W12 345 678'] + $base);
check('documents: staff upload goes to review, not approved', $s === 201 && $r['document']['status'] === 'awaiting_review' && $r['document']['stored'] === true && !isset($r['document']['storage_path']) && $r['document']['mime'] === 'application/pdf', json_encode($r));
$dRtw = $r['document'];
$path = (string) $pdo->query("SELECT storage_path FROM documents WHERE id = '{$dRtw['id']}'")->fetchColumn();
check('documents: the file is in the person\'s own folder in the private store, mode 600', str_starts_with($path, "$org/{$staff['sam']}/") && (fileperms(test_private_root() . '/uploads/staff-documents/' . $path) & 0777) === 0600);
check('audit: upload recorded without the document\'s name or number', $audit('document.uploaded', $dRtw['id']) === 1 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE metadata LIKE '%W12%'")->fetchColumn() === 0);
check('notify: owners and managers are told a document awaits review; staff are not', $outbox('compliance/submitted', 'mark') === 1 && $outbox('compliance/submitted', 'olga') === 1 && $outbox('compliance/submitted', 'pat') === 0 && $outbox('compliance/submitted', 'sam') === 0);
[$s, $r] = $add('mark', ['staff_profile_id' => $staff['pat']] + $base);
check('documents: a manager uploads on someone\'s behalf', $s === 201 && $r['document']['staff_profile_id'] === $staff['pat'] && $r['document']['uploaded_by'] === $uid('mark'));
$dPatRtw = $r['document'];
call($api, 'mark', 'POST', "$T/{$tAid['id']}/update", ['name' => 'First aid at work', 'requires_expiry' => true, 'default_validity_months' => 36, 'expected_version' => 1]);
[$s, $r] = $add('sam', ['document_type_id' => $tAid['id'], 'issued_at' => $day(-10)]);
check('documents: the type\'s default validity fills the expiry date', $s === 201 && $r['document']['expires_at'] === (new DateTimeImmutable($day(-10)))->modify('+36 months -1 day')->format('Y-m-d'), json_encode($r));

// ---- who sees what ---------------------------------------------------------------------------------------------------------------------------
$mine = call($api, 'sam', 'GET', $D)[1]['documents'];
check('list: staff see only their own', count($mine) === 2 && array_unique(array_column($mine, 'staff_profile_id')) === [$staff['sam']]);
check('list: staff asking for someone else\'s get 404; a member with no record gets nothing', call($api, 'sam', 'GET', "$D?staff_profile_id={$staff['pat']}")[0] === 404 && call($api, 'nora', 'GET', $D)[1]['documents'] === [] && call($api, 'nora', 'GET', "$D?staff_profile_id={$staff['pat']}")[0] === 404);
check('list: a manager lists one person\'s or everyone\'s; a stranger 404', count(call($api, 'mark', 'GET', "$D?staff_profile_id={$staff['sam']}")[1]['documents']) === 2 && count(call($api, 'mark', 'GET', $D)[1]['documents']) === 3 && call($api, 'zed', 'GET', $D)[0] === 404);
$L = "$D/{$dRtw['id']}/link";
[$s, $r] = call($api, 'sam', 'GET', $L);
check('link: the person gets a link good for a minute', $s === 200 && str_starts_with($r['url'], 'https://rotaflow.example.test/api/document-files?') && strtotime($r['expires_at']) - time() <= 60 && strtotime($r['expires_at']) - time() > 50);
check('link: owner and manager may; a colleague, a member without a record and a stranger may not (404)', call($api, 'olga', 'GET', $L)[0] === 200 && call($api, 'mark', 'GET', $L)[0] === 200 && call($api, 'pat', 'GET', $L)[0] === 404 && call($api, 'nora', 'GET', $L)[0] === 404 && call($api, 'zed', 'GET', $L)[0] === 404 && call($api, 'zed', 'GET', "/orgs/$other/documents/{$dRtw['id']}/link")[0] === 404);
check('link: the person reads a document a manager uploaded for them', call($api, 'pat', 'GET', "$D/{$dPatRtw['id']}/link")[0] === 200 && call($api, 'sam', 'GET', "$D/{$dPatRtw['id']}/link")[0] === 404);
parse_str((string) parse_url($r['url'], PHP_URL_QUERY), $q);
$get = static fn (array $q) => $GLOBALS['api']->handle('GET', '/document-files', [], '', '198.51.100.5', $q);
[$s, $f] = $get($q);
check('serve: the link returns the file with its real type, not cached, no sign-in needed', $s === 200 && $f['__raw']['mime'] === 'application/pdf' && $f['__raw']['body'] === $PDF && str_contains($f['__raw']['cache'], 'no-store'));
check('serve: a changed path, expiry or signature is 404, and so is a photo link pointed here', $get(['p' => str_replace($staff['sam'], $staff['pat'], $q['p'])] + $q)[0] === 404 && $get(['e' => (string) ((int) $q['e'] + 60)] + $q)[0] === 404 && $get(['s' => str_repeat('0', 64)] + $q)[0] === 404 && $get([])[0] === 404
    && $get(['s' => Photos::sign(test_config(), FileStore::PHOTOS, $q['p'], (int) $q['e'])] + $q)[0] === 404);
$expired = time() - 5;
check('serve: an expired link is 404', $get(['e' => (string) $expired, 's' => Photos::sign(test_config(), FileStore::DOCUMENTS, $q['p'], $expired)] + $q)[0] === 404);
check('serve: a documents link does not open on the photos route', $api->handle('GET', '/files', [], '', '198.51.100.5', ['b' => FileStore::DOCUMENTS] + $q)[0] === 404);

// ---- eligibility before review --------------------------------------------------------------------------------------------------------------
$elig = static fn (string $who, string $at, ?string $o = null): array => Compliance::eligible($GLOBALS['pdo'], $o ?? $GLOBALS['org'], $GLOBALS['staff'][$who] ?? $who, $at);
$e = $elig('sam', $noon($today));
check('eligible: awaiting review does not count', $e['ok'] === false && $e['missing'] === ['COSHH training', 'Right to work check'], json_encode($e));
check('eligible: types that are not required are never listed', !in_array('First aid at work', $e['missing'], true));

// ---- review -----------------------------------------------------------------------------------------------------------------------------------
check('queue: staff cannot see it (403); a stranger 404', call($api, 'sam', 'GET', "$D/queue")[0] === 403 && call($api, 'zed', 'GET', "$D/queue")[0] === 404);
$queue = call($api, 'mark', 'GET', "$D/queue")[1]['documents'];
check('queue: awaiting review, oldest first, with names and whether this reviewer may approve', count($queue) === 3 && $queue[0]['id'] === $dRtw['id'] && $queue[0]['staff_name'] === 'Sam Smith' && $queue[0]['can_approve'] === true && $queue[1]['id'] === $dPatRtw['id'] && $queue[1]['can_approve'] === false);
$rev = static fn (string $who, array $body, string $id) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/documents/$id/review", $body);
$approve = static fn (string $who, array $doc) => $GLOBALS['rev']($who, ['decision' => 'approve', 'expected_version' => $doc['version']], $doc['id']);
check('review: staff cannot (403); a stranger 404', $rev('pat', ['decision' => 'approve', 'expected_version' => 1], $dRtw['id'])[0] === 403 && call($api, 'zed', 'POST', "/orgs/$other/documents/{$dRtw['id']}/review", ['decision' => 'approve', 'expected_version' => 1])[0] === 404);
check('review: a rejection needs a reason; an unknown decision is refused; a stale version is 409', $rev('mark', ['decision' => 'reject', 'expected_version' => 1], $dRtw['id'])[0] === 422 && $rev('mark', ['decision' => 'reject', 'reason' => 'no', 'expected_version' => 1], $dRtw['id'])[0] === 422 && $rev('mark', ['decision' => 'maybe', 'expected_version' => 1], $dRtw['id'])[0] === 422 && $rev('mark', ['decision' => 'approve', 'expected_version' => 7], $dRtw['id'])[0] === 409);
check('four eyes: the manager who uploaded for someone cannot approve it', $approve('mark', $dPatRtw)[0] === 403);
[$s, $r] = $approve('mark', $dRtw);
check('review: a manager approves', $s === 200 && $r['document']['status'] === 'approved' && $r['document']['version'] === 2 && $r['document']['reviewed_by'] === $uid('mark'));
check('review: not twice', $approve('olga', $r['document'])[0] === 409);
check('notify + audit: approval', $outbox('compliance/approved', 'sam') === 1 && $audit('document.approved', $dRtw['id']) === 1);
check('eligible: the approved document now counts', $elig('sam', $noon($today))['missing'] === ['COSHH training']);
check('four eyes: the owner may approve what a manager uploaded', $approve('olga', $dPatRtw)[0] === 200);
// COSHH: rejected, then replaced and approved
$dC1 = $add('sam', ['document_type_id' => $tCoshh['id'], 'expires_at' => $day(100)])[1]['document'];
[$s, $r] = $rev('mark', ['decision' => 'reject', 'reason' => 'Certificate is not legible', 'expected_version' => 1], $dC1['id']);
check('review: rejected with a reason, the person told', $s === 200 && $r['document']['status'] === 'rejected' && $r['document']['rejection_reason'] === 'Certificate is not legible' && $outbox('compliance/rejected', 'sam') === 1 && $audit('document.rejected', $dC1['id']) === 1);
check('eligible: rejected does not count; a rejected document cannot then be approved', $elig('sam', $noon($today))['missing'] === ['COSHH training'] && $approve('mark', $r['document'])[0] === 409);
$dC2 = $add('sam', ['document_type_id' => $tCoshh['id'], 'expires_at' => $day(100)])[1]['document'];
$approve('mia', $dC2);
check('eligible: replacement approved -> ok', $elig('sam', $noon($today)) === ['ok' => true, 'missing' => []]);
check('eligible: approved but expired at that time (valid through the expiry date)', $elig('sam', $noon($day(100)))['ok'] === true && $elig('sam', $noon($day(101))) === ['ok' => false, 'missing' => ['COSHH training']]);
check('eligible: accepts database datetimes; unknown record, another organisation\'s record or bad input is not ok', $elig('sam', $day(100) . ' 23:00:00')['ok'] === true && $elig($zStaff, $noon($today)) === ['ok' => false, 'missing' => []] && $elig('x', $noon($today))['ok'] === false && $elig('sam', 'tomorrow')['ok'] === false);
// replacing an approved document keeps history
$dRtw2 = $add('sam', ['document_type_id' => $tRtw['id'], 'issued_at' => $day(-1)])[1]['document'];
check('eligible: while a replacement awaits review the approved one still counts', $elig('sam', $noon($today))['ok'] === true);
$approve('mark', $dRtw2);
$hist = array_column(call($api, 'sam', 'GET', $D)[1]['documents'], null, 'id');
check('supersede: the earlier approved row is kept as history and points at its successor', $hist[$dRtw['id']]['status'] === 'superseded' && $hist[$dRtw['id']]['superseded_by'] === $dRtw2['id'] && $hist[$dRtw2['id']]['status'] === 'approved' && $hist[$dC1['id']]['status'] === 'rejected');
check('eligible: superseded rows do not matter, the current one does', $elig('sam', $noon($today))['ok'] === true);

// ---- own documents, drafts, withdraw ------------------------------------------------------------------------------------------------------------
[$s, $r] = $add('mark', ['document_type_id' => $tAid['id'], 'expires_at' => $day(400)]);
check('four eyes: a manager cannot review their own document; another manager can', $approve('mark', $r['document'])[0] === 403 && $rev('mark', ['decision' => 'reject', 'reason' => 'Not mine to judge', 'expected_version' => 1], $r['document']['id'])[0] === 403 && $approve('mia', $r['document'])[0] === 200);
$dOlga = $add('olga', ['document_type_id' => $tAid['id'], 'expires_at' => $day(400)])[1]['document'];
check('four eyes: nor can the owner review their own (no exception for the person)', $approve('olga', $dOlga)[0] === 403 && $approve('mark', $dOlga)[0] === 200);
[$s, $r] = $add('pat', ['document_type_id' => $tCoshh['id'], 'expires_at' => $day(50), 'submit' => false]);
check('draft: saved as uploaded, not in the queue', $s === 201 && $r['document']['status'] === 'uploaded' && !in_array($r['document']['id'], array_column(call($api, 'mark', 'GET', "$D/queue")[1]['documents'], 'id'), true));
$draft = $r['document'];
check('draft: someone else cannot submit it (404)', call($api, 'sam', 'POST', "$D/{$draft['id']}/submit")[0] === 404);
[$s, $r] = call($api, 'pat', 'POST', "$D/{$draft['id']}/submit", ['expected_version' => 1]);
check('draft: submitted for review, audited', $s === 200 && $r['document']['status'] === 'awaiting_review' && $audit('document.submitted', $draft['id']) === 1);
check('draft: cannot submit twice', call($api, 'pat', 'POST', "$D/{$draft['id']}/submit")[0] === 409);
check('withdraw: another person cannot (404); a stale version is 409', call($api, 'sam', 'POST', "$D/{$draft['id']}/withdraw")[0] === 404 && call($api, 'pat', 'POST', "$D/{$draft['id']}/withdraw", ['expected_version' => 1])[0] === 409);
[$s, $r] = call($api, 'pat', 'POST', "$D/{$draft['id']}/withdraw", ['expected_version' => 2]);
check('withdraw: the person withdraws their pending document (kept, audited)', $s === 200 && $r['document']['status'] === 'withdrawn' && $audit('document.withdrawn', $draft['id']) === 1);
check('withdraw: staff cannot withdraw an approved document; a withdrawn one cannot be reviewed', call($api, 'sam', 'POST', "$D/{$dC2['id']}/withdraw")[0] === 403 && $approve('mark', $r['document'])[0] === 409);
[$s, $r] = call($api, 'mark', 'POST', "$D/{$dC2['id']}/withdraw");
check('withdraw: a manager can remove an approved document -> no longer eligible', $s === 200 && $elig('sam', $noon($today))['missing'] === ['COSHH training']);
$dC3 = $add('sam', ['document_type_id' => $tCoshh['id'], 'expires_at' => $day(20)])[1]['document'];
$approve('mark', $dC3);

// ---- rows moved from before review existed ------------------------------------------------------------------------------------------------------
$legacy = Db::uuid();
$pdo->prepare('INSERT INTO documents (id, org_id, staff_profile_id, type, name, file_url, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([$legacy, $org, $staff['ivy'], 'right to work check', 'Passport', 'https://files.example.test/ivy-passport.pdf', $day(200)]);
check('moved rows: status defaults to approved', $pdo->query("SELECT status FROM documents WHERE id = '$legacy'")->fetchColumn() === 'approved');
check('moved rows: a row whose free-text type names a required type counts for it', $elig('ivy', $noon($today))['missing'] === ['COSHH training']);
check('moved rows: the pasted link is returned as it is, to a manager', call($api, 'mark', 'GET', "$D/$legacy/link")[1]['url'] === 'https://files.example.test/ivy-passport.pdf');
$bad = static function (string $sql, array $args) use ($pdo): bool { try { $pdo->prepare($sql)->execute($args); return false; } catch (PDOException) { return true; } };
check('schema: a row holds exactly one of a link and a stored file, and a stored file sits in its own folder', $bad('INSERT INTO documents (id, org_id, staff_profile_id, type, name) VALUES (?, ?, ?, ?, ?)', [Db::uuid(), $org, $staff['ivy'], 'x', 'x'])
    && $bad('INSERT INTO documents (id, org_id, staff_profile_id, type, name, storage_path) VALUES (?, ?, ?, ?, ?, ?)', [Db::uuid(), $org, $staff['ivy'], 'x', 'x', "$org/{$staff['sam']}/f.pdf"])
    && $bad('INSERT INTO documents (id, org_id, staff_profile_id, type, name, file_url) VALUES (?, ?, ?, ?, ?, ?)', [Db::uuid(), $other, $staff['ivy'], 'x', 'x', 'https://x.example']));

// ---- timezone ---------------------------------------------------------------------------------------------------------------------------------------
$pdo->prepare("UPDATE organisations SET timezone = 'Pacific/Auckland' WHERE id = ?")->execute([$other]);
$zt = R::today('Pacific/Auckland');
$dZ = $add('zed', ['document_type_id' => $tB['id'], 'staff_profile_id' => $zStaff, 'expires_at' => R::addDays($zt, 30)], null, $other)[1]['document'];
check('timezone: another organisation\'s manager cannot touch it', $rev('mark', ['decision' => 'approve', 'expected_version' => 1], $dZ['id'])[0] === 404);
$pdo->prepare("UPDATE documents SET status = 'approved', expires_at = '2027-03-10' WHERE id = ?")->execute([$dZ['id']]);
check('timezone: eligible until local midnight in the organisation\'s zone (Auckland)', Compliance::eligible($pdo, $other, $zStaff, '2027-03-10T10:59:59Z')['ok'] === true && Compliance::eligible($pdo, $other, $zStaff, '2027-03-10T11:00:00Z') === ['ok' => false, 'missing' => ['Bravo licence']]);

// ---- my documents and the summary -------------------------------------------------------------------------------------------------------------------
$pdo->prepare('UPDATE documents SET expires_at = ? WHERE id = ?')->execute([$day(-1), $dPatRtw['id']]);
$pat = array_column(call($api, 'pat', 'GET', $D)[1]['documents'], null, 'id');
check('status: a past-dated approved document is reported as expired', $pat[$dPatRtw['id']]['status'] === 'expired' && $pat[$dPatRtw['id']]['stored_status'] === 'approved');
$me = call($api, 'pat', 'GET', "/orgs/$org/compliance/me")[1];
check('my documents: requirement states (missing, expired)', array_column($me['requirements'], 'state', 'name') === ['COSHH training' => 'missing', 'Right to work check' => 'expired'] && $me['counts']['eligible'] === false && $me['staff_profile_id'] === $staff['pat'], json_encode($me));
check('my documents: expiring within 30 days and approved', array_column(call($api, 'sam', 'GET', "/orgs/$org/compliance/me")[1]['requirements'], 'state', 'name') === ['COSHH training' => 'expiring', 'Right to work check' => 'approved']);
check('my documents: a member with no record has nothing required; a stranger 404', call($api, 'nora', 'GET', "/orgs/$org/compliance/me")[1]['requirements'] === [] && call($api, 'zed', 'GET', "/orgs/$org/compliance/me")[0] === 404);
$sum = call($api, 'mark', 'GET', "/orgs/$org/compliance/summary")[1];
$people = array_column($sum['people'], null, 'staff_profile_id');
check('summary: organisation counts', $sum['scope'] === 'org' && $sum['counts']['people'] === 5 && $sum['counts']['expiring'] === 1 && $sum['counts']['expired'] === 1 && $sum['counts']['not_eligible'] === 4, json_encode($sum['counts']));
check('summary: each person\'s eligibility for the rota chip', $people[$staff['sam']]['eligible'] === true && $people[$staff['sam']]['expiring'][0]['name'] === 'COSHH training' && $people[$staff['pat']]['missing'] === ['COSHH training', 'Right to work check'] && $people[$staff['ivy']]['missing'] === ['COSHH training']);
check('summary: by type', count($sum['by_type']) === 2 && array_column($sum['by_type'], 'approved', 'name')['Right to work check'] === 2);
check('summary: staff see only their own numbers', call($api, 'sam', 'GET', "/orgs/$org/compliance/summary")[1]['scope'] === 'me' && !isset(call($api, 'sam', 'GET', "/orgs/$org/compliance/summary")[1]['people']));

// ---- archive --------------------------------------------------------------------------------------------------------------------------------------------
check('archive: stale version refused; staff refused', call($api, 'mark', 'POST', "$T/{$tCoshh['id']}/archive", ['expected_version' => 9])[0] === 409 && call($api, 'sam', 'POST', "$T/{$tCoshh['id']}/archive", ['expected_version' => 2])[0] === 403);
check('archive: an archived type is no longer required, nor offered for upload', call($api, 'mark', 'POST', "$T/{$tCoshh['id']}/archive", ['expected_version' => 2])[0] === 200 && $elig('pat', $noon($today))['missing'] === ['Right to work check'] && $add('sam', ['document_type_id' => $tCoshh['id'], 'expires_at' => $day(30)])[0] === 422 && $audit('document_type.archived', $tCoshh['id']) === 1);
check('archive: an archived type cannot be updated', call($api, 'mark', 'POST', "$T/{$tCoshh['id']}/update", $typeBody + ['expected_version' => 3])[0] === 409);

// ---- platform support and suspended organisations ----------------------------------------------------------------------------------------------------
call($api, 'sue', 'GET', '/me');
$pdo->prepare("INSERT INTO platform_admins (user_id, role) VALUES (?, 'platform_support')")->execute([$uid('sue')]);
$pdo->prepare('UPDATE organisations SET support_access_allowed = 1 WHERE id = ?')->execute([$org]);
$pdo->prepare("INSERT INTO support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, expires_at) VALUES (?, ?, ?, 'The customer asked for help with their rota', 'CASE-4120', 'read_write', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))")->execute([Db::uuid(), $org, $uid('sue')]);
check('support: a live support session reaches the organisation but not its documents', call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 200 && call($api, 'sue', 'GET', $D)[0] === 403 && call($api, 'sue', 'GET', "$D/queue")[0] === 403 && call($api, 'sue', 'GET', "$D/{$dRtw['id']}/link")[0] === 403 && call($api, 'sue', 'GET', $T)[0] === 403);
$pdo->prepare("UPDATE organisations SET status = 'suspended' WHERE id = ?")->execute([$other]);
check('suspended: no uploads or new types; reading still works', ($x = $add('zed', ['document_type_id' => $tB['id'], 'staff_profile_id' => $zStaff], null, $other)) && $x[1]['error']['code'] === 'org_not_active' && call($api, 'zed', 'POST', "/orgs/$other/document-types", ['name' => 'Another'])[1]['error']['code'] === 'org_not_active' && call($api, 'zed', 'GET', "/orgs/$other/documents")[0] === 200);
$pdo->prepare("UPDATE organisations SET status = 'active' WHERE id = ?")->execute([$other]);

// ---- expiry reminders ------------------------------------------------------------------------------------------------------------------------------------
$pdo->exec('DELETE FROM document_reminders');
$tPass = call($api, 'mark', 'POST', $T, ['name' => 'Building pass', 'requires_expiry' => true])[1]['type'];
$exp = $day(40);
$dP = $add('pat', ['document_type_id' => $tPass['id'], 'expires_at' => $exp])[1]['document'];
$approve('mark', $dP);
$stages = static function (string $doc) use ($pdo): array {
    $q = $pdo->prepare('SELECT stage FROM document_reminders WHERE document_id = ? ORDER BY sent_at, stage');
    $q->execute([$doc]);
    return $q->fetchAll(PDO::FETCH_COLUMN);
};
$at = static fn (int $before): string => $noon(R::addDays($exp, -$before));
$patTold = static fn (string $kind = 'compliance/expiring') => $outbox($kind, 'pat', 'Building pass');
Compliance::runReminders($pdo, $at(31));
check('cron: nothing 31 days before', $stages($dP['id']) === []);
Compliance::runReminders($pdo, $at(30));
check('cron: the 30-day reminder', $stages($dP['id']) === ['d30'] && $patTold() === 1);
Compliance::runReminders($pdo, $at(30));
Compliance::runReminders($pdo, $at(20));
check('cron: running again (same day, a later day) sends no duplicate', $stages($dP['id']) === ['d30'] && $patTold() === 1);
Compliance::runReminders($pdo, $at(14));
check('cron: the 14-day reminder to the person and to owners and managers', $stages($dP['id']) === ['d30', 'd14'] && $patTold() === 2 && $outbox('compliance/expiring', 'mark', 'Building pass') === 2 && $outbox('compliance/expiring', 'olga', 'Building pass') === 2);
check('cron: not to colleagues or to a member with no record', $outbox('compliance/expiring', 'sam', 'Building pass') === 0 && $outbox('compliance/expiring', 'nora', 'Building pass') === 0);
check('cron: the reminder names the type, the person and the days left', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.title')) = 'Building pass expires in 14 days for Pat Smith'")->fetchColumn() === 1);
Compliance::runReminders($pdo, $at(7));
Compliance::runReminders($pdo, $at(0));
check('cron: the 7-day reminder once, nothing more on the last valid day', $stages($dP['id']) === ['d30', 'd14', 'd7'] && $patTold() === 3);
Compliance::runReminders($pdo, $at(-1));
Compliance::runReminders($pdo, $at(-1));
Compliance::runReminders($pdo, $at(-5));
check('cron: the expired notice exactly once, the day after expiry, to the person and to managers', $stages($dP['id']) === ['d30', 'd14', 'd7', 'expired'] && $outbox('compliance/expired', 'pat', 'Building pass') === 1 && $outbox('compliance/expired', 'mark', 'Building pass') === 1);
// missed runs: only the most urgent stage is sent
$dP2 = $add('sam', ['document_type_id' => $tPass['id'], 'expires_at' => $exp])[1]['document'];
$approve('mark', $dP2);
Compliance::runReminders($pdo, $at(5));
check('cron: catching up sends only the most urgent stage', $stages($dP2['id']) === ['d7']);
// the organisation's timezone decides "days before" (Auckland; expiry 10 March 2027 local)
Compliance::runReminders($pdo, '2027-02-07T10:59:00Z'); // 7 Feb 23:59 in Auckland: 31 days left
check('cron timezone: 31 local days before -> nothing', $stages($dZ['id']) === []);
Compliance::runReminders($pdo, '2027-02-07T11:00:00Z'); // still 7 Feb in UTC, but 8 Feb 00:00 in Auckland: 30 days left
check('cron timezone: local midnight starts the 30-day reminder; only that organisation\'s managers hear', $stages($dZ['id']) === ['d30'] && $outbox('compliance/expiring', 'zed', 'Bravo licence') === 1 && $outbox('compliance/expiring', 'mark', 'Bravo licence') === 0);
// a person with no login: managers are still told
$dIvy = $add('mark', ['staff_profile_id' => $staff['ivy'], 'document_type_id' => $tPass['id'], 'expires_at' => $day(10)])[1]['document'];
$approve('olga', $dIvy);
Compliance::runReminders($pdo, $noon($today));
check('cron: a record with no login still alerts the managers (the old expiring-document alert, folded in)', $stages($dIvy['id']) === ['d14'] && $outbox('compliance/expiring', 'mia', 'for Ivy Nologin') === 1);
check('cron: a moved row with an expiry date is reminded too', $stages($legacy) === [] && (Compliance::runReminders($pdo, $noon(R::addDays($day(200), -7))) >= 1) && in_array('d7', $stages($legacy), true));
// deactivated staff and archived types are skipped; superseded rows are skipped
$dSamAid = $add('sam', ['document_type_id' => $tAid['id'], 'expires_at' => $day(300)])[1]['document'];
$approve('mark', $dSamAid);
$pdo->prepare('UPDATE staff_profiles SET active = 0 WHERE id = ?')->execute([$staff['sam']]);
Compliance::runReminders($pdo, $noon(R::addDays($day(300), -5)));
check('cron: deactivated staff get no reminders', $stages($dSamAid['id']) === []);
$pdo->prepare('UPDATE staff_profiles SET active = 1 WHERE id = ?')->execute([$staff['sam']]);
// the real entry point: once a quarter-hour, through bin/cron.php
$ctx = test_ctx($pdo);
@unlink(test_private_root() . '/cache/compliance-reminders.stamp');
$t0 = time();
check('cron(): runs, then is not due again for fifteen minutes', preg_match('/^expiry reminders sent for \d+ document stage\(s\)$/', Compliance::cron($ctx, $t0)) === 1 && Compliance::cron($ctx, $t0 + 600) === 'expiry reminders: not due' && str_starts_with(Compliance::cron($ctx, $t0 + 900), 'expiry reminders sent'));
global $host, $port, $name, $user, $pass;
file_put_contents(test_private_root() . '/config/config.php', "<?php return ['dsn'=>'mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4','user'=>'$user','password'=>'$pass'];");
@unlink(test_private_root() . '/cache/compliance-reminders.stamp');
exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg(test_private_root()) . ' php ' . escapeshellarg(__DIR__ . '/../../bin/cron.php') . ' 2>&1', $cronOut, $cronRc);
check('cron runner: Compliance runs under bin/cron.php', str_contains(implode("\n", $cronOut), 'Compliance: expiry reminders sent'), implode(' | ', $cronOut));

// ---- erasure and deleting the organisation ---------------------------------------------------------------------------------------------------------------
$patFiles = (int) $pdo->query("SELECT COUNT(*) FROM documents WHERE staff_profile_id = '{$staff['pat']}'")->fetchColumn();
check('erasure: an owner erases a person; their documents and reminders go, and their folder is queued', $patFiles > 0 && call($api, 'olga', 'POST', "/orgs/$org/staff/{$staff['pat']}/erase")[0] === 200
    && (int) $pdo->query("SELECT COUNT(*) FROM documents WHERE staff_profile_id = '{$staff['pat']}'")->fetchColumn() === 0
    && (int) $pdo->query("SELECT COUNT(*) FROM document_reminders WHERE document_id = '{$dP['id']}'")->fetchColumn() === 0
    && (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE bucket = 'staff-documents' AND path = '$org/{$staff['pat']}' AND is_folder = 1")->fetchColumn() === 1);
$store = FileStore::forCtx($ctx);
RotaFlow\Mod\Lifecycle::cron($ctx);
check('erasure: cron then removes the files', !is_dir(test_private_root() . "/uploads/staff-documents/$org/{$staff['pat']}") && $store->exists(FileStore::DOCUMENTS, $path));
[$s] = call($api, 'zed', 'POST', "/orgs/$other/delete", ['confirm_name' => 'Elsewhere']);
check('deleting an organisation with types, documents and reminders works', $s === 200 && (int) $pdo->query("SELECT COUNT(*) FROM documents WHERE org_id = '$other'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM document_types WHERE org_id = '$other'")->fetchColumn() === 0, (string) $s);
$pdo->exec("UPDATE feature_flags SET enabled = 0, rollout = 0 WHERE flag_key = 'staff_documents'");
check('switched off again, the routes refuse at once', call($api, 'olga', 'GET', "/orgs/$org/documents/queue")[1]['error']['code'] === 'feature_off' && call($api, 'olga', 'GET', "/orgs/$org/documents")[0] === 200);
check('the migration ships the flag off, and off the features list no longer offers it', str_contains((string) file_get_contents(dirname(__DIR__, 2) . '/migrations/015-compliance.sql'), "'staff_documents'") && (int) $pdo->query("SELECT enabled FROM feature_flags WHERE flag_key = 'staff_documents'")->fetchColumn() === 0 && !in_array('staff_documents', array_column(call($api, 'olga', 'GET', "/orgs/$org/features")[1]['features'], 'feature'), true));
