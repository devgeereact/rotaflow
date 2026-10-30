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
    // 'invite_only' (default): a platform administrator creates organisations and invites the first owner.
    // 'open': any signed-in person may create one.
    'org_creation' => 'invite_only',
    // 32 random bytes, base64 (openssl rand -base64 32). Encrypts organisations' SMTP passwords. Losing it means they must be re-entered.
    'secret_key' => 'REPLACE_ME',
    // The platform's own mail account, used when an organisation has none. Port 465 = implicit TLS; 587 = STARTTLS. Omit to send no platform email.
    'smtp' => ['host' => 'mail.example.com', 'port' => 465, 'user' => 'noreply@rotaflow.space', 'password' => 'REPLACE_ME', 'from_email' => 'noreply@rotaflow.space', 'from_name' => 'RotaFlow'],
    // Web push (the existing VAPID keys). public = the value of VITE_VAPID_PUBLIC_KEY. Omit to leave push off.
    'vapid' => ['public' => 'REPLACE_ME', 'private' => 'REPLACE_ME', 'subject' => 'mailto:support@rotaflow.space'],
];
