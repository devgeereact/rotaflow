<?php
declare(strict_types=1);

namespace RotaFlow;

/** Shared services handed to every module. */
final class Ctx
{
    /** @param ?callable(string):void $log */
    public function __construct(
        public readonly \PDO $pdo,
        public readonly RateLimiter $limits,
        public readonly string $appUrl = '',
        public readonly string $privateRoot = '',
        private $log = null,
        /** 'invite_only' (default): only a platform administrator creates organisations, by inviting the first owner. 'open': any signed-in person may. */
        public readonly string $orgCreation = 'invite_only',
        /** Private config (smtp, secret_key, vapid, ...). Never logged, never returned to a client. @var array<string,mixed> */
        public readonly array $config = [],
    ) {}

    /** Short, non-sensitive categories only. Never log tokens, emails, bodies or file contents. */
    public function log(string $message): void
    {
        if ($this->log !== null) {
            ($this->log)($message);
        }
    }
}
