<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Splits a migration file into statements. Understands '...' "..." `...` quoting (with backslash
 * and doubled-quote escapes), -- # and slash-star comments, so a semicolon inside a string, an
 * identifier or a comment does not end a statement. No DELIMITER support: migrations here do not
 * define stored routines.
 */
final class Sql
{
    /** @return list<string> */
    public static function split(string $sql): array
    {
        $out = [];
        $cur = '';
        $n = strlen($sql);
        for ($i = 0; $i < $n; $i++) {
            $c = $sql[$i];
            $next = $i + 1 < $n ? $sql[$i + 1] : '';
            if ($c === '-' && $next === '-' && ($i + 2 >= $n || ctype_space($sql[$i + 2]) || ctype_cntrl($sql[$i + 2])) || $c === '#') {
                while ($i < $n && $sql[$i] !== "\n") { $i++; }
                $cur .= "\n";
                continue;
            }
            if ($c === '/' && $next === '*') {
                $end = strpos($sql, '*/', $i + 2);
                $i = $end === false ? $n : $end + 1;
                $cur .= ' ';
                continue;
            }
            if ($c === "'" || $c === '"' || $c === '`') {
                $q = $c;
                $cur .= $c;
                for ($i++; $i < $n; $i++) {
                    $d = $sql[$i];
                    $cur .= $d;
                    if ($d === '\\' && $q !== '`' && $i + 1 < $n) { $cur .= $sql[++$i]; continue; }
                    if ($d === $q) {
                        if ($i + 1 < $n && $sql[$i + 1] === $q) { $cur .= $sql[++$i]; continue; }
                        break;
                    }
                }
                continue;
            }
            if ($c === ';') {
                $t = trim($cur);
                if ($t !== '') { $out[] = $t; }
                $cur = '';
                continue;
            }
            $cur .= $c;
        }
        $t = trim($cur);
        if ($t !== '') { $out[] = $t; }
        return $out;
    }
}
