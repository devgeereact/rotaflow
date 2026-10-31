<?php
declare(strict_types=1);

// The open-shifts list tells the caller, before they press Take it, whether the claim would refuse them for eligibility and why (owner
// decision, 31 Oct 2026): `my_eligibility` on each row, the caller's own reasons only, the same reasons the claim gives, whatever the
// cover_tools flag says (the claim's check always applies). Leave, declared unavailability, a missing required document, a clash, being
// the absentee and an inactive record each show; nobody sees anyone else's; a member with no staff record gets null.
use RotaFlow\{Db, Mod\Cover, SchedulingRules};

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Open Board Org'])[1]['org']['id'];
call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere']);
$staff = [];
$names = ['mark' => 'Manning', 'pat' => 'Parkinson', 'eve' => 'Evans', 'fay' => 'Fairley', 'sam' => 'Samson', 'dee' => 'Deakin', 'ina' => 'Ingram', 'gus' => 'Gustafsson'];
foreach ($names as $who => $last) {
    call($api, $who, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $who === 'mark' ? 'manager' : 'staff', "$who@example.test"]);
    $staff[$who] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($who), 'last_name' => $last, 'email' => "$who@example.test"])[1]['id'];
}
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Elm Court', 'timezone' => 'Europe/London'])[1]['id'];
$day = static fn (int $n): string => gmdate('Y-m-d', time() + $n * 86400);
$at = static fn (int $n, string $hm): string => $day($n) . "T$hm:00Z";
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Board weeks', 'period_start' => $day(4), 'period_end' => $day(12), 'location_id' => $site])[1]['rota']['id'];
$mk = static function (?string $who, int $n, string $a = '09:00', string $b = '17:00') use ($api, $org, $rota, $staff, $site, $at): string {
    [$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'location_id' => $site, 'staff_profile_id' => $who === null ? null : $staff[$who], 'starts_at' => $at($n, $a), 'ends_at' => $at($n, $b), 'status' => $who === null ? 'open' : 'assigned']);
    return $s === 201 ? $r['shift']['id'] : 'failed ' . json_encode($r);
};
$O = ['O5' => $mk(null, 5), 'O6' => $mk(null, 6), 'O7' => $mk(null, 7), 'O8' => $mk(null, 8), 'O9' => $mk(null, 9)];
$samsOwn = $mk('sam', 7, '12:00', '20:00'); // overlaps O7
check('fixtures: shifts created and the rota published', count(array_filter([...$O, $samsOwn], static fn (string $v): bool => str_starts_with($v, 'failed'))) === 0 && call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish")[0] === 200);
// pat: approved leave on day 5; eve: unavailable on day 6; fay: no DBS; dee: the absentee on O8 (an open cover request names her); ina: inactive.
$lv = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['pat'], 'start_date' => $day(5), 'end_date' => $day(5)])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lv/review", ['status' => 'approved']);
$pdo->prepare("INSERT INTO availability (id, org_id, staff_profile_id, date, status) VALUES (?, ?, ?, ?, 'unavailable')")->execute([Db::uuid(), $org, $staff['eve'], $day(6)]);
$dbs = Db::uuid();
$pdo->prepare("INSERT INTO document_types (id, org_id, name, required) VALUES (?, ?, 'DBS check', 1)")->execute([$dbs, $org]);
$olgaStaff = (string) $pdo->query("SELECT s.id FROM staff_profiles s JOIN users u ON u.id = s.user_id WHERE s.org_id = '$org' AND u.email = 'olga@example.test'")->fetchColumn();
foreach ([...array_values(array_diff_key($staff, ['fay' => 1])), $olgaStaff] as $sp) {
    $pdo->prepare("INSERT INTO documents (id, org_id, staff_profile_id, document_type_id, type, name, file_url, status) VALUES (?, ?, ?, ?, 'DBS check', 'DBS', 'https://example.test/dbs.pdf', 'approved')")->execute([Db::uuid(), $org, $sp, $dbs]);
}
$pdo->prepare("INSERT INTO cover_requests (id, org_id, shift_id, status, open_shift_id, absent_staff_profile_id) VALUES (?, ?, ?, 'open', ?, ?)")->execute([Db::uuid(), $org, $O['O8'], $O['O8'], $staff['dee']]);
$pdo->prepare('UPDATE staff_profiles SET active = 0 WHERE id = ?')->execute([$staff['ina']]);
$flag = static fn (bool $on) => $GLOBALS['pdo']->exec('UPDATE feature_flags SET enabled = ' . ($on ? 1 : 0) . ', rollout = ' . ($on ? 100 : 0) . " WHERE flag_key = 'cover_tools'");
$board = static function (string $who) use ($api, $org): array {
    [$s, $r] = call($api, $who, 'GET', "/orgs/$org/open-shifts");
    return $s === 200 ? array_column($r['open_shifts'], null, 'shift_id') : ['status' => $s];
};
$codes = static fn (array $row): array => array_column($row['my_eligibility']['reasons'] ?? [], 'code');

