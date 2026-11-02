<?php
declare(strict_types=1);

// Staff records, the column rule, self-edit limits, job titles, site assignment, pay rates and emergency contacts.
use RotaFlow\Db;

$api = test_api($pdo);
$uuid = '11111111-2222-4333-8444-555555555555';
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Staff Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$member = static function (string $name, string $role) use ($pdo, $api, $org): string {
    call($api, $name, 'GET', '/me');
    $u = (string) $pdo->query("SELECT id FROM users WHERE email = '$name@example.test'")->fetchColumn();
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, ?, 'active')")->execute([Db::uuid(), $org, $u, $role]);
    return $u;
};
$member('mark', 'manager');
$sam = $member('sam', 'staff');
$member('pat', 'staff');

// ---- the founder has a staff record -----------------------------------------------------------------------
$f = $pdo->query("SELECT first_name, last_name, email, active FROM staff_profiles WHERE org_id = '$org'")->fetchAll();
check('the founder gets a staff record from their email', count($f) === 1 && $f[0]['first_name'] === 'olga' && $f[0]['email'] === 'olga@example.test' && (int) $f[0]['active'] === 1, json_encode($f));

// ---- creating ------------------------------------------------------------------------------------------------
check('staff cannot create staff records', call($api, 'sam', 'POST', "/orgs/$org/staff", ['first_name' => 'X'])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/staff", ['first_name' => 'X'])[0] === 404);
check('a first name is required', call($api, 'olga', 'POST', "/orgs/$org/staff", ['last_name' => 'X'])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Sam', 'last_name' => 'Stone', 'email' => 'Sam@Example.test', 'phone' => '07700 900123', 'payroll_id' => 'P-100', 'weekly_hours' => 37.5, 'holiday_allowance' => 28, 'contract_type' => 'full_time', 'skills' => ['first aid', 'moving and handling'], 'start_date' => '2025-03-01']);
check('a manager creates a record', $s === 201, json_encode($r));
$samStaff = $r['id'];
check('a record whose email matches a member without one is linked to that login', $pdo->query("SELECT user_id FROM staff_profiles WHERE id = '$samStaff'")->fetchColumn() === $sam);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Pat', 'last_name' => 'Park', 'email' => 'pat@example.test', 'phone' => '07700 900456', 'payroll_id' => 'P-101']);
$patStaff = $r['id'];
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Dee', 'last_name' => 'Dunn', 'phone' => '07700 900789', 'payroll_id' => 'P-102', 'holiday_allowance' => 20]);
$deeStaff = $r['id'];
check('a duplicate payroll id is 409', call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Eve', 'payroll_id' => 'P-100'])[1]['error']['code'] === 'payroll_id_taken');
check('the same payroll id in another organisation is fine', call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe', 'payroll_id' => 'P-100'])[0] === 201);
foreach ([['first_name' => 'X', 'email' => 'bad'], ['first_name' => 'X', 'weekly_hours' => 200], ['first_name' => 'X', 'phone' => 'abc'], ['first_name' => 'X', 'skills' => 'first aid'], ['first_name' => 'X', 'skills' => [1]], ['first_name' => 'X', 'start_date' => '2025-02-30'], ['first_name' => 'X', 'contract_type' => 'Full Time!'], ['first_name' => 'X', 'photo_url' => 'http://insecure.example/p.jpg'], ['first_name' => ['x']]] as $i => $bad) {
    check("a malformed staff field is 422 ($i)", call($api, 'olga', 'POST', "/orgs/$org/staff", $bad)[0] === 422);
}
$zDept = call($api, 'zed', 'POST', "/orgs/$other/departments", ['name' => 'Z Dept'])[1]['id'];
check('a department from another organisation is refused', call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'X', 'department_id' => $zDept])[0] === 422);

// ---- reading: the column rule -------------------------------------------------------------------------------
[, $r] = call($api, 'pat', 'GET', "/orgs/$org/staff");
$by = array_column($r['staff'], null, 'id');
check('a colleague sees names, skills and hours', $by[$samStaff]['first_name'] === 'Sam' && $by[$samStaff]['skills'] === ['first aid', 'moving and handling'] && $by[$samStaff]['weekly_hours'] == 37.5);
check('but not another person\'s payroll id, phone, email, start date or holiday allowance', $by[$samStaff]['payroll_id'] === null && $by[$samStaff]['phone'] === null && $by[$samStaff]['email'] === null && $by[$samStaff]['start_date'] === null && $by[$samStaff]['holiday_allowance'] === null);
check('they see their own sensitive fields', $by[$patStaff]['payroll_id'] === 'P-101' && $by[$patStaff]['phone'] === '07700 900456' && $by[$patStaff]['email'] === 'pat@example.test');
[, $r] = call($api, 'mark', 'GET', "/orgs/$org/staff/$samStaff");
check('a manager sees everything', $r['staff']['payroll_id'] === 'P-100' && $r['staff']['phone'] === '07700 900123' && $r['staff']['start_date'] === '2025-03-01');
check('the private photo path is never returned', !array_key_exists('photo_path', $r['staff']));
check('a stranger cannot read staff', call($api, 'zed', 'GET', "/orgs/$org/staff")[0] === 404);
check('a staff id from another organisation is 404', call($api, 'olga', 'GET', "/orgs/$org/staff/" . $pdo->query("SELECT id FROM staff_profiles WHERE org_id = '$other' LIMIT 1")->fetchColumn())[0] === 404);
call($api, 'mark', 'POST', "/orgs/$org/staff/$deeStaff", ['active' => false]);
check('the active filter hides leavers', count(call($api, 'pat', 'GET', "/orgs/$org/staff?active=1")[1]['staff']) === count(call($api, 'pat', 'GET', "/orgs/$org/staff")[1]['staff']) - 1);

// ---- updating: managers, and the self-edit limit --------------------------------------------------------------
check('a manager edits a record', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff", ['weekly_hours' => 30])[0] === 200 && (float) $pdo->query("SELECT weekly_hours FROM staff_profiles WHERE id = '$samStaff'")->fetchColumn() === 30.0);
check('a person updates their own phone', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['phone' => '07700 111111'])[0] === 200 && $pdo->query("SELECT phone FROM staff_profiles WHERE id = '$samStaff'")->fetchColumn() === '07700 111111');
// A self-set photo link is refused (audit CS-03): people upload their photo; a link to any host was a tracking image.
check('but not a photo link', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['photo_url' => 'https://img.example.test/sam.jpg'])[0] === 403);
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['first_name' => 'Samuel']);
check('but not their own name', $s === 403 && $r['error']['code'] === 'self_edit_restricted', json_encode($r));
check('nor their hours, payroll id, or active flag', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['weekly_hours' => 60])[0] === 403 && call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['payroll_id' => 'P-999'])[0] === 403 && call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['active' => false])[0] === 403);
check('sending unchanged values alongside the phone is fine', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff", ['first_name' => 'Sam', 'weekly_hours' => 30, 'skills' => ['first aid', 'moving and handling'], 'phone' => '07700 222222'])[0] === 200);
check('nobody edits a colleague\'s record', call($api, 'sam', 'POST', "/orgs/$org/staff/$patStaff", ['phone' => '07700 000000'])[0] === 403);
check('a stranger gets 404 updating', call($api, 'zed', 'POST', "/orgs/$org/staff/$samStaff", ['phone' => '07700 000000'])[0] === 404);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff", ['payroll_id' => 'P-555']);
check('a payroll id cannot change once set', $s === 409 && $r['error']['code'] === 'payroll_id_locked', json_encode($r));
check('re-sending the same payroll id is harmless', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff", ['payroll_id' => 'P-100'])[0] === 200);
check('a payroll id can be set where there was none', call($api, 'mark', 'POST', "/orgs/$org/staff/" . $pdo->query("SELECT id FROM staff_profiles WHERE org_id = '$org' AND payroll_id IS NULL LIMIT 1")->fetchColumn(), ['payroll_id' => 'P-300'])[0] === 200);
check('the login a record belongs to cannot be reassigned through the API', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff", ['user_id' => Db::uuid()])[0] === 200 && $pdo->query("SELECT user_id FROM staff_profiles WHERE id = '$samStaff'")->fetchColumn() === $sam);

// ---- job titles -----------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/job-titles", ['name' => 'Care Assistant', 'colour' => 'teal']);
check('the owner creates a job title', $s === 201, json_encode($r));
$title = $r['id'];
check('a manager cannot by default', call($api, 'mark', 'POST', "/orgs/$org/job-titles", ['name' => 'Cook'])[0] === 403);
$pdo->prepare("UPDATE organisations SET settings = JSON_OBJECT('job_titles_managed_by', 'managers') WHERE id = ?")->execute([$org]);
check('a manager can once the organisation allows it', call($api, 'mark', 'POST', "/orgs/$org/job-titles", ['name' => 'Cook', 'colour' => 'amber'])[0] === 201);
check('staff never can', call($api, 'sam', 'POST', "/orgs/$org/job-titles", ['name' => 'Boss'])[0] === 403);
check('a duplicate name (any case) is 409', call($api, 'olga', 'POST', "/orgs/$org/job-titles", ['name' => 'care assistant'])[1]['error']['code'] === 'title_exists');
check('two active titles cannot share a colour', call($api, 'olga', 'POST', "/orgs/$org/job-titles", ['name' => 'Nurse', 'colour' => 'teal'])[1]['error']['code'] === 'colour_in_use');
check('a colour outside the palette is 422', call($api, 'olga', 'POST', "/orgs/$org/job-titles", ['name' => 'Nurse', 'colour' => 'chartreuse'])[0] === 422);
check('archiving a title releases its colour', call($api, 'olga', 'POST', "/orgs/$org/job-titles/$title", ['name' => 'Care Assistant', 'colour' => 'teal', 'active' => false])[0] === 200 && call($api, 'olga', 'POST', "/orgs/$org/job-titles", ['name' => 'Nurse', 'colour' => 'teal'])[0] === 201);
call($api, 'olga', 'POST', "/orgs/$org/job-titles/$title", ['name' => 'Care Assistant', 'colour' => null, 'active' => true]);
[$s] = call($api, 'mark', 'POST', "/orgs/$org/staff/$patStaff", ['job_title_id' => $title]);
check('a staff record takes a catalogue title and keeps the text copy in step', $s === 200 && $pdo->query("SELECT job_title FROM staff_profiles WHERE id = '$patStaff'")->fetchColumn() === 'Care Assistant');
call($api, 'olga', 'POST', "/orgs/$org/job-titles/$title", ['name' => 'Senior Care Assistant', 'colour' => null, 'active' => true]);
check('renaming a title renames it on its staff', $pdo->query("SELECT job_title FROM staff_profiles WHERE id = '$patStaff'")->fetchColumn() === 'Senior Care Assistant');
$zTitle = call($api, 'zed', 'POST', "/orgs/$other/job-titles", ['name' => 'Z Title'])[1]['id'];
check('a title from another organisation is refused', call($api, 'mark', 'POST', "/orgs/$org/staff/$patStaff", ['job_title_id' => $zTitle])[0] === 422);
check('and cannot be edited through mine', call($api, 'olga', 'POST', "/orgs/$org/job-titles/$zTitle", ['name' => 'Hijack'])[0] === 404);
check('deleting a title clears it from staff but keeps the text', call($api, 'olga', 'POST', "/orgs/$org/job-titles/$title/delete")[0] === 200 && $pdo->query("SELECT job_title_id FROM staff_profiles WHERE id = '$patStaff'")->fetchColumn() === null && $pdo->query("SELECT job_title FROM staff_profiles WHERE id = '$patStaff'")->fetchColumn() === 'Senior Care Assistant');
check('every member reads the catalogue', count(call($api, 'sam', 'GET', "/orgs/$org/job-titles")[1]['job_titles']) >= 2);

// ---- sites ---------------------------------------------------------------------------------------------------------
$l1 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Site A'])[1]['id'];
$l2 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Site B'])[1]['id'];
$zLoc = call($api, 'zed', 'POST', "/orgs/$other/locations", ['name' => 'Z Site'])[1]['id'];
check('a manager assigns sites', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/locations", ['location_ids' => [$l1, $l2]])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM staff_locations WHERE staff_profile_id = '$samStaff'")->fetchColumn() === 2);
check('the list shows them to colleagues', call($api, 'pat', 'GET', "/orgs/$org/staff/$samStaff")[1]['staff']['location_ids'] === [$l1, $l2] || count(call($api, 'pat', 'GET', "/orgs/$org/staff/$samStaff")[1]['staff']['location_ids']) === 2);
check('replacing the set removes the old ones', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/locations", ['location_ids' => [$l2]])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM staff_locations WHERE staff_profile_id = '$samStaff'")->fetchColumn() === 1);
check('a site from another organisation fails and changes nothing', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/locations", ['location_ids' => [$l1, $zLoc]])[0] === 422 && (int) $pdo->query("SELECT COUNT(*) FROM staff_locations WHERE staff_profile_id = '$samStaff'")->fetchColumn() === 1);
check('staff cannot assign sites', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/locations", ['location_ids' => []])[0] === 403);

// ---- pay rates ------------------------------------------------------------------------------------------------------
check('staff cannot set pay', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/pay-rates", ['hourly_rate_pence' => 1500, 'effective_from' => '2026-01-01'])[0] === 403);
check('a manager sets a rate', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/pay-rates", ['hourly_rate_pence' => 1250, 'effective_from' => '2026-01-01'])[0] === 201);
check('and a later one, as history', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/pay-rates", ['hourly_rate_pence' => 1300, 'effective_from' => '2026-06-01'])[0] === 201);
check('a rate on an existing date is not overwritten', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/pay-rates", ['hourly_rate_pence' => 9999, 'effective_from' => '2026-01-01'])[1]['error']['code'] === 'rate_exists');
check('fractions of a penny are refused', call($api, 'mark', 'POST', "/orgs/$org/staff/$samStaff/pay-rates", ['hourly_rate_pence' => 1250.5, 'effective_from' => '2026-02-01'])[0] === 422);
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/staff/$samStaff/pay-rates");
check('a person reads their own rate history, newest first', count($r['pay_rates']) === 2 && $r['pay_rates'][0]['hourly_rate_pence'] === 1300);
check('a colleague cannot read someone else\'s pay', call($api, 'pat', 'GET', "/orgs/$org/staff/$samStaff/pay-rates")[0] === 403);
check('a manager can', call($api, 'mark', 'GET', "/orgs/$org/staff/$samStaff/pay-rates")[0] === 200);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/staff/$samStaff/pay-rates")[0] === 404);
check('pay rates are audited as warnings', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'staff.pay_rate_added' AND severity = 'warning'")->fetchColumn() === 2);

// ---- emergency contacts -----------------------------------------------------------------------------------------
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts", ['name' => 'Alex Stone', 'relationship' => 'Partner', 'phone' => '07700 333333']);
check('a person adds their own emergency contact', $s === 201, json_encode($r));
$ec = $r['id'];
check('a colleague cannot read or add', call($api, 'pat', 'GET', "/orgs/$org/staff/$samStaff/emergency-contacts")[0] === 403 && call($api, 'pat', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts", ['name' => 'X', 'phone' => '1'])[0] === 403);
check('a manager reads them', count(call($api, 'mark', 'GET', "/orgs/$org/staff/$samStaff/emergency-contacts")[1]['emergency_contacts']) === 1);
check('the owner of the record edits one', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts/$ec", ['name' => 'Alex Stone', 'phone' => '07700 444444'])[0] === 200);
check('a contact id under the wrong person is 404', call($api, 'pat', 'POST', "/orgs/$org/staff/$patStaff/emergency-contacts/$ec", ['name' => 'Alex', 'phone' => '1'])[0] === 404);
check('a name and a phone are required', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts", ['name' => 'No Phone'])[0] === 422);
check('delete works for the person and 404s the second time', call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts/$ec/delete")[0] === 200 && call($api, 'sam', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts/$ec/delete")[0] === 404);

// ---- invitation carries department and site into the staff record ---------------------------------------------------
$dept = call($api, 'olga', 'POST', "/orgs/$org/departments", ['name' => 'Nursing'])[1]['id'];
call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Newbie', 'last_name' => 'Hire', 'email' => 'newbie@example.test']);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'newbie@example.test', 'role' => 'staff', 'department_id' => $dept, 'location_id' => $l1]);
check('an invitation can carry a department and a site', $s === 201, json_encode($r));
check('but not ones from another organisation', call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'x1@example.test', 'role' => 'staff', 'department_id' => $zDept])[0] === 422);
call($api, 'newbie', 'POST', '/invites/accept', ['token' => $r['token']]);
$nb = $pdo->query("SELECT sp.user_id IS NOT NULL AS linked, sp.department_id FROM staff_profiles sp WHERE sp.org_id = '$org' AND sp.email = 'newbie@example.test'")->fetch();
check('accepting links the HR record created earlier by email and applies the department', (int) $nb['linked'] === 1 && $nb['department_id'] === $dept, json_encode($nb));
check('and the site', (int) $pdo->query("SELECT COUNT(*) FROM staff_locations sl JOIN staff_profiles sp ON sp.id = sl.staff_profile_id WHERE sp.email = 'newbie@example.test' AND sl.location_id = '$l1'")->fetchColumn() === 1);
check('no second record was made for them', (int) $pdo->query("SELECT COUNT(*) FROM staff_profiles WHERE org_id = '$org' AND email = 'newbie@example.test'")->fetchColumn() === 1);

// ---- the database is the backstop --------------------------------------------------------------------------------
try {
    $pdo->prepare("INSERT INTO staff_locations (staff_profile_id, location_id, org_id) VALUES (?, ?, ?)")->execute([$samStaff, $zLoc, $org]);
    check('the database refuses a site from another organisation', false);
} catch (PDOException) { check('the database refuses a site from another organisation', true); }
try {
    $pdo->prepare("UPDATE staff_profiles SET job_title_id = ? WHERE id = ?")->execute([$zTitle, $samStaff]);
    check('the database refuses a job title from another organisation', false);
} catch (PDOException) { check('the database refuses a job title from another organisation', true); }
