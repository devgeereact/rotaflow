<?php
declare(strict_types=1);

// Locations and departments.
use RotaFlow\Db;

$api = test_api($pdo);
$uuid = '11111111-2222-4333-8444-555555555555';
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Places Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$join = static function (string $name, string $role) use ($pdo, $api, $org): void {
    call($api, $name, 'GET', '/me');
    $u = (string) $pdo->query("SELECT id FROM users WHERE email = '$name@example.test'")->fetchColumn();
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, ?, 'active')")->execute([Db::uuid(), $org, $u, $role]);
};
$join('mark', 'manager');
$join('sam', 'staff');

[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'address' => '1 High St', 'latitude' => 51.5, 'longitude' => -0.12, 'timezone' => 'Europe/London', 'geofence_radius_m' => 200, 'location_type' => 'Residential', 'status' => 'active']);
check('the owner creates a location', $s === 201, json_encode($r));
$loc = $r['id'];
check('a manager can too', call($api, 'mark', 'POST', "/orgs/$org/locations", ['name' => 'Elm Court'])[0] === 201);
check('staff cannot create', call($api, 'sam', 'POST', "/orgs/$org/locations", ['name' => 'Nope'])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/locations", ['name' => 'Nope'])[0] === 404);
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/locations");
check('any member reads the locations', count($r['locations']) === 2 && $r['locations'][1]['name'] === 'Oak House' || $r['locations'][0]['name'] === 'Elm Court');
$defaults = $pdo->query("SELECT timezone, geofence_radius_m, status FROM locations WHERE name = 'Elm Court'")->fetch();
check('defaults: London, 150 m, setup', $defaults === ['timezone' => 'Europe/London', 'geofence_radius_m' => 150, 'status' => 'setup'], json_encode($defaults));
foreach ([['name' => ''], ['name' => 'x', 'timezone' => 'Mars/Base'], ['name' => 'x', 'latitude' => 51.5], ['name' => 'x', 'latitude' => 95, 'longitude' => 0], ['name' => 'x', 'location_type' => 'Castle'], ['name' => 'x', 'status' => 'open'], ['name' => 'x', 'geofence_radius_m' => 1], ['name' => ['a']]] as $i => $bad) {
    check("a bad location is 422 ($i)", call($api, 'olga', 'POST', "/orgs/$org/locations", $bad)[0] === 422);
}
check('the owner updates a location', call($api, 'olga', 'POST', "/orgs/$org/locations/$loc", ['name' => 'Oak House Care', 'status' => 'maintenance'])[0] === 200 && $pdo->query("SELECT name FROM locations WHERE id = '$loc'")->fetchColumn() === 'Oak House Care');
check('updating a location of another organisation is 404', call($api, 'olga', 'POST', "/orgs/$org/locations/" . $pdo->query("SELECT id FROM locations LIMIT 1")->fetchColumn() . 'x', ['name' => 'y'])[0] === 404);
$zLoc = call($api, 'zed', 'POST', "/orgs/$other/locations", ['name' => 'Z Site'])[1]['id'];
check('a location id from another organisation cannot be updated through mine', call($api, 'olga', 'POST', "/orgs/$org/locations/$zLoc", ['name' => 'Hijacked'])[0] === 404 && $pdo->query("SELECT name FROM locations WHERE id = '$zLoc'")->fetchColumn() === 'Z Site');

// departments
check('a department cannot sit in another organisation\'s location', call($api, 'olga', 'POST', "/orgs/$org/departments", ['name' => 'Kitchen', 'location_id' => $zLoc])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/departments", ['name' => 'Kitchen', 'location_id' => $loc]);
check('a manager creates a department in a location', $s === 201, json_encode($r));
$dep = $r['id'];
check('staff cannot create departments', call($api, 'sam', 'POST', "/orgs/$org/departments", ['name' => 'X'])[0] === 403);
check('a department can have no location', call($api, 'olga', 'POST', "/orgs/$org/departments", ['name' => 'Floating'])[0] === 201);
check('and can be renamed and moved', call($api, 'olga', 'POST', "/orgs/$org/departments/$dep", ['name' => 'Main Kitchen', 'location_id' => null])[0] === 200 && $pdo->query("SELECT location_id FROM departments WHERE id = '$dep'")->fetchColumn() === null);
call($api, 'olga', 'POST', "/orgs/$org/departments/$dep", ['name' => 'Main Kitchen', 'location_id' => $loc]);
check('members read departments', count(call($api, 'sam', 'GET', "/orgs/$org/departments")[1]['departments']) === 2);

// the database itself refuses a cross-organisation reference, whatever the API does
try {
    $pdo->prepare('INSERT INTO departments (id, org_id, location_id, name) VALUES (?, ?, ?, ?)')->execute([Db::uuid(), $org, $zLoc, 'Smuggled']);
    check('the composite key refuses a department pointing at another organisation\'s location', false);
} catch (PDOException) {
    check('the composite key refuses a department pointing at another organisation\'s location', true);
}

// deleting
$sid = Db::uuid();
$pdo->prepare("INSERT INTO staff_profiles (id, org_id, first_name, department_id) VALUES (?, ?, 'Pat', ?)")->execute([$sid, $org, $dep]);
check('staff cannot delete a location', call($api, 'sam', 'POST', "/orgs/$org/locations/$loc/delete")[0] === 403);
check('deleting a location unplaces its departments instead of failing', call($api, 'olga', 'POST', "/orgs/$org/locations/$loc/delete")[0] === 200 && $pdo->query("SELECT location_id FROM departments WHERE id = '$dep'")->fetchColumn() === null);
check('deleting a department unplaces its staff', call($api, 'olga', 'POST', "/orgs/$org/departments/$dep/delete")[0] === 200 && $pdo->query("SELECT department_id FROM staff_profiles WHERE id = '$sid'")->fetchColumn() === null);
check('deleting twice is 404', call($api, 'olga', 'POST', "/orgs/$org/departments/$dep/delete")[0] === 404);
check('the changes are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action LIKE 'location.%' OR org_id = '$org' AND action LIKE 'department.%'")->fetchColumn() >= 6);
