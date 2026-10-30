<?php
declare(strict_types=1);

namespace RotaFlow;

/** Sends one web push. The real sender (VAPID, Web Push encryption) is added in the next part of this slice; until then NullPusher says so. */
interface Pusher
{
    /**
     * @param array{endpoint:string,p256dh:string,auth_key:string} $subscription
     * @param array{title:string,body?:?string} $payload
     * @return 'sent'|'expired'|'failed'|'unavailable'
     */
    public function send(array $subscription, array $payload): string;
}