// ---- with cover_tools off (seeded off): the reasons are there before the click ---------------------------------------------------------------
check('cover_tools is off', $pdo->query("SELECT enabled FROM feature_flags WHERE flag_key = 'cover_tools'")->fetchColumn() === 0 || $pdo->query("SELECT enabled FROM feature_flags WHERE flag_key = 'cover_tools'")->fetchColumn() === '0');
$b = $board('gus');
check('rows keep every old field and gain only my_eligibility', array_keys($b[$O['O5']]) === ['shift_id', 'starts_at', 'ends_at', 'break_minutes', 'notes', 'shift_type', 'location_name', 'clashes_with_mine', 'my_eligibility'], json_encode(array_keys($b[$O['O5']])));
check('an eligible person: every shift eligible, no reasons', count($b) === 5 && array_filter($b, static fn (array $r): bool => $r['my_eligibility'] !== ['eligible' => true, 'reasons' => []]) === []);
$p = $board('pat');
check('leave: pat cannot take the day-5 shift, in plain words; the others are open to her', $p[$O['O5']]['my_eligibility']['eligible'] === false && $codes($p[$O['O5']]) === ['leave'] && str_starts_with($p[$O['O5']]['my_eligibility']['reasons'][0]['message'], 'On approved ') && $p[$O['O6']]['my_eligibility']['eligible'] === true, json_encode($p[$O['O5']]['my_eligibility']));
check('declared unavailable: eve, day 6 only', $codes($board('eve')[$O['O6']]) === ['unavailable'] && $board('eve')[$O['O5']]['my_eligibility']['eligible'] === true);
// Owner decision (31 Oct 2026): the document check follows staff_documents (seeded off): with it off nobody can upload, so a
// missing document shows nothing and blocks nothing; with it on the required document is checked as before.
$docs = static fn (bool $on) => $GLOBALS['pdo']->exec('UPDATE feature_flags SET enabled = ' . ($on ? 1 : 0) . ', rollout = ' . ($on ? 100 : 0) . " WHERE flag_key = 'staff_documents'");
$f = $board('fay');
check('staff_documents off: fay is eligible on every shift, though a required type exists', count($f) === 5 && array_filter($f, static fn (array $r): bool => $r['my_eligibility'] !== ['eligible' => true, 'reasons' => []]) === [], json_encode(array_column($f, 'my_eligibility')));
check('staff_documents off: the other reasons are unchanged (pat on leave)', $codes($board('pat')[$O['O5']]) === ['leave']);
$docs(true);
$f = $board('fay');
check('a missing required document: fay, on every shift, naming the document', array_filter($f, static fn (array $r): bool => $r['my_eligibility']['reasons'] !== [['code' => 'documents', 'message' => 'Missing or expired: DBS check']]) === []);
$sb = $board('sam');
check('a clash: sam\'s own shift overlaps day 7 (overlap reason, and clashes_with_mine as before)', $codes($sb[$O['O7']]) === ['overlap'] && $sb[$O['O7']]['clashes_with_mine'] === true && $sb[$O['O6']]['my_eligibility']['eligible'] === true);
check('the absentee: dee, on the shift she said she cannot work', $codes($board('dee')[$O['O8']]) === ['absent'] && $board('dee')[$O['O9']]['my_eligibility']['eligible'] === true);
check('an inactive record: every shift says so', array_filter($board('ina'), static fn (array $r): bool => $r['my_eligibility']['eligible'] !== false || !in_array('inactive', array_column($r['my_eligibility']['reasons'], 'code'), true)) === []);

