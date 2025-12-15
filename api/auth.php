<?php
// api/auth.php - Backend para NocoDB con contraseñas en texto plano
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // En producción cambia a tu dominio
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-ID');

// Configuración - ¡CAMBIA ESTOS VALORES!
$config = [
    'nocodb' => [
        'api_url' => 'https://TU_NocoDB_URL/api/v1/db/data/v1/', // Termina con /
        'api_key' => 'TU_API_KEY_SECRETA_AQUI', // API Token de NocoDB
        'project_name' => 'TU_PROJECT_NAME'
    ]
];

// Función para llamar a NocoDB
function callNocoDB($endpoint, $method = 'GET', $data = null) {
    global $config;
    
    $url = $config['nocodb']['api_url'] . $endpoint;
    $headers = [
        'xc-auth: ' . $config['nocodb']['api_key'],
        'Content-Type: application/json',
        'User-Agent: SecureStream-Auth/1.0'
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
    } elseif ($method === 'PATCH') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
    }
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        error_log("NocoDB Error: " . $error);
    }
    
    return [
        'code' => $http_code,
        'data' => json_decode($response, true),
        'error' => $error
    ];
}

// Función para buscar usuario en NocoDB
function findUser($username) {
    // Intenta diferentes formatos de query
    $queries = [
        'users?where=(username,eq,' . urlencode($username) . ')',
        'users?filter=(username,eq,' . urlencode($username) . ')',
        'users'
    ];
    
    foreach ($queries as $query) {
        $response = callNocoDB($query);
        
        if ($response['code'] === 200 && isset($response['data']['list'])) {
            // Buscar usuario en la lista
            foreach ($response['data']['list'] as $user) {
                if (isset($user['username']) && $user['username'] === $username) {
                    return $user;
                }
            }
            
            // Si es una lista completa, buscar por username
            if (!empty($response['data']['list'])) {
                foreach ($response['data']['list'] as $user) {
                    if (isset($user['username']) && $user['username'] === $username) {
                        return $user;
                    }
                }
            }
        }
    }
    
    return null;
}

// Función para crear sesión en NocoDB
function createSession($user_id, $device_id, $token) {
    $session_data = [
        'user_id' => (int)$user_id,
        'device_id' => $device_id,
        'session_token' => $token,
        'ip_address' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown',
        'login_time' => date('Y-m-d H:i:s'),
        'last_activity' => date('Y-m-d H:i:s'),
        'is_active' => true
    ];
    
    return callNocoDB('sessions', 'POST', $session_data);
}

// Función para verificar sesión
function verifySession($token, $device_id) {
    $response = callNocoDB('sessions?where=(session_token,eq,' . urlencode($token) . ')~(is_active,eq,true)');
    
    if ($response['code'] === 200 && isset($response['data']['list'][0])) {
        $session = $response['data']['list'][0];
        
        // Verificar dispositivo
        if ($session['device_id'] !== $device_id) {
            return ['valid' => false, 'reason' => 'Dispositivo no coincide'];
        }
        
        // Actualizar última actividad
        callNocoDB('sessions/' . $session['Id'], 'PATCH', [
            'last_activity' => date('Y-m-d H:i:s')
        ]);
        
        return ['valid' => true, 'user_id' => $session['user_id']];
    }
    
    return ['valid' => false, 'reason' => 'Sesión no encontrada'];
}

// Función para obtener stream del usuario
function getUserStream($user_id) {
    $response = callNocoDB('streams?where=(user_id,eq,' . $user_id . ')~(is_active,eq,true)');
    
    if ($response['code'] === 200 && isset($response['data']['list'][0])) {
        return $response['data']['list'][0]['stream_url'];
    }
    
    return null;
}

// Procesar solicitud
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $_GET['action'] ?? '';
    
    try {
        switch ($action) {
            case 'login':
                $username = $input['username'] ?? '';
                $password = $input['password'] ?? '';
                $device_id = $input['deviceId'] ?? '';
                
                if (empty($username) || empty($password)) {
                    throw new Exception('Usuario y contraseña son requeridos');
                }
                
                // Buscar usuario
                $user = findUser($username);
                
                if (!$user) {
                    throw new Exception('Usuario no encontrado');
                }
                
                // Verificar contraseña (texto plano para facilidad)
                if ($user['password'] !== $password) {
                    throw new Exception('Contraseña incorrecta');
                }
                
                // Verificar estado
                if ($user['status'] !== 'active') {
                    throw new Exception('Cuenta inactiva');
                }
                
                // Verificar sesiones activas
                $sessions_resp = callNocoDB('sessions?where=(user_id,eq,' . $user['Id'] . ')~(is_active,eq,true)');
                $active_sessions = $sessions_resp['data']['list'] ?? [];
                
                if (count($active_sessions) >= ($user['max_devices'] ?? 1)) {
                    foreach ($active_sessions as $session) {
                        if ($session['device_id'] !== $device_id) {
                            throw new Exception('Ya hay una sesión activa en otro dispositivo');
                        }
                    }
                }
                
                // Generar token
                $token = bin2hex(random_bytes(32));
                
                // Crear sesión
                $session_resp = createSession($user['Id'], $device_id, $token);
                
                if ($session_resp['code'] !== 200) {
                    throw new Exception('Error al crear sesión');
                }
                
                // Obtener stream
                $stream_url = getUserStream($user['Id']);
                
                // Respuesta exitosa
                echo json_encode([
                    'success' => true,
                    'user' => [
                        'id' => $user['Id'],
                        'username' => $user['username'],
                        'user_type' => $user['user_type'],
                        'max_devices' => $user['max_devices'] ?? 1,
                        'status' => $user['status']
                    ],
                    'session' => [
                        'token' => $token,
                        'device_id' => $device_id,
                        'expires_in' => 3600
                    ],
                    'stream_url' => $stream_url
                ]);
                break;
                
            case 'verify':
                $token = $input['token'] ?? '';
                $device_id = $input['deviceId'] ?? $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
                
                $verification = verifySession($token, $device_id);
                echo json_encode($verification);
                break;
                
            case 'logout':
                $token = $input['token'] ?? '';
                
                $response = callNocoDB('sessions?where=(session_token,eq,' . urlencode($token) . ')');
                
                if ($response['code'] === 200 && isset($response['data']['list'][0])) {
                    $session = $response['data']['list'][0];
                    callNocoDB('sessions/' . $session['Id'], 'PATCH', [
                        'is_active' => false,
                        'last_activity' => date('Y-m-d H:i:s')
                    ]);
                }
                
                echo json_encode(['success' => true]);
                break;
                
            case 'get_stream':
                $token = $input['token'] ?? '';
                $device_id = $input['deviceId'] ?? $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
                
                $verification = verifySession($token, $device_id);
                
                if (!$verification['valid']) {
                    throw new Exception('Sesión inválida');
                }
                
                $stream_url = getUserStream($verification['user_id']);
                
                if (!$stream_url) {
                    throw new Exception('No hay stream disponible');
                }
                
                echo json_encode([
                    'stream_url' => $stream_url
                ]);
                break;
                
            default:
                throw new Exception('Acción no válida');
        }
        
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ]);
    }
    
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'test') {
    // Endpoint de prueba
    echo json_encode([
        'status' => 'online',
        'version' => '1.0',
        'timestamp' => date('Y-m-d H:i:s')
    ]);
    
} else {
    echo json_encode([
        'error' => 'Método no permitido',
        'allowed_methods' => ['POST']
    ]);
}
?>
