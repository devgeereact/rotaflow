<?php
declare(strict_types=1);

namespace RotaFlow;

/** The sender used when web push is not configured on this deployment. Every push is recorded as skipped, with the reason. */
final class NullPusher implements Pusher
{
    public function send(array $subscription, array $payload): string
    {
        return 'unavailable';
    }
}
