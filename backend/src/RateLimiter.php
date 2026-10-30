<?php
declare(strict_types=1);

namespace RotaFlow;

/** Fixed-window counter in MariaDB. Cheap abuse control for sign-up, invite and public actions. */
final class RateLimiter
{
    public function __construct(private readonly \PDO $pdo, private readonly int $now = 0) {}

    public function hit(string $name, string $subject, int $limit, int $windowSeconds): void
    {
        $now = $this->now ?: time();
        $start = $now - ($now % $windowSeconds);
        $bucket = hash('sha256', $name . '|' . $subject);
        $this->pdo->prepare('INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1')
            ->execute([$bucket, $start]);
        $q = $this->pdo->prepare('SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?');
        $q->execute([$bucket, $start]);
        if ((int) $q->fetchColumn() > $limit) {
            throw new HttpError(429, 'rate_limited', 'Too many attempts. Please wait and try again.');
        }
        // Opportunistic cleanup of old windows.
        if (random_int(1, 50) === 1) {
            $this->pdo->prepare('DELETE FROM rate_limits WHERE window_start < ?')->execute([$now - 86400]);
        }
    }
}
