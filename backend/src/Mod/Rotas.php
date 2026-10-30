<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, MinimumCover, Module, Scope, Time};

/**
 * Rotas and their lifecycle. A rota is a draft, then published, then (when an amendment replaces it) archived.
 * A published or archived rota is never edited: to change a published week you start an amendment, which is a
 * draft copy that supersedes it, and publishing the amendment archives the original in the same transaction.
 * Only an owner or manager writes; staff read published and archived rotas but never a draft.
 */
final class Rotas implements Module
{
    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/rotas', $this->list(...)],
            ['POST', '/orgs/{o}/rotas', $this->create(...)],
            ['POST', '/orgs/{o}/rotas/{r}', $this->rename(...)],
            ['POST', '/orgs/{o}/rotas/{r}/publish', $this->publish(...)],
            ['POST', '/orgs/{o}/rotas/{r}/unpublish', $this->unpublish(...)],
            ['POST', '/orgs/{o}/rotas/{r}/revision', $this->beginRevision(...)],
            ['POST', '/orgs/{o}/rotas/{r}/discard', $this->discardRevision(...)],
            ['POST', '/orgs/{o}/rotas/{r}/repeat', $this->repeat(...)],
        ];
    }

    private function list(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $sql = 'SELECT * FROM rotas WHERE org_id = ?';
        $args = [$o];
        if (!in_array($m['effective_role'], Scope::MANAGERS, true)) {
            $sql .= " AND status IN ('published','archived')"; // a draft is not readable by staff
        }
        if (($loc = Input::optStr($in, 'location_id', 36)) !== null) {
            $sql .= ' AND location_id = ?';
            $args[] = $loc;
        }
        foreach (['from' => 'period_end >= ?', 'to' => 'period_start <= ?'] as $k => $cond) {
            $d = Input::optDate($in, $k);
            if ($d !== null) {
                $sql .= " AND $cond";
                $args[] = $d;
            }
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY period_start DESC, created_at DESC LIMIT 500');
        $q->execute($args);
        return [200, ['rotas' => array_map($this->present(...), $q->fetchAll())]];
    }

    private function create(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = $this->manager($user, $o);
        $start = Input::optDate($in, 'period_start');
        $end = Input::optDate($in, 'period_end');
        if ($start === null || $end === null || $end < $start) {
            throw HttpError::invalid('period_start and period_end are required, and the period cannot end before it starts');
        }
        if ((strtotime($end) - strtotime($start)) / 86400 > 366) { // ASSUMPTION: the old schema had no bound; a year is far beyond any real rota
            throw HttpError::invalid('A rota cannot cover more than a year');
        }
        $loc = Input::optStr($in, 'location_id', 36);
        if ($loc !== null) {
            $this->exists('locations', $loc, $o, HttpError::invalid('That location is not in this organisation'));
        }
        $id = Db::uuid();
        try {
            $pdo->prepare("INSERT INTO rotas (id, org_id, location_id, site_key, name, period_start, period_end, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)")
                ->execute([$id, $o, $loc, $loc ?? '-', Input::reqStr($in, 'name', 120), $start, $end, $user['id']]);
        } catch (\PDOException $e) {
            throw $this->taken($e);
        }
        Audit::log($pdo, $o, $user['id'], 'rota.created', 'rotas', $id, [], 'info', 'org', $ip);
        return [201, ['rota' => $this->present($this->load($o, $id))]];
    }

    /** A draft may be renamed or re-dated. Anything published or archived is history. */
    private function rename(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $rota = $this->lock($o, $r);
            $this->mustBeDraft($rota);
            $name = array_key_exists('name', $in) ? Input::reqStr($in, 'name', 120) : $rota['name'];
            $start = Input::optDate($in, 'period_start') ?? $rota['period_start'];
            $end = Input::optDate($in, 'period_end') ?? $rota['period_end'];
            if ($end < $start) {
                throw HttpError::invalid('The period cannot end before it starts');
            }
            $pdo->prepare('UPDATE rotas SET name = ?, period_start = ?, period_end = ? WHERE id = ?')->execute([$name, $start, $end, $r]);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            throw $this->taken($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['rota' => $this->present($this->load($o, $r))]];
    }

    private function publish(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $rota = $this->lock($o, $r);
            if ($rota['status'] === 'published') {
                $pdo->commit();
                return [200, ['rota' => $this->present($rota)]];
            }
            $this->mustBeDraft($rota, 'rota_not_draft', 'Only a draft rota can be published.');
            $short = $this->shortfall($o, $rota);
            if ($short !== null) {
                throw HttpError::conflict('cover_below_minimum', sprintf(
                    "%s is %d short of its %d-person minimum on %s. Fill the gap, or change that day's minimum in Settings → Policies.",
                    $short['location_name'], $short['min_staff'] - $short['on_shift'], $short['min_staff'], date('l d M', strtotime($short['day']))
                ));
            }
            if ($rota['supersedes_rota_id'] !== null) {
                // The superseded rota is archived first, in the same transaction, so the one-published-per-week key is never broken.
                $pdo->prepare("UPDATE rotas SET status = 'archived', archived_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ? AND status = 'published'")->execute([$rota['supersedes_rota_id'], $o]);
            }
            $pdo->prepare("UPDATE rotas SET status = 'published', published_at = UTC_TIMESTAMP(), published_by = ? WHERE id = ?")->execute([$user['id'], $r]);
            Audit::log($pdo, $o, $user['id'], 'rota.published', 'rotas', $r, ['supersedes' => $rota['supersedes_rota_id']], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            throw $this->taken($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['rota' => $this->present($this->load($o, $r))]];
    }

    private function unpublish(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $rota = $this->lock($o, $r);
            if ($rota['status'] === 'draft') {
                $pdo->commit();
                return [200, ['rota' => $this->present($rota)]];
            }
            if ($rota['status'] !== 'published') {
                throw HttpError::conflict('rota_not_published', 'Only a published rota can be unpublished.');
            }
            $open = $pdo->prepare("SELECT 1 FROM rotas WHERE org_id = ? AND supersedes_rota_id = ? AND status = 'draft'");
            $open->execute([$o, $r]);
            if ($open->fetchColumn() !== false) {
                throw HttpError::conflict('open_amendment', 'This week has an open amendment. Publish or discard the amendment first, then unpublish.');
            }
            $pdo->prepare("UPDATE rotas SET status = 'draft', published_at = NULL, published_by = NULL WHERE id = ?")->execute([$r]);
            Audit::log($pdo, $o, $user['id'], 'rota.unpublished', 'rotas', $r, [], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            throw $this->taken($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['rota' => $this->present($this->load($o, $r))]];
    }

    /** Start (or resume) an amendment of a published rota: a draft copy that supersedes it. */
    private function beginRevision(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $src = $this->lock($o, $r);
            if ($src['status'] !== 'published') {
                throw HttpError::conflict('rota_not_published', 'Only a published rota is amended. A draft is edited directly.');
            }
            $q = $pdo->prepare("SELECT * FROM rotas WHERE org_id = ? AND supersedes_rota_id = ? AND status = 'draft' LIMIT 1 FOR UPDATE");
            $q->execute([$o, $r]);
            $rev = $q->fetch();
            $adopted = false;
            if ($rev === false) {
                $q = $pdo->prepare("SELECT * FROM rotas WHERE org_id = ? AND status = 'draft' AND period_start = ? AND period_end = ? AND site_key = ? LIMIT 1 FOR UPDATE");
                $q->execute([$o, $src['period_start'], $src['period_end'], $src['site_key']]);
                $rev = $q->fetch();
                if ($rev !== false) {
                    $adopted = true; // an existing draft for the same week becomes the amendment
                    $pdo->prepare('UPDATE rotas SET supersedes_rota_id = ? WHERE id = ?')->execute([$r, $rev['id']]);
                    $rev['supersedes_rota_id'] = $r;
                }
            }
            if ($rev === false) {
                $id = Db::uuid();
                $pdo->prepare("INSERT INTO rotas (id, org_id, location_id, site_key, name, period_start, period_end, status, supersedes_rota_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
                    ->execute([$id, $o, $src['location_id'], $src['site_key'], $src['name'], $src['period_start'], $src['period_end'], $r, $user['id']]);
                $rev = ['id' => $id];
            }
            $has = $pdo->prepare('SELECT 1 FROM shifts WHERE rota_id = ? LIMIT 1');
            $has->execute([$rev['id']]);
            if ($has->fetchColumn() === false) {
                $this->copyShifts($o, $r, (string) $rev['id'], 0, null);
            }
            Audit::log($pdo, $o, $user['id'], 'rota.amendment_started', 'rotas', (string) $rev['id'], ['supersedes' => $r, 'adopted_existing_draft' => $adopted], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            throw $this->taken($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['rota' => $this->present($this->load($o, (string) $rev['id']))]];
    }

    /** Throw away an open amendment and its shifts. Returns the published rota it would have replaced. */
    private function discardRevision(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $rev = $this->lock($o, $r);
            if ($rev['status'] !== 'draft' || $rev['supersedes_rota_id'] === null) {
                throw HttpError::conflict('not_an_amendment', 'That rota is not an open amendment.');
            }
            $n = $pdo->prepare('SELECT COUNT(*) FROM shifts WHERE rota_id = ?');
            $n->execute([$r]);
            Audit::log($pdo, $o, $user['id'], 'rota.amendment_discarded', 'rotas', $r, ['supersedes' => $rev['supersedes_rota_id'], 'discarded_shifts' => (int) $n->fetchColumn()], 'warning', 'org', $ip);
            $pdo->prepare('DELETE FROM shifts WHERE rota_id = ?')->execute([$r]);
            $pdo->prepare('DELETE FROM rotas WHERE id = ? AND org_id = ?')->execute([$r, $o]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['rota' => $this->present($this->load($o, (string) $rev['supersedes_rota_id']))]];
    }

    /** Copy a rota's shifts into the following 1..26 weeks, skipping weeks that are published or already have shifts. */
    private function repeat(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $weeks = Input::optNum($in, 'weeks', 1, 26);
        if ($weeks === null || $weeks !== floor($weeks)) {
            throw HttpError::invalid('weeks must be a whole number from 1 to 26');
        }
        $made = $shifts = $skipped = 0;
        $pdo->beginTransaction();
        try {
            $src = $this->lock($o, $r);
            for ($w = 1; $w <= (int) $weeks; $w++) {
                $start = date('Y-m-d', strtotime($src['period_start'] . " +{$w} weeks"));
                $end = date('Y-m-d', strtotime($src['period_end'] . " +{$w} weeks"));
                $q = $pdo->prepare("SELECT * FROM rotas WHERE org_id = ? AND period_start = ? AND period_end = ? AND site_key = ? AND status IN ('draft','published') ORDER BY status = 'published' DESC LIMIT 1 FOR UPDATE");
                $q->execute([$o, $start, $end, $src['site_key']]);
                $existing = $q->fetch();
                if ($existing !== false) {
                    $has = $pdo->prepare('SELECT 1 FROM shifts WHERE rota_id = ? LIMIT 1');
                    $has->execute([$existing['id']]);
                    if ($existing['status'] === 'published' || $has->fetchColumn() !== false) {
                        $skipped++;
                        continue;
                    }
                    $target = (string) $existing['id'];
                } else {
                    $target = Db::uuid();
                    $pdo->prepare("INSERT INTO rotas (id, org_id, location_id, site_key, name, period_start, period_end, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)")
                        ->execute([$target, $o, $src['location_id'], $src['site_key'], 'Week of ' . date('d M Y', strtotime($start)), $start, $end, $user['id']]);
                    $made++;
                }
                $shifts += $this->copyShifts($o, $r, $target, 7 * $w, null);
            }
            Audit::log($pdo, $o, $user['id'], 'rota.repeated', 'rotas', $r, ['weeks' => (int) $weeks, 'shifts_created' => $shifts, 'weeks_skipped' => $skipped], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['weeks_created' => $made, 'shifts_created' => $shifts, 'weeks_skipped' => $skipped]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** Copies the non-cancelled shifts of $from into $to, moved $days later in each shift's site time zone. Returns how many. */
    private function copyShifts(string $o, string $from, string $to, int $days, ?string $unused): int
    {
        $q = $this->ctx->pdo->prepare(
            "SELECT s.*, COALESCE(l.timezone, 'UTC') AS tz FROM shifts s LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.rota_id = ? AND s.org_id = ? AND s.status <> 'cancelled'"
        );
        $q->execute([$from, $o]);
        $ins = $this->ctx->pdo->prepare('INSERT INTO shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $n = 0;
        foreach ($q->fetchAll() as $s) {
            $ins->execute([
                Db::uuid(), $o, $to, $s['location_id'], $s['department_id'], $s['staff_profile_id'], $s['shift_type_id'],
                $days === 0 ? $s['starts_at'] : Time::plusLocalDays($s['starts_at'], $s['tz'], $days),
                $days === 0 ? $s['ends_at'] : Time::plusLocalDays($s['ends_at'], $s['tz'], $days),
                $s['break_minutes'], $s['status'], $s['colour'], $s['notes'],
            ]);
            $n++;
        }
        return $n;
    }

    /** @return array{location_name:string,day:string,min_staff:int,on_shift:int}|null */
    private function shortfall(string $o, array $rota): ?array
    {
        $pdo = $this->ctx->pdo;
        $rules = $pdo->prepare('SELECT r.location_id, l.name AS location_name, l.timezone, r.weekday, r.min_staff FROM minimum_cover_rules r JOIN locations l ON l.id = r.location_id AND l.org_id = r.org_id WHERE r.org_id = ?');
        $rules->execute([$o]);
        $shifts = $pdo->prepare("SELECT location_id, staff_profile_id, starts_at FROM shifts WHERE rota_id = ? AND status <> 'cancelled'");
        $shifts->execute([$rota['id']]);
        return MinimumCover::firstShortfall(
            array_map(static fn (array $r): array => ['weekday' => (int) $r['weekday'], 'min_staff' => (int) $r['min_staff']] + $r, $rules->fetchAll()),
            $shifts->fetchAll(), $rota['location_id'], $rota['period_start'], $rota['period_end'], new \DateTimeImmutable('now', new \DateTimeZone('UTC'))
        );
    }

    private function manager(array $user, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        return $m;
    }

    /** @return array<string,mixed> */
    private function load(string $o, string $r): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM rotas WHERE id = ? AND org_id = ?');
        $q->execute([$r, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** Row lock inside a transaction: publishing, amending and editing a rota's shifts all take it, so they queue. */
    private function lock(string $o, string $r): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM rotas WHERE id = ? AND org_id = ? FOR UPDATE');
        $q->execute([$r, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function mustBeDraft(array $rota, string $code = 'rota_not_draft', string $msg = 'Only a draft rota can be changed. Start an amendment to change a published one.'): void
    {
        if ($rota['status'] !== 'draft') {
            throw HttpError::conflict($code, $msg);
        }
    }

    private function exists(string $table, string $id, string $org, HttpError $else): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) {
            throw $else;
        }
    }

    private function taken(\PDOException $e): \Throwable
    {
        if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'rotas_one_')) {
            return HttpError::conflict('rota_exists', 'There is already a rota for that site and period in that state');
        }
        return $e;
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        unset($r['site_key']);
        foreach (['published_at', 'archived_at', 'created_at', 'updated_at'] as $k) {
            $r[$k] = Time::iso($r[$k] ?? null);
        }
        return $r;
    }
}
