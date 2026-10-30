<?php
declare(strict_types=1);

namespace RotaFlow;

/** A failed Stripe call. The message is Stripe's own and is only logged by category, never shown to the browser. */
final class StripeError extends \RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $stripeCode, string $message)
    {
        parent::__construct($message, $status);
    }
}
