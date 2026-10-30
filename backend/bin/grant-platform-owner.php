<?php
declare(strict_types=1);

// CLI only. Makes <email> a platform owner (Super Admin). Creates the person if they have never signed in; their first
// sign-in with that verified email links the row. Idempotent. This is the ONLY way the first administrator exists:
// there is no endpoint for it. Usage: php bin/grant-platform-owner.php you@example.com
// Env: ROTAFLOW_PRIVATE_ROOT, ROTAFLOW_CONFIG_FILE (default config.php, the runtime identity: it only needs INSERT/UPDATE).
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Audit, Bootstrap, Db};

$email = strtolower(trim($argv[1] ?? ''));
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, "usage: grant-platform-owner.php <email>\n");
    exit(1);
}
$root = Bootstrap::privateRoot();
$pdo = Db::connect(Bootstrap::config($root, getenv('ROTAFLOW_CONFIG_FILE') ?: 'config.php'));
$pdo->beginTransaction();
$q = $pdo->prepare('SELECT id FROM users WHERE email = ? FOR UPDATE');
$q->execute([$email]);
$id = $q->fetchColumn();
if ($id === false) {
    $id = Db::uuid();
    $pdo->prepare('INSERT INTO users (id, email) VALUES (?, ?)')->execute([$id, $email]);
}
$pdo->prepare(
    "INSERT INTO platform_admins (user_id, role, note) VALUES (?, 'platform_owner', 'granted by bin/grant-platform-owner.php')
     ON DUPLICATE KEY UPDATE role = 'platform_owner', revoked_at = NULL, revoked_by = NULL"
)->execute([$id]);
Audit::log($pdo, null, null, 'platform.owner_granted', 'platform_admins', $id, [], 'critical', 'platform_only');
$pdo->commit();
echo "platform owner set\n";
