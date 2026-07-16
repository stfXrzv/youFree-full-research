<?php
declare(strict_types=1);

function fail_redirect(string $message, int $status): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $message;
    exit;
}

$encoded = isset($_GET['u']) ? (string) $_GET['u'] : '';
if ($encoded === '' || strlen($encoded) > 7000) {
    fail_redirect('Invalid download target.', 400);
}

$padding = (4 - (strlen($encoded) % 4)) % 4;
$decoded = base64_decode(strtr($encoded . str_repeat('=', $padding), '-_', '+/'), true);
if ($decoded === false || !filter_var($decoded, FILTER_VALIDATE_URL)) {
    fail_redirect('Invalid download target.', 400);
}

$parts = parse_url($decoded);
$host = strtolower((string) ($parts['host'] ?? ''));
$path = (string) ($parts['path'] ?? '');
if (!preg_match('/(^|\.)googlevideo\.com$/i', $host) || $path !== '/videoplayback') {
    fail_redirect('Download target is not allowed.', 403);
}

$filename = isset($_GET['n']) ? (string) $_GET['n'] : 'video.mp4';
$filename = preg_replace('/[^A-Za-z0-9 ._()-]+/', ' ', $filename) ?? 'video.mp4';
$filename = trim(preg_replace('/\s+/', ' ', $filename) ?? 'video.mp4');
if ($filename === '') {
    $filename = 'video.mp4';
}
$filename = substr($filename, 0, 140);

header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Content-Disposition: attachment; filename="' . addcslashes($filename, '"\\') . '"');
header('Location: ' . $decoded, true, 302);
exit;
