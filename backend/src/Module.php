<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * A feature module contributes routes. Paths use {name} placeholders, which match UUIDs only
 * (e.g. '/orgs/{o}/shifts/{s}'). Handlers receive ($principal, $input, $ip, ...placeholders)
 * and return [status, payload]. Every org-scoped handler MUST start with Scope::membership().
 * A route with a 4th element 'public' needs no sign-in and must authorise itself.
 * A module may also provide `public static function cron(Ctx $ctx): string` for bin/cron.php.
 */
interface Module
{
    /** @return list<array{0:string,1:string,2:callable,3?:string}> */
    public function routes(): array;
}
