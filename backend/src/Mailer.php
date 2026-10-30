<?php
declare(strict_types=1);

namespace RotaFlow;

interface Mailer
{
    /** Sends one message. Returns false on any failure; never throws and never leaks details to callers. */
    public function send(string $toEmail, string $subject, string $text, string $html = ''): bool;

    /** A short, non-sensitive category of the last failure, for logs and the delivery record. */
    public function lastError(): string;
}
