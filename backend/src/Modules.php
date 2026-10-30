<?php
declare(strict_types=1);

namespace RotaFlow;

/** Every module class in src/Mod/*.php that implements Module, in file-name order. */
final class Modules
{
    /** @return list<Module> */
    public static function all(Ctx $ctx): array
    {
        $out = [];
        $files = glob(__DIR__ . '/Mod/*.php') ?: [];
        sort($files);
        foreach ($files as $f) {
            $class = 'RotaFlow\\Mod\\' . basename($f, '.php');
            if (class_exists($class) && is_subclass_of($class, Module::class)) {
                $out[] = new $class($ctx);
            }
        }
        return $out;
    }
}
