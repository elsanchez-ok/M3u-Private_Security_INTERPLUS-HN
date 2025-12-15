<?php
// api/config.php - CONFIGURACIÓN SECRETA
return [
    'nocodb' => [
        'api_url' => 'https://TU_NocoDB_URL/api/v1/db/data/',
        'api_key' => 'TU_API_KEY_SECRETA', // API Token de NocoDB
        'project_id' => 'TU_PROJECT_ID'
    ],
    'security' => [
        'secret_key' => bin2hex(random_bytes(32)),
        'token_expiry' => 3600, // 1 hora
        'max_devices' => 1
    ],
    'stream' => [
        'encryption_key' => bin2hex(random_bytes(32))
    ]
];
?>