// The list says exactly what the claim would say.
$agree = [];
foreach (array_keys($staff) as $who) {
    $rows = $board($who);
    foreach ($O as $label => $id) {
        $q = $pdo->prepare('SELECT s.*, l.timezone AS loc_tz FROM shifts s LEFT JOIN locations l ON l.id = s.location_id WHERE s.id = ?');
        $q->execute([$id]);
        $sh = $q->fetch();
        $sh['timezone'] = SchedulingRules::validZone($sh['loc_tz']) ? $sh['loc_tz'] : null;
        $want = Cover::assess($pdo, $org, $staff[$who], $sh, false)['reasons'];
        if (($rows[$id]['my_eligibility']['reasons'] ?? null) !== $want) {
            $agree[] = "$who $label";
        }
    }
}
check('for every person and every shift the reasons equal the claim\'s own check (Cover::assess)', $agree === [], implode(', ', $agree));
[$s, $r] = call($api, 'pat', 'POST', "/orgs/$org/open-shifts/{$O['O5']}/claim");
check('and the claim refuses with the same sentence', $s === 409 && $r['error']['code'] === 'not_eligible' && $r['error']['message'] === 'You cannot take this shift: ' . implode('; ', array_column($p[$O['O5']]['my_eligibility']['reasons'], 'message')), json_encode($r));

// ---- nobody sees anyone else's -----------------------------------------------------------------------------------------------------------
$raw = json_encode(call($api, 'gus', 'GET', "/orgs/$org/open-shifts")[1]);
$others = array_values(array_diff_key($staff, ['gus' => 1]));
$leak = array_filter([...$others, ...array_values(array_diff_key($names, ['gus' => 1])), 'approved', 'holiday', 'unavailable', 'DBS', 'Missing', 'Said they', 'inactive', 'Already working'], static fn (string $needle): bool => str_contains((string) $raw, $needle));
check('leak: an eligible colleague\'s list carries no other person\'s id, name, leave, unavailability, documents or absence', $leak === [], json_encode(array_values($leak)));
$praw = json_encode(call($api, 'pat', 'GET', "/orgs/$org/open-shifts")[1]);
check('leak: pat\'s list carries her own leave and nothing of eve\'s, fay\'s, sam\'s, dee\'s or ina\'s', !str_contains((string) $praw, 'DBS') && !str_contains((string) $praw, 'unavailable') && !str_contains((string) $praw, 'Said they') && array_filter($others, static fn (string $id): bool => str_contains((string) $praw, $id)) === []);
call($api, 'nora', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]);
check('a member with no staff record gets null on every row', array_filter($board('nora'), static fn (array $r): bool => $r['my_eligibility'] !== null) === [] && count($board('nora')) === 5);
check('the manager with a staff record sees only their own (eligible everywhere)', array_filter($board('mark'), static fn (array $r): bool => $r['my_eligibility'] !== ['eligible' => true, 'reasons' => []]) === []);
check('a stranger 404, nobody 401', call($api, 'zed', 'GET', "/orgs/$org/open-shifts")[0] === 404 && call($api, '', 'GET', "/orgs/$org/open-shifts")[0] === 401);

// ---- the same with cover_tools on -------------------------------------------------------------------------------------------------------
$offPat = json_encode($board('pat'));
$offFay = json_encode($board('fay'));
$flag(true);
check('cover_tools on: the same answers (the claim\'s check does not depend on the flag)', json_encode($board('pat')) === $offPat && json_encode($board('fay')) === $offFay);
$flag(false);
