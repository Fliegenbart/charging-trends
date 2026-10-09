<?php
/**
 * Anfrage-Versand für die App "Charging Trends 2027"
 * Empfängt die Formulardaten (JSON) und schickt sie per E-Mail an den Anzeigenverkauf.
 * Nutzt die PHP-Funktion mail() des Webservers.
 */

// ---- Einstellungen -------------------------------------------------------
$EMPFAENGER = 'mathias.herbig@electrifiedmagazin.de';
$ABSENDER   = 'noreply@electrifiedmagazin.de';   // Adresse auf eurer Domain, damit die Mail nicht im Spam landet
$BETREFF    = 'Anfrage Charging Trends 2027';
// ---------------------------------------------------------------------------

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function antwort($code, $daten) {
    http_response_code($code);
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    antwort(405, ['ok' => false, 'error' => 'Nur POST erlaubt.']);
}

// Nur Anfragen von der eigenen Website annehmen
$herkunft = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
if ($herkunft !== '' && !preg_match('~^https?://(www\.)?electrifiedmagazin\.de(/|$)~i', $herkunft)) {
    antwort(403, ['ok' => false, 'error' => 'Anfrage nicht erlaubt.']);
}

$roh = file_get_contents('php://input');
if (strlen($roh) > 4000000) {
    antwort(413, ['ok' => false, 'error' => 'Anfrage zu groß.']);
}
$d = json_decode($roh, true);
if (!is_array($d)) {
    antwort(400, ['ok' => false, 'error' => 'Ungültige Daten.']);
}

// Spam-Falle: Dieses Feld ist für Menschen unsichtbar
if (!empty($d['website'])) {
    antwort(200, ['ok' => true]);
}

// Einfache Bremse: höchstens eine Anfrage pro 30 Sekunden je IP
$ip = $_SERVER['REMOTE_ADDR'] ?? 'x';
$sperre = sys_get_temp_dir() . '/ct27_' . md5($ip);
if (file_exists($sperre) && time() - filemtime($sperre) < 30) {
    antwort(429, ['ok' => false, 'error' => 'Bitte warten Sie einen Moment und senden Sie dann erneut.']);
}

function feld($d, $key, $max = 500) {
    $wert = isset($d[$key]) ? trim((string)$d[$key]) : '';
    return mb_substr($wert, 0, $max);
}
function einzeilig($s) {
    return trim(preg_replace('/[\r\n\t]+/', ' ', $s));
}

$firma     = einzeilig(feld($d, 'firma', 200));
$name      = einzeilig(feld($d, 'name', 200));
$email     = einzeilig(feld($d, 'email', 200));
$telefon   = einzeilig(feld($d, 'telefon', 60));
$nachricht = feld($d, 'nachricht', 3000);
$auswahl   = feld($d, 'auswahl', 4000);
$dsgvo     = !empty($d['datenschutz']);

if ($firma === '' || $name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    antwort(422, ['ok' => false, 'error' => 'Bitte Firma, Ansprechpartner und eine gültige E-Mail-Adresse angeben.']);
}
if (!$dsgvo) {
    antwort(422, ['ok' => false, 'error' => 'Bitte der Verarbeitung Ihrer Angaben zustimmen.']);
}

$text  = "Neue Anfrage über die App „Charging Trends 2027“\n";
$text .= "==============================================\n\n";
$text .= "Firma:           $firma\n";
$text .= "Ansprechpartner: $name\n";
$text .= "E-Mail:          $email\n";
$text .= "Telefon:         " . ($telefon !== '' ? $telefon : '–') . "\n\n";
$text .= "Auswahl / Kalkulation\n---------------------\n$auswahl\n\n";
$text .= "Nachricht\n---------\n" . ($nachricht !== '' ? $nachricht : '–') . "\n\n";
$text .= "Datenschutz-Einwilligung: ja\n";
$text .= "Gesendet: " . date('d.m.Y H:i') . " Uhr\n";

// PDF mit Anschreiben und Kalkulation (im Browser erzeugt)
$pdf = '';
if (!empty($d['pdf']) && is_string($d['pdf'])) {
    $bin = base64_decode($d['pdf'], true);
    if ($bin !== false && strncmp($bin, '%PDF', 4) === 0 && strlen($bin) < 3000000) {
        $pdf = $bin;
    }
}
$pdfname = preg_replace('/[^A-Za-z0-9ÄÖÜäöüß._-]+/u', '-', feld($d, 'pdfname', 120));
if ($pdfname === '' || substr($pdfname, -4) !== '.pdf') {
    $pdfname = 'Anfrage_Charging-Trends-2027.pdf';
}
if ($pdf !== '') {
    $text = "Im Anhang: Anschreiben und Kalkulation als PDF.\n\n" . $text;
}

$betreff = '=?UTF-8?B?' . base64_encode("$BETREFF – $firma") . '?=';
$kopf  = "From: electrified Anfrage <$ABSENDER>\r\n";
$kopf .= "Reply-To: $email\r\n";
$kopf .= "MIME-Version: 1.0\r\n";

if ($pdf !== '') {
    $grenze = 'ct27_' . bin2hex(random_bytes(12));
    $kopf .= "Content-Type: multipart/mixed; boundary=\"$grenze\"\r\n";
    $inhalt  = "--$grenze\r\n";
    $inhalt .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $inhalt .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $inhalt .= chunk_split(base64_encode($text)) . "\r\n";
    $inhalt .= "--$grenze\r\n";
    $inhalt .= "Content-Type: application/pdf; name=\"$pdfname\"\r\n";
    $inhalt .= "Content-Transfer-Encoding: base64\r\n";
    $inhalt .= "Content-Disposition: attachment; filename=\"$pdfname\"\r\n\r\n";
    $inhalt .= chunk_split(base64_encode($pdf)) . "\r\n";
    $inhalt .= "--$grenze--\r\n";
} else {
    $kopf .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $kopf .= "Content-Transfer-Encoding: 8bit\r\n";
    $inhalt = $text;
}

$gesendet = @mail($EMPFAENGER, $betreff, $inhalt, $kopf, '-f' . $ABSENDER);

if (!$gesendet) {
    antwort(500, ['ok' => false, 'error' => 'Die Anfrage konnte nicht gesendet werden. Bitte schreiben Sie an ' . $EMPFAENGER . '.']);
}

@touch($sperre);
antwort(200, ['ok' => true]);
