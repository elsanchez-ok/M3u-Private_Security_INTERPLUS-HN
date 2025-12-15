<?php
// api/auth.php - BACKEND REAL CON NOCODB
require_once 'config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://tudominio.com');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

$config = include('config.php');

class NocoDBAuth {
    private $api_url;
    private $api_key;
    
    public function __construct($config) {
        $this->api_url = $config['nocodb']['api_url'];
        $this->api_key = $config['nocodb']['api_key'];
    }
    
    private function callNocoDB($endpoint, $method = 'GET', $data = null) {
        $url = $this->api_url . $endpoint;
        $headers = [
            'xc-auth: ' . $this->api_key,
            'Content-Type: application/json'
        ];
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        
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
        curl_close($ch);
        
        return [
            'code' => $http_code,
            'data' => json_decode($response, true)
        ];
    }
    
    public function login($username, $password, $device_id, $user_agent, $ip) {
        // 1. Buscar usuario en NocoDB
        $response = $this->callNocoDB('users?where=(username,eq,' . urlencode($username) . ')');
        
        if ($response['code'] !== 200 || empty($response['data']['list'])) {
            return ['success' => false, 'error' => 'Usuario no encontrado'];
        }
        
        $user = $response['data']['list'][0];
        
        // 2. Verificar contraseña
        if (!password_verify($password, $user['password_hash'])) {
            return ['success' => false, 'error' => 'Contraseña incorrecta'];
        }
        
        // 3. Verificar estado
        if ($user['status'] !== 'active') {
            return ['success' => false, 'error' => 'Cuenta inactiva'];
        }
        
        // 4. Verificar sesiones activas
        $sessions_resp = $this->callNocoDB(
            'sessions?where=(user_id,eq,' . $user['id'] . ')~(is_active,eq,true)'
        );
        
        $active_sessions = $sessions_resp['data']['list'] ?? [];
        
        // 5. Verificar límite de dispositivos
        if (count($active_sessions) >= $user['max_devices']) {
            // Verificar si ya tiene sesión en otro dispositivo
            foreach ($active_sessions as $session) {
                if ($session['device_id'] !== $device_id) {
                    return [
                        'success' => false, 
                        'error' => 'Sesión activa en otro dispositivo',
                        'device_id' => $session['device_id']
                    ];
                }
            }
        }
        
        // 6. Generar token de sesión
        $session_token = bin2hex(random_bytes(32));
        
        // 7. Crear nueva sesión en NocoDB
        $new_session = [
            'user_id' => $user['id'],
            'device_id' => $device_id,
            'session_token' => $session_token,
            'ip_address' => $ip,
            'user_agent' => $user_agent,
            'login_time' => date('Y-m-d H:i:s'),
            'last_activity' => date('Y-m-d H:i:s'),
            'is_active' => true
        ];
        
        $create_session = $this->callNocoDB('sessions', 'POST', $new_session);
        
        if ($create_session['code'] !== 200) {
            return ['success' => false, 'error' => 'Error al crear sesión'];
        }
        
        // 8. Actualizar último login del usuario
        $this->callNocoDB('users/' . $user['id'], 'PATCH', [
            'last_login' => date('Y-m-d H:i:s'),
            'device_token' => $session_token
        ]);
        
        // 9. Obtener stream del usuario
        $streams_resp = $this->callNocoDB(
            'streams?where=(user_id,eq,' . $user['id'] . ')~(is_active,eq,true)'
        );
        
        $stream_url = !empty($streams_resp['data']['list']) 
            ? $streams_resp['data']['list'][0]['stream_url'] 
            : '';
        
        // 10. Devolver respuesta
        return [
            'success' => true,
            'user' => [
                'id' => $user['id'],
                'username' => $user['username'],
                'user_type' => $user['user_type'],
                'max_devices' => $user['max_devices']
            ],
            'session' => [
                'token' => $session_token,
                'device_id' => $device_id,
                'expires_in' => 3600
            ],
            'stream_key' => $stream_url ? $this->encryptStreamUrl($stream_url) : ''
        ];
    }
    
    public function verifySession($token, $device_id) {
        $response = $this->callNocoDB(
            'sessions?where=(session_token,eq,' . urlencode($token) . ')~(is_active,eq,true)'
        );
        
        if ($response['code'] !== 200 || empty($response['data']['list'])) {
            return ['valid' => false];
        }
        
        $session = $response['data']['list'][0];
        
        // Verificar que coincida el dispositivo
        if ($session['device_id'] !== $device_id) {
            return ['valid' => false];
        }
        
        // Actualizar última actividad
        $this->callNocoDB('sessions/' . $session['id'], 'PATCH', [
            'last_activity' => date('Y-m-d H:i:s')
        ]);
        
        return [
            'valid' => true,
            'user_id' => $session['user_id']
        ];
    }
    
    public function logout($token) {
        $response = $this->callNocoDB(
            'sessions?where=(session_token,eq,' . urlencode($token) . ')'
        );
        
        if ($response['code'] === 200 && !empty($response['data']['list'])) {
            $session = $response['data']['list'][0];
            $this->callNocoDB('sessions/' . $session['id'], 'PATCH', [
                'is_active' => false,
                'last_activity' => date('Y-m-d H:i:s')
            ]);
        }
        
        return ['success' => true];
    }
    
    public function getStream($token) {
        $verify = $this->verifySession($token, $_SERVER['REMOTE_ADDR']);
        
        if (!$verify['valid']) {
            return ['error' => 'Sesión inválida'];
        }
        
        $streams_resp = $this->callNocoDB(
            'streams?where=(user_id,eq,' . $verify['user_id'] . ')~(is_active,eq,true)'
        );
        
        if (empty($streams_resp['data']['list'])) {
            return ['error' => 'No hay stream asignado'];
        }
        
        return [
            'stream_url' => $this->encryptStreamUrl($streams_resp['data']['list'][0]['stream_url'])
        ];
    }
    
    private function encryptStreamUrl($url) {
        $key = $config['stream']['encryption_key'];
        $iv = openssl_random_pseudo_bytes(16);
        $encrypted = openssl_encrypt($url, 'AES-256-CBC', $key, 0, $iv);
        return base64_encode($iv . $encrypted);
    }
    
    public function decryptStreamUrl($encrypted) {
        $key = $config['stream']['encryption_key'];
        $data = base64_decode($encrypted);
        $iv = substr($data, 0, 16);
        $encrypted = substr($data, 16);
        return openssl_decrypt($encrypted, 'AES-256-CBC', $key, 0, $iv);
    }
}

// Procesar solicitud
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $_GET['action'] ?? '';
    
    $auth = new NocoDBAuth($config);
    $response = [];
    
    switch ($action) {
        case 'login':
            $response = $auth->login(
                $input['username'] ?? '',
                $input['password'] ?? '',
                $input['deviceId'] ?? '',
                $_SERVER['HTTP_USER_AGENT'] ?? '',
                $_SERVER['REMOTE_ADDR'] ?? ''
            );
            break;
            
        case 'verify':
            $response = $auth->verifySession(
                $input['token'] ?? '',
                $input['deviceId'] ?? ''
            );
            break;
            
        case 'logout':
            $response = $auth->logout($input['token'] ?? '');
            break;
            
        case 'get_stream':
            $response = $auth->getStream($input['token'] ?? '');
            break;
            
        default:
            $response = ['error' => 'Acción no válida'];
    }
    
    echo json_encode($response);
}
?>
