<?php
// Copy to <private root>/config/config.php on the server (mode 600, outside every web root). Placeholders only.
// The migration identity (schema rights) goes in <private root>/config/migrate.php with the same dsn/user/password keys.
return [
    'dsn' => 'mysql:host=localhost;dbname=CPANELUSER_rotaflow;charset=utf8mb4',
    'user' => 'CPANELUSER_rfapp',      // runtime user: SELECT, INSERT, UPDATE, DELETE only
    'password' => 'REPLACE_ME',
    'app_url' => 'https://rotaflow.space',
    // Clerk frontend API for the production instance, https, no trailing slash.
    'clerk_issuer' => 'https://clerk.rotaflow.space',
    // Exact origins allowed in the token's "azp" claim. Add https://local.rotaflow.space for local-live.
    'clerk_authorized_parties' => ['https://rotaflow.space'],
    // Honour CF-Connecting-IP only when the request really came from Cloudflare.
    'trust_cf_connecting_ip' => true,
];
