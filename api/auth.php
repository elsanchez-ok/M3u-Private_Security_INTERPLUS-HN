<?php
// En tu servidor, usa .htaccess para proteger la API
// Y HTTPS obligatorio

// Además, agrega rate limiting:
session_start();
$attempts = $_SESSION['login_attempts'] ?? 0;

if ($attempts > 5) {
    die('Demasiados intentos. Espera 15 minutos.');
}
?>
