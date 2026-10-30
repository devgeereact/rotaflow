<?php
declare(strict_types=1);

namespace RotaFlow;

/** Reads request fields strictly: a value of the wrong type is "absent", never cast (an array cast to string is a warning and a bug). */
final class Input
{
    /** @param array<string,mixed> $in */
    public static function str(array $in, string $key): string
    {
        $v = $in[$key] ?? '';
        return is_string($v) ? $v : '';
    }
}
