<?php
// api/auth.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://tudominio.com'); // SOLO tu dominio
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Configuración de NocoDB
define('NOCODB_URL', 'https://tu-nocodb.com/api/v1/db/data/');
define('API_KEY', 'tu-api-key-secreta-aqui');
define('ENCRYPTION_KEY', 'clave-secreta-32-caracteres'); // Para encriptar streams

// Encriptación AES-256
function encryptStreamUrl($url) {
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($url, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
    return base64_encode($iv . $encrypted);
}

function decryptStreamUrl($encrypted) {
    $data = base64_decode($encrypted);
    $iv = substr($data, 0, 16);
    $encrypted = substr($data, 16);
    return openssl_decrypt($encrypted, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
}

// Función para llamar a NocoDB API
function callNocoDB($endpoint, $method = 'GET', $data = null) {
    $url = NOCODB_URL . $endpoint;
    $headers = [
        'xc-auth: ' . API_KEY,
        'Content-Type: application/json'
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}

// Procesar solicitud
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $_GET['action'] ?? '';
    
    switch ($action) {
        case 'login':
            handleLogin($input);
            break;
            
        case 'verify':
            verifySession($input);
            break;
            
        case 'logout':
            logout($input);
            break;
            
        case 'get_stream':
            getStreamUrl($input);
            break;
            
        case 'admin_users':
            getUsersList($input);
            break;
            
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Acción no válida']);
    }
}

function handleLogin($data) {
    // 1. Buscar usuario en NocoDB
    $users = callNocoDB('users?where=(username,eq,' . $data['username'] . ')');
    
    if (empty($users['list'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Usuario no encontrado']);
        return;
    }
    
    $user = $users['list'][0];
    
    // 2. Verificar contraseña (debería estar hasheada con password_hash())
    if (!password_verify($data['password'], $user['password_hash'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Contraseña incorrecta']);
        return;
    }
    
    // 3. Verificar estado
    if ($user['status'] !== 'active') {
        http_response_code(403);
        echo json_encode(['error' => 'Cuenta inactiva']);
        return;
    }
    
    // 4. Verificar sesiones activas
    $sessions = callNocoDB('sessions?where=(user_id,eq,' . $user['id'] . ')~(is_active,eq,true)');
    $activeSessions = $sessions['list'] ?? [];
    
    // 5. Verificar límite de dispositivos
    if (count($activeSessions) >= $user['max_devices']) {
        // Si ya hay sesión en otro dispositivo
        foreach ($activeSessions as $session) {
            if ($session['device_id'] !== $data['deviceId']) {
                http_response_code(409);
                echo json_encode([
                    'error' => 'Sesión activa en otro dispositivo',
                    'device_id' => $session['device_id']
                ]);
                return;
            }
        }
    }
    
    // 6. Crear nueva sesión
    $sessionToken = bin2hex(random_bytes(32));
    $newSession = [
        'user_id' => $user['id'],
        'device_id' => $data['deviceId'],
        'session_token' => $sessionToken,
        'ip_address' => $_SERVER['REMOTE_ADDR'],
        'user_agent' => $data['userAgent'],
        'login_time' => date('Y-m-d H:i:s'),
        'last_activity' => date('Y-m-d H:i:s'),
        'is_active' => true
    ];
    
    callNocoDB('sessions', 'POST', $newSession);
    
    // 7. Obtener stream asignado
    $streams = callNocoDB('streams?where=(user_id,eq,' . $user['id'] . ')~(is_active,eq,true)');
    $streamUrl = !empty($streams['list']) ? encryptStreamUrl($streams['list'][0]['stream_url']) : '';
    
    // 8. Actualizar último login
    callNocoDB('users/' . $user['id'], 'PATCH', ['last_login' => date('Y-m-d H:i:s')]);
    
    // 9. Devolver respuesta
    echo json_encode([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'user_type' => $user['user_type'],
            'max_devices' => $user['max_devices']
        ],
        'session' => [
            'token' => $sessionToken,
            'device_id' => $data['deviceId']
        ],
        'stream_key' => $streamUrl
    ]);
}

function verifySession($data) {
    $sessions = callNocoDB('sessions?where=(session_token,eq,' . $data['token'] . ')~(is_active,eq,true)');
    
    if (empty($sessions['list'])) {
        http_response_code(401);
        echo json_encode(['valid' => false]);
        return;
    }
    
    $session = $sessions['list'][0];
    
    // Actualizar última actividad
    callNocoDB('sessions/' . $session['id'], 'PATCH', [
        'last_activity' => date('Y-m-d H:i:s')
    ]);
    
    echo json_encode([
        'valid' => true,
        'user_id' => $session['user_id']
    ]);
}

function getStreamUrl($data) {
    // Verificar sesión primero
    $sessions = callNocoDB('sessions?where=(session_token,eq,' . $data['token'] . ')~(is_active,eq,true)');
    
    if (empty($sessions['list'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Sesión no válida']);
        return;
    }
    
    $session = $sessions['list'][0];
    
    // Obtener stream del usuario
    $streams = callNocoDB('streams?where=(user_id,eq,' . $session['user_id'] . ')~(is_active,eq,true)');
    
    if (empty($streams['list'])) {
        http_response_code(404);
        echo json_encode(['error' => 'No hay stream asignado']);
        return;
    }
    
    // Devolver URL encriptada
    echo json_encode([
        'stream_url' => encryptStreamUrl($streams['list'][0]['stream_url'])
    ]);
}
?>
