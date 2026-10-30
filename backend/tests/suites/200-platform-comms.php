<?php
declare(strict_types=1);

// Platform announcements, invoice credits with the billing reads, and the platform audit read.
use RotaFlow\Db;
use RotaFlow\Mod\PlatformAnnouncements as PA;

$api = test_api($pdo);
foreach (['root' => 'platform_owner', 'adam' => 'platform_admin', 'sue' => 'platform_support', 'fin' => 'platform_finance'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare('INSERT INTO platform_admins (user_id, role) SELECT id, ? FROM users WHERE email = ?')->execute([$r, "$n@example.test"]);
}
$orgA = call($api, 'olga', 'POST', '/orgs', ['name' => 'Alpha'])[1]['org']['id'];
$orgB = call($api, 'zed', 'POST', '/orgs', ['name' => 'Bravo'])[1]['org']['id'];
$orgC = call($api, 'carl', 'POST', '/orgs', ['name' => 'Charlie'])[1]['org']['id'];
$orgD = call($api, 'adam', 'POST', '/platform/orgs', ['name' => 'Delta (no one yet)', 'owner_email' => 'nobody@example.test'])[1]['org']['id'];
call($api, 'mark', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'manager', 'active' FROM users WHERE email = 'mark@example.test'")->execute([Db::uuid(), $orgA]);
call($api, 'sam', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'sam@example.test'")->execute([Db::uuid(), $orgA]);
$pdo->exec("UPDATE organisations SET plan = 'starter' WHERE id = '$orgA'");
$pdo->exec("UPDATE organisations SET plan = 'business' WHERE id = '$orgB'");
$pdo->exec("UPDATE organisations SET plan = 'business', status = 'suspended' WHERE id = '$orgC'");
$pdo->exec("UPDATE organisations SET plan = 'business' WHERE id = '$orgD'");
$uid = static fn (string $w): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$w@example.test'")->fetchColumn();

// ---- writing ---------------------------------------------------------------------------------------------------------------------------
$new = static fn (string $w, array $b = []) => call($GLOBALS['api'], $w, 'POST', '/platform/announcements', $b + ['title' => 'Maintenance on Tuesday', 'body' => 'We are updating the platform at 22:00.', 'kind' => 'maintenance']);
check('only owner and admin write announcements; support, finance and customers do not', $new('sue')[0] === 404 && $new('fin')[0] === 404 && $new('olga')[0] === 404 && call($api, '', 'GET', '/platform/announcements')[0] === 401);
foreach ([['title' => ''], ['body' => ''], ['kind' => 'rant'], ['audience' => 'organisations'], ['audience' => 'plans'], ['audience' => 'plans', 'plans' => ['gold']], ['plans' => 'business'], ['scheduled_for' => 'tomorrow']] as $i => $bad) {
    check("a bad announcement is 422 ($i)", $new('adam', $bad)[0] === 422);
}
[$s, $r] = $new('adam');
check('a draft is created', $s === 201 && $r['status'] === 'draft');
$a1 = $r['id'];
check('one with a time is scheduled', $new('root', ['scheduled_for' => '2031-01-01T10:00:00Z'])[1]['status'] === 'scheduled');

// ---- publishing -----------------------------------------------------------------------------------------------------------------------------
check('support cannot publish', call($api, 'sue', 'POST', "/platform/announcements/$a1/publish")[0] === 404);
[$s, $r] = call($api, 'adam', 'POST', "/platform/announcements/$a1/publish");
check('publishing reaches every ACTIVE organisation, counting the one with nobody to address', $s === 200 && $r['queued'] === 3, json_encode($r));
$del = $pdo->query("SELECT o.name, d.outbox_id, d.sent_at, d.failed_at, d.failure_reason FROM platform_announcement_deliveries d JOIN organisations o ON o.id = d.org_id WHERE d.announcement_id = '$a1' ORDER BY o.name")->fetchAll();
check('each organisation has one delivery; the suspended one has none', array_column($del, 'name') === ['Alpha', 'Bravo', 'Delta (no one yet)']);
check('the one with no owner or manager is failed with the reason, not silently skipped', $del[2]['failed_at'] !== null && $del[2]['failure_reason'] === 'No active owner or manager to address' && $del[2]['outbox_id'] === null);
$payload = json_decode((string) $pdo->query("SELECT payload FROM notification_outbox WHERE id = '{$del[0]['outbox_id']}'")->fetchColumn(), true);
check('the people addressed are the owners and managers, never staff, and it is typed as an announcement', array_values(array_unique($payload['userIds'])) !== [] && in_array($uid('olga'), $payload['userIds'], true) && in_array($uid('mark'), $payload['userIds'], true) && !in_array($uid('sam'), $payload['userIds'], true) && $payload['type'] === 'announcement' && $payload['title'] === 'Maintenance on Tuesday');
check('a delivery starts queued - "sent" is not claimed until the outbox row has gone', $del[0]['sent_at'] === null && $del[0]['failed_at'] === null);
check('publishing again is refused, and so is cancelling a sent one', call($api, 'adam', 'POST', "/platform/announcements/$a1/publish")[1]['error']['code'] === 'already_sent' && call($api, 'adam', 'POST', "/platform/announcements/$a1/cancel")[1]['error']['code'] === 'already_sent');
check('the audit entries are platform-only', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action IN ('announcement.created','announcement.sent') AND visibility = 'platform_only'")->fetchColumn() === 3);

// reconcile
check('while the outbox row is still pending nothing is stamped', PA::reconcile($pdo) === 0 && (int) $pdo->query("SELECT COUNT(*) FROM platform_announcement_deliveries WHERE announcement_id = '$a1' AND (sent_at IS NOT NULL OR failed_at IS NOT NULL AND failure_reason <> 'No active owner or manager to address')")->fetchColumn() === 0);
$pdo->exec("UPDATE notification_outbox SET status = 'sent', dispatched_at = UTC_TIMESTAMP() WHERE id = '{$del[0]['outbox_id']}'");
$pdo->exec("UPDATE notification_outbox SET status = 'abandoned', last_error = 'SmtpError' WHERE id = '{$del[1]['outbox_id']}'");
check('reconciling stamps delivered from a sent outbox row', PA::reconcile($pdo) === 1);
$st = $pdo->query("SELECT o.name, d.sent_at IS NOT NULL AS sent, d.failed_at IS NOT NULL AS failed, d.failure_reason FROM platform_announcement_deliveries d JOIN organisations o ON o.id = d.org_id WHERE d.announcement_id = '$a1' ORDER BY o.name")->fetchAll();
check('and failed, with the outbox error, from an abandoned one', (int) $st[0]['sent'] === 1 && (int) $st[1]['failed'] === 1 && $st[1]['failure_reason'] === 'SmtpError');
$list = call($api, 'sue', 'GET', '/platform/announcements')[1]['announcements'];
$mine = array_values(array_filter($list, static fn ($x) => $x['id'] === $a1))[0];
check('operational staff see delivery counts', $mine['stats'] === ['recipients' => 3, 'queued' => 0, 'delivered' => 1, 'failed' => 2, 'read' => 0], json_encode($mine['stats']));
check('finance sees the list without the counts', call($api, 'fin', 'GET', '/platform/announcements')[1]['announcements'][0]['stats'] === null);

// kinds, opt-out and plans
check('only an owner opts the organisation out; it must be a boolean', call($api, 'mark', 'POST', "/orgs/$orgA/platform-announcements/opt-out", ['opted_out' => true])[0] === 403 && call($api, 'zed', 'POST', "/orgs/$orgA/platform-announcements/opt-out", ['opted_out' => true])[0] === 404 && call($api, 'olga', 'POST', "/orgs/$orgA/platform-announcements/opt-out", ['opted_out' => 'yes'])[0] === 422);
call($api, 'olga', 'POST', "/orgs/$orgA/platform-announcements/opt-out", ['opted_out' => true]);
$prod = $new('adam', ['title' => 'New feature', 'body' => 'Rotas are faster now.', 'kind' => 'product'])[1]['id'];
check('a product notice respects the opt-out', call($api, 'adam', 'POST', "/platform/announcements/$prod/publish")[1]['queued'] === 2 && (int) $pdo->query("SELECT COUNT(*) FROM platform_announcement_deliveries WHERE announcement_id = '$prod' AND org_id = '$orgA'")->fetchColumn() === 0);
$inc = $new('adam', ['title' => 'Outage', 'body' => 'We are looking into it.', 'kind' => 'incident'])[1]['id'];
check('an incident notice ignores it', call($api, 'adam', 'POST', "/platform/announcements/$inc/publish")[1]['queued'] === 3 && (int) $pdo->query("SELECT COUNT(*) FROM platform_announcement_deliveries WHERE announcement_id = '$inc' AND org_id = '$orgA'")->fetchColumn() === 1);
$onlyBiz = $new('adam', ['title' => 'Business news', 'body' => 'For Business plans.', 'kind' => 'maintenance', 'audience' => 'plans', 'plans' => ['business']])[1]['id'];
check('a plan audience reaches only those plans', call($api, 'adam', 'POST', "/platform/announcements/$onlyBiz/publish")[1]['queued'] === 2 && (int) $pdo->query("SELECT COUNT(*) FROM platform_announcement_deliveries WHERE announcement_id = '$onlyBiz' AND org_id = '$orgA'")->fetchColumn() === 0);
call($api, 'olga', 'POST', "/orgs/$orgA/platform-announcements/opt-out", ['opted_out' => false]);
check('opting back in is allowed', call($api, 'olga', 'GET', "/orgs/$orgA/platform-announcements")[1]['opted_out'] === false);

// cancel
$d1 = $new('adam', ['title' => 'Draft', 'body' => 'Draft body'])[1]['id'];
check('a draft can be cancelled, and then cannot be published', call($api, 'adam', 'POST', "/platform/announcements/$d1/cancel")[0] === 200 && call($api, 'adam', 'POST', "/platform/announcements/$d1/publish")[1]['error']['code'] === 'cancelled' && call($api, 'adam', 'POST', '/platform/announcements/99999999-9999-4999-8999-999999999999/cancel')[0] === 404);

// the organisation's side
[$s, $r] = call($api, 'olga', 'GET', "/orgs/$orgA/platform-announcements");
check('owners and managers see what the platform sent them; staff and strangers do not', $s === 200 && count($r['announcements']) === 2 && call($api, 'mark', 'GET', "/orgs/$orgA/platform-announcements")[0] === 200 && call($api, 'sam', 'GET', "/orgs/$orgA/platform-announcements")[0] === 403 && call($api, 'zed', 'GET', "/orgs/$orgA/platform-announcements")[0] === 404);
check('marking read is idempotent and keeps the first reader', call($api, 'olga', 'POST', "/orgs/$orgA/platform-announcements/$a1/read")[0] === 200 && call($api, 'mark', 'POST', "/orgs/$orgA/platform-announcements/$a1/read")[0] === 200 && $pdo->query("SELECT read_by FROM platform_announcement_deliveries WHERE announcement_id = '$a1' AND org_id = '$orgA'")->fetchColumn() === $uid('olga'));
check('an announcement the organisation never had is 404', call($api, 'olga', 'POST', "/orgs/$orgA/platform-announcements/$onlyBiz/read")[0] === 404 && call($api, 'sam', 'POST', "/orgs/$orgA/platform-announcements/$a1/read")[0] === 403);

// scheduler
$sch = $new('adam', ['title' => 'Scheduled', 'body' => 'Scheduled body', 'scheduled_for' => '2030-01-01T10:00:00Z'])[1]['id'];
$future = $new('adam', ['title' => 'Later', 'body' => 'Later body', 'scheduled_for' => '2031-06-01T10:00:00Z'])[1]['id'];
$pdo->exec("UPDATE platform_announcements SET scheduled_for = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = '$sch'");
$out = PA::cron(new RotaFlow\Ctx($pdo, new RotaFlow\RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config()));
check('the scheduler sends what is due and leaves the rest', $pdo->query("SELECT status FROM platform_announcements WHERE id = '$sch'")->fetchColumn() === 'sent' && $pdo->query("SELECT status FROM platform_announcements WHERE id = '$future'")->fetchColumn() === 'scheduled' && str_contains($out, 'published=1'), $out);
check('a scheduled send is audited with no person as the actor', str_contains((string) $pdo->query("SELECT metadata FROM audit_logs WHERE action = 'announcement.sent' ORDER BY id DESC LIMIT 1")->fetchColumn(), '(scheduled)') && $pdo->query("SELECT actor_user_id FROM audit_logs WHERE action = 'announcement.sent' ORDER BY id DESC LIMIT 1")->fetchColumn() === null);
$threw = false;
try { PA::publish($pdo, $d1, null, null, true); } catch (RotaFlow\HttpError) { $threw = true; }
check('the scheduler refuses anything that is not scheduled', $threw);

// ---- invoices and credits ------------------------------------------------------------------------------------------------------------------------
$inv = static function (string $org, string $number, string $status, int $net, int $tax, string $cur = 'GBP', string $paid = null): string {
    $id = Db::uuid();
    $GLOBALS['pdo']->prepare("INSERT INTO invoices (id, org_id, number, period_start, period_end, amount_pence, tax_pence, currency, status, issued_on, due_on, paid_at, refunded_at) VALUES (?, ?, ?, CURDATE(), CURDATE(), ?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?)")
        ->execute([$id, $org, $number, $net, $tax, $cur, $status, $status === 'paid' ? ($paid ?? gmdate('Y-m-d H:i:s')) : null, $status === 'refunded' ? gmdate('Y-m-d H:i:s') : null]);
    return $id;
};
$i1 = $inv($orgA, 'INV-1', 'paid', 10000, 2000);
$i2 = $inv($orgA, 'INV-2', 'void', 5000, 0);
$i3 = $inv($orgB, 'INV-3', 'open', 7000, 0, 'EUR');
$i4 = $inv($orgB, 'INV-4', 'past_due', 3000, 600);
$cr = static fn (string $w, string $id, array $b) => call($GLOBALS['api'], $w, 'POST', "/platform/invoices/$id/credits", $b);
check('support and customers cannot credit; finance, admin and owner can', $cr('sue', $i1, ['amount_pence' => 100, 'reason' => 'goodwill gesture'])[0] === 404 && $cr('olga', $i1, ['amount_pence' => 100, 'reason' => 'goodwill gesture'])[0] === 404 && $cr('fin', $i1, ['amount_pence' => 100, 'reason' => 'goodwill gesture'])[0] === 201);
check('a void invoice cannot be credited; an unknown one is 404', $cr('fin', $i2, ['amount_pence' => 100, 'reason' => 'goodwill gesture'])[1]['error']['code'] === 'not_creditable' && $cr('fin', '99999999-9999-4999-8999-999999999999', ['amount_pence' => 1, 'reason' => 'goodwill gesture'])[0] === 404);
check('the amount must be a positive whole number, and the reason at least ten characters', $cr('fin', $i1, ['amount_pence' => 0, 'reason' => 'goodwill gesture'])[0] === 422 && $cr('fin', $i1, ['amount_pence' => -5, 'reason' => 'goodwill gesture'])[0] === 422 && $cr('fin', $i1, ['amount_pence' => 12.5, 'reason' => 'goodwill gesture'])[0] === 422 && $cr('fin', $i1, ['amount_pence' => 100, 'reason' => 'oops'])[0] === 422 && $cr('fin', $i1, ['amount_pence' => 100])[0] === 422);
check('a reason is counted in characters, not bytes', $cr('fin', $i1, ['amount_pence' => 1, 'reason' => 'éééééééééé'])[0] === 201);
[$s, $r] = $cr('fin', $i1, ['amount_pence' => 11900, 'reason' => 'too much by one pence']);
check('a credit may not exceed the gross (net plus tax) less what is already credited, and says by how much', $s === 422 && str_contains($r['error']['message'], 'more than the invoice is worth') && str_contains($r['error']['message'], '1 more'), json_encode($r));
check('up to exactly the gross is allowed', $cr('fin', $i1, ['amount_pence' => 11899, 'reason' => 'the remaining balance'])[0] === 201 && $cr('fin', $i1, ['amount_pence' => 1, 'reason' => 'one more pence than there is'])[0] === 422);
[$s, $first] = $cr('fin', $i3, ['amount_pence' => 500, 'reason' => 'service outage credit', 'idempotency_key' => 'k1']);
[$s2, $second] = $cr('fin', $i3, ['amount_pence' => 999999, 'reason' => 'a different request entirely', 'idempotency_key' => 'k1']);
check('a retry with the same key returns the same credit and checks nothing else', $s === 201 && $s2 === 200 && $second['id'] === $first['id'] && $second['already_recorded'] === true && (int) $pdo->query("SELECT COUNT(*) FROM invoice_credits WHERE invoice_id = '$i3'")->fetchColumn() === 1);
check('the credit is in the invoice\'s own currency, and the invoice itself is untouched', $pdo->query("SELECT currency FROM invoice_credits WHERE id = '{$first['id']}'")->fetchColumn() === 'EUR' && $pdo->query("SELECT CONCAT(status, ':', amount_pence) FROM invoices WHERE id = '$i3'")->fetchColumn() === 'open:7000');
check('the entry is audited, and visible to the organisation', ($a = $pdo->query("SELECT severity, visibility, org_id FROM audit_logs WHERE action = 'invoice.credited' ORDER BY id DESC LIMIT 1")->fetch()) && $a['severity'] === 'warning' && $a['visibility'] === 'org' && $a['org_id'] === $orgB);
check('credits are read by billing staff and by the organisation\'s owner only', count(call($api, 'fin', 'GET', "/platform/invoices/$i1/credits")[1]['credits']) === 3 && call($api, 'sue', 'GET', "/platform/invoices/$i1/credits")[0] === 404 && count(call($api, 'olga', 'GET', "/orgs/$orgA/invoices/$i1/credits")[1]['credits']) === 3 && call($api, 'mark', 'GET', "/orgs/$orgA/invoices/$i1/credits")[0] === 403 && call($api, 'zed', 'GET', "/orgs/$orgA/invoices/$i1/credits")[0] === 404 && call($api, 'zed', 'GET', "/orgs/$orgB/invoices/$i1/credits")[1]['credits'] === []);
check('a credit cannot be deleted with its invoice kept: deleting the invoice removes its credits', (function () use ($pdo, $i4): bool { $c = $pdo->prepare("INSERT INTO invoice_credits (id, invoice_id, org_id, amount_pence, currency, reason) SELECT UUID(), id, org_id, 10, currency, 'ten characters long' FROM invoices WHERE id = ?"); $c->execute([$i4]); $pdo->exec("DELETE FROM invoices WHERE id = '$i4'"); return (int) $pdo->query("SELECT COUNT(*) FROM invoice_credits WHERE invoice_id = '$i4'")->fetchColumn() === 0; })());

// billing reads
$i5 = $inv($orgA, 'INV-5', 'past_due', 4000, 0);
$i6 = $inv($orgB, 'INV-6', 'paid', 2500, 0, 'EUR', gmdate('Y-m-d H:i:s', strtotime('first day of last month 12:00 UTC')));
$pdo->exec("INSERT INTO subscriptions (id, org_id, plan, status, price_pence, currency) VALUES (UUID(), '$orgA', 'starter', 'active', 2900, 'GBP'), (UUID(), '$orgB', 'business', 'past_due', NULL, 'GBP')");
[$s, $b] = call($api, 'fin', 'GET', '/platform/billing/summary');
$gbp = array_values(array_filter($b['summary'], static fn ($r) => $r['currency'] === 'GBP'))[0];
$eur = array_values(array_filter($b['summary'], static fn ($r) => $r['currency'] === 'EUR'))[0];
check('the billing summary is per currency, never converted', $s === 200 && count($b['summary']) === 2, json_encode($b));
check('MRR counts active and past-due subscriptions, falling back to the plan price when none is stored', $gbp['mrr_pence'] === 2900 + 29900 && $gbp['paying_orgs'] === 2);
check('collections are by payment date, this month and last, outstanding is not limited to a month', $gbp['collected_month_pence'] === 10000 && $eur['collected_prev_month_pence'] === 2500 && $gbp['outstanding_pence'] === 4000 && $gbp['past_due_pence'] === 4000 && $gbp['past_due_invoices'] === 1 && $eur['outstanding_pence'] === 7000);
check('support and customers cannot read it; owner, admin and finance can', call($api, 'sue', 'GET', '/platform/billing/summary')[0] === 404 && call($api, 'olga', 'GET', '/platform/billing/summary')[0] === 404 && call($api, 'root', 'GET', '/platform/billing/summary')[0] === 200 && call($api, 'adam', 'GET', '/platform/billing/summary')[0] === 200);
[$s, $d] = call($api, 'fin', 'GET', '/platform/invoices');
check('the invoice directory pages, totals, and shows what has been credited', $s === 200 && $d['total'] === 5 && array_values(array_filter($d['invoices'], static fn ($x) => $x['number'] === 'INV-1'))[0]['credited_pence'] === 12000, json_encode($d['total']));
check('it filters by status, currency, organisation and search, and refuses nonsense', count(call($api, 'fin', 'GET', '/platform/invoices?status=paid')[1]['invoices']) === 2 && count(call($api, 'fin', 'GET', '/platform/invoices?currency=eur')[1]['invoices']) === 2 && count(call($api, 'fin', 'GET', "/platform/invoices?org_id=$orgA")[1]['invoices']) === 3 && count(call($api, 'fin', 'GET', '/platform/invoices?q=Bravo')[1]['invoices']) === 2 && call($api, 'fin', 'GET', '/platform/invoices?status=wibble')[0] === 422 && call($api, 'sue', 'GET', '/platform/invoices')[0] === 404 && call($api, 'fin', 'GET', '/platform/invoices?limit=2')[1]['total'] === 5);

// ---- the platform audit read ------------------------------------------------------------------------------------------------------------------------
check('operational staff read the audit trail; finance, customers and anonymous callers cannot', call($api, 'sue', 'GET', '/platform/audit')[0] === 200 && call($api, 'fin', 'GET', '/platform/audit')[0] === 404 && call($api, 'olga', 'GET', '/platform/audit')[0] === 404 && call($api, '', 'GET', '/platform/audit')[0] === 401);
[$s, $au] = call($api, 'sue', 'GET', '/platform/audit?limit=5');
check('entries come newest first with a total, and the actor is named', $s === 200 && count($au['entries']) === 5 && $au['total'] > 5 && $au['entries'][0]['id'] > $au['entries'][4]['id'] && array_key_exists('actor_email', $au['entries'][0]));
check('paging does not repeat or skip', (function () use ($api): bool { $a = call($api, 'sue', 'GET', '/platform/audit?limit=3&offset=0')[1]['entries']; $b = call($api, 'sue', 'GET', '/platform/audit?limit=3&offset=3')[1]['entries']; $all = call($api, 'sue', 'GET', '/platform/audit?limit=6')[1]['entries']; return array_column(array_merge($a, $b), 'id') === array_column($all, 'id'); })());
check('platform scope shows entries about no organisation; an organisation id shows only its own', count(array_filter(call($api, 'sue', 'GET', '/platform/audit?scope=platform&limit=200')[1]['entries'], static fn ($e) => $e['org_id'] !== null)) === 0 && count(array_filter(call($api, 'sue', 'GET', "/platform/audit?scope=$orgB&limit=200")[1]['entries'], static fn ($e) => $e['org_id'] !== $orgB)) === 0 && call($api, 'sue', 'GET', "/platform/audit?scope=$orgB")[1]['total'] >= 1);
check('it filters by severity and rejects unknown ones', count(array_unique(array_column(call($api, 'sue', 'GET', '/platform/audit?severity=warning&limit=200')[1]['entries'], 'severity'))) === 1 && call($api, 'sue', 'GET', '/platform/audit?severity=warning,critical')[0] === 200 && call($api, 'sue', 'GET', '/platform/audit?severity=loud')[0] === 422);
check('search matches the action and the person, and a literal percent is just a percent', call($api, 'sue', 'GET', '/platform/audit?q=invoice.credited')[1]['total'] >= 1 && call($api, 'sue', 'GET', '/platform/audit?q=adam@example')[1]['total'] >= 1 && call($api, 'sue', 'GET', '/platform/audit?q=%25')[1]['total'] === 0);
check('the actor filter narrows to one person; times need an offset', call($api, 'sue', 'GET', '/platform/audit?actor=' . $uid('fin'))[1]['total'] >= 1 && call($api, 'sue', 'GET', '/platform/audit?actor=' . $uid('sam'))[1]['total'] === 0 && call($api, 'sue', 'GET', '/platform/audit?from=2020-01-01')[0] === 422 && call($api, 'sue', 'GET', '/platform/audit?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z')[1]['total'] === 0);
check('credit entries carry their metadata', ($m = call($api, 'sue', 'GET', '/platform/audit?q=invoice.credited&limit=1')[1]['entries'][0]['metadata']) && isset($m['credit_id']) && $m['currency'] === 'GBP' || isset($m['currency']));
