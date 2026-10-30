<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * The platform's view of money: the billing summary, an invoice directory, and credits against invoices. Owner, admin and finance only.
 * A credit is a record, not a refund: it moves no money and changes no invoice. Totals are kept per currency and never converted.
 */
final class PlatformBilling implements Module
{
    private const ROLES = ['platform_owner', 'platform_admin', 'platform_finance'];
    private const CREDITABLE = ['open', 'past_due', 'paid'];
    private const STATUSES = ['draft', 'open', 'paid', 'past_due', 'refunded', 'void'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/billing/summary', $this->summary(...)],
            ['GET', '/platform/invoices', $this->invoices(...)],
            ['GET', '/platform/invoices/{i}/credits', $this->credits(...)],
            ['POST', '/platform/invoices/{i}/credits', $this->credit(...)],
            ['GET', '/orgs/{o}/invoices/{i}/credits', $this->orgCredits(...)],
        ];
    }

    private function staff(array $user): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), self::ROLES, true)) {
            throw HttpError::notFound();
        }
    }

    /** One row per currency: monthly recurring revenue (active and past-due subscriptions), what was collected this and last month, and what is owed. */
    private function summary(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $pdo = $this->ctx->pdo;
        $month = gmdate('Y-m-01 00:00:00');
        $prev = gmdate('Y-m-01 00:00:00', strtotime('first day of last month 00:00:00 UTC'));
        $rows = [];
        $row = static function (string $c) use (&$rows): void {
            $rows[$c] ??= ['currency' => $c, 'mrr_pence' => 0, 'paying_orgs' => 0, 'collected_month_pence' => 0, 'collected_prev_month_pence' => 0, 'outstanding_pence' => 0, 'past_due_pence' => 0, 'refunded_month_pence' => 0, 'open_invoices' => 0, 'past_due_invoices' => 0, 'refunded_invoices' => 0];
        };
        foreach ($pdo->query("SELECT UPPER(s.currency) AS c, COUNT(*) AS n, SUM(COALESCE(s.price_pence, p.monthly_price_pence, 0)) AS mrr FROM subscriptions s LEFT JOIN plans p ON p.code = s.plan WHERE s.status IN ('active','past_due') GROUP BY UPPER(s.currency)")->fetchAll() as $r) {
            $row($r['c']);
            $rows[$r['c']]['mrr_pence'] = (int) $r['mrr'];
            $rows[$r['c']]['paying_orgs'] = (int) $r['n'];
        }
        $q = $pdo->prepare(
            "SELECT UPPER(currency) AS c,
                    COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= ? THEN amount_pence END), 0) AS collected,
                    COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= ? AND paid_at < ? THEN amount_pence END), 0) AS collected_prev,
                    COALESCE(SUM(CASE WHEN status IN ('open','past_due') THEN amount_pence END), 0) AS outstanding,
                    COALESCE(SUM(CASE WHEN status = 'past_due' THEN amount_pence END), 0) AS past_due,
                    COALESCE(SUM(CASE WHEN refunded_at >= ? THEN amount_pence END), 0) AS refunded,
                    SUM(status IN ('open','past_due')) AS open_n, SUM(status = 'past_due') AS past_n, SUM(refunded_at >= ?) AS refunded_n
               FROM invoices GROUP BY UPPER(currency)"
        );
        $q->execute([$month, $prev, $month, $month, $month]);
        foreach ($q->fetchAll() as $r) {
            $row($r['c']);
            $rows[$r['c']] = array_replace($rows[$r['c']], ['collected_month_pence' => (int) $r['collected'], 'collected_prev_month_pence' => (int) $r['collected_prev'], 'outstanding_pence' => (int) $r['outstanding'], 'past_due_pence' => (int) $r['past_due'], 'refunded_month_pence' => (int) $r['refunded'], 'open_invoices' => (int) $r['open_n'], 'past_due_invoices' => (int) $r['past_n'], 'refunded_invoices' => (int) $r['refunded_n']]);
        }
        usort($rows, static fn (array $a, array $b): int => ($b['mrr_pence'] + $b['collected_month_pence']) <=> ($a['mrr_pence'] + $a['collected_month_pence']));
        return [200, ['summary' => array_values($rows)]];
    }

    private function invoices(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $where = ['1 = 1'];
        $args = [];
        if (($q = Input::optStr($in, 'q', 100)) !== null) {
            $where[] = '(i.number LIKE ? OR o.name LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($args, $like, $like);
        }
        if (($s = Input::optStr($in, 'status', 20)) !== null) {
            if (!in_array($s, self::STATUSES, true)) {
                throw HttpError::invalid('status is not recognised');
            }
            $where[] = 'i.status = ?';
            $args[] = $s;
        }
        if (($c = Input::optStr($in, 'currency', 3)) !== null) {
            $where[] = 'i.currency = ?';
            $args[] = strtoupper($c);
        }
        if (($org = Input::optStr($in, 'org_id', 36)) !== null) {
            $where[] = 'i.org_id = ?';
            $args[] = $org;
        }
        if (($f = Input::optDate($in, 'from')) !== null) {
            $where[] = 'i.issued_on >= ?';
            $args[] = $f;
        }
        if (($t = Input::optDate($in, 'to')) !== null) { // exclusive
            $where[] = 'i.issued_on < ?';
            $args[] = $t;
        }
        $limit = (int) (Input::optNum($in, 'limit', 1, 200) ?? 25);
        $offset = (int) (Input::optNum($in, 'offset', 0, 1000000) ?? 0);
        $w = implode(' AND ', $where);
        $st = $this->ctx->pdo->prepare("SELECT i.id, i.number, i.org_id, o.name AS org_name, i.amount_pence, i.tax_pence, i.currency, i.status, i.issued_on, i.due_on, i.paid_at, i.refunded_at, i.attempts, COALESCE((SELECT SUM(c.amount_pence) FROM invoice_credits c WHERE c.invoice_id = i.id), 0) AS credited_pence FROM invoices i JOIN organisations o ON o.id = i.org_id WHERE $w ORDER BY i.issued_on DESC, i.id LIMIT $limit OFFSET $offset");
        $st->execute($args);
        $cnt = $this->ctx->pdo->prepare("SELECT COUNT(*) FROM invoices i JOIN organisations o ON o.id = i.org_id WHERE $w");
        $cnt->execute($args);
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            $r['credited_pence'] = (int) $r['credited_pence']; // SUM() arrives as text
        }
        return [200, ['invoices' => $rows, 'total' => (int) $cnt->fetchColumn()]];
    }

    private function credits(array $user, array $in, string $ip, string $i): array
    {
        $this->staff($user);
        return [200, ['credits' => $this->creditRows($i, null)]];
    }

    /** The organisation's owner sees the credits on their own invoices. */
    private function orgCredits(array $user, array $in, string $ip, string $o, string $i): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        return [200, ['credits' => $this->creditRows($i, $o)]];
    }

    /** @return list<array<string,mixed>> */
    private function creditRows(string $invoice, ?string $org): array
    {
        $q = $this->ctx->pdo->prepare('SELECT id, amount_pence, currency, reason, created_by, created_at FROM invoice_credits WHERE invoice_id = ?' . ($org === null ? '' : ' AND org_id = ?') . ' ORDER BY created_at, id');
        $q->execute($org === null ? [$invoice] : [$invoice, $org]);
        return $q->fetchAll();
    }

    /**
     * Record a credit. A retry with the same idempotency key returns the same credit and checks nothing else. The ceiling is the invoice total
     * (net plus tax) less what is already credited, measured under a lock on the invoice so two credits cannot both fit.
     */
    private function credit(array $user, array $in, string $ip, string $i): array
    {
        $this->staff($user);
        $amount = $in['amount_pence'] ?? null;
        $key = Input::optStr($in, 'idempotency_key', 100);
        $pdo = $this->ctx->pdo;
        if ($key !== null) {
            $dup = $pdo->prepare('SELECT id FROM invoice_credits WHERE invoice_id = ? AND idempotency_key = ?');
            $dup->execute([$i, $key]);
            if (($id = $dup->fetchColumn()) !== false) {
                return [200, ['id' => $id, 'already_recorded' => true]];
            }
        }
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT id, org_id, number, status, currency, amount_pence, tax_pence FROM invoices WHERE id = ? FOR UPDATE');
            $q->execute([$i]);
            $inv = $q->fetch() ?: throw HttpError::notFound();
            if (!in_array($inv['status'], self::CREDITABLE, true)) {
                throw new HttpError(422, 'not_creditable', "An invoice that is {$inv['status']} cannot be credited. Only an open, past due or paid invoice can be credited.");
            }
            if (!is_int($amount) || $amount < 1) {
                throw HttpError::invalid('A credit must be a positive amount');
            }
            $reason = trim(Input::str($in, 'reason'));
            if (\RotaFlow\Str::len($reason) < 10 || \RotaFlow\Str::len($reason) > 1000) {
                throw HttpError::invalid('A credit needs a reason saying why it was given (10 to 1000 characters)');
            }
            $sum = $pdo->prepare('SELECT COALESCE(SUM(amount_pence), 0) FROM invoice_credits WHERE invoice_id = ?');
            $sum->execute([$i]);
            $already = (int) $sum->fetchColumn();
            $gross = (int) $inv['amount_pence'] + (int) $inv['tax_pence'];
            if ($already + $amount > $gross) {
                throw HttpError::invalid('That would credit ' . ($already + $amount - $gross) . ' more than the invoice is worth. The ceiling is the invoice total less what is already credited.');
            }
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO invoice_credits (id, invoice_id, org_id, amount_pence, currency, reason, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $i, $inv['org_id'], $amount, strtoupper($inv['currency']), $reason, $key, $user['id']]);
            Audit::log($pdo, $inv['org_id'], $user['id'], 'invoice.credited', 'invoices', $i, ['credit_id' => $id, 'amount_pence' => $amount, 'currency' => strtoupper($inv['currency']), 'invoice_number' => $inv['number'], 'reason' => $reason], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id]];
    }
}
