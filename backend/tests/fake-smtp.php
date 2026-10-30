<?php
declare(strict_types=1);

// A tiny SMTP server for tests: php fake-smtp.php <port> <outfile>
// Accepts any login, appends every received message to <outfile> as "--MSG--\nRCPT: ...\n<raw message>", and answers 550 to an address containing "bounce".
$port = (int) ($argv[1] ?? 0);
$out = (string) ($argv[2] ?? '');
$srv = @stream_socket_server("tcp://127.0.0.1:$port", $errno, $errstr);
if ($srv === false || $out === '') {
    fwrite(STDERR, "cannot listen\n");
    exit(1);
}
while (($c = @stream_socket_accept($srv, 3600)) !== false) {
    stream_set_timeout($c, 5);
    fwrite($c, "220 fake ESMTP\r\n");
    $rcpt = '';
    $data = false;
    $buf = '';
    while (($line = fgets($c, 8192)) !== false) {
        if ($data) {
            if ($line === ".\r\n") {
                file_put_contents($out, "--MSG--\nRCPT: $rcpt\n" . $buf . "\n", FILE_APPEND | LOCK_EX);
                fwrite($c, "250 queued\r\n");
                $data = false;
                $buf = '';
                continue;
            }
            $buf .= $line;
            continue;
        }
        $cmd = strtoupper(substr($line, 0, 4));
        if ($cmd === 'EHLO' || $cmd === 'HELO') {
            fwrite($c, "250-fake\r\n250 AUTH PLAIN\r\n");
        } elseif ($cmd === 'AUTH') {
            fwrite($c, "235 ok\r\n");
        } elseif ($cmd === 'MAIL') {
            fwrite($c, "250 ok\r\n");
        } elseif ($cmd === 'RCPT') {
            $rcpt = trim(substr($line, 8), " <>\r\n");
            fwrite($c, str_contains($rcpt, 'bounce') ? "550 no such user\r\n" : "250 ok\r\n");
        } elseif ($cmd === 'DATA') {
            fwrite($c, "354 go\r\n");
            $data = true;
        } elseif ($cmd === 'QUIT') {
            fwrite($c, "221 bye\r\n");
            break;
        } else {
            fwrite($c, "250 ok\r\n");
        }
    }
    fclose($c);
}
