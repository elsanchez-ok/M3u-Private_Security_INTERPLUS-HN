<?php
// api/stream_proxy.php
// Proxy seguro para streams - NUNCA expone la URL real

require_once 'config.php';

$config = include('config.php');

// Verificar token
function verifyToken($token, $device_id) {
    $nocodb = new NocoDBAuth($config);
    return $nocodb->verifySession($token, $device_id);
}

// Obtener stream real del usuario
function getUserStream($user_id) {
    $api_url = $config['nocodb']['api_url'];
    $api_key = $config['nocodb']['api_key'];
    
    $url = $api_url . 'streams?where=(user_id,eq,' . $user_id . ')~(is_active,eq,true)';
    $headers = ['xc-auth: ' . $api_key];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($http_code === 200) {
        $data = json_decode($response, true);
        if (!empty($data['list'])) {
            return $data['list'][0]['stream_url'];
        }
    }
    
    return null;
}

// Servir stream como proxy
function serveStream($stream_url) {
    if (!$stream_url) {
        header('HTTP/1.1 404 Not Found');
        echo 'Stream no encontrado';
        exit;
    }
    
    // Configurar headers para streaming
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    
    // Headers de seguridad adicionales
    header('Referrer-Policy: no-referrer');
    header('X-Permitted-Cross-Domain-Policies: none');
    
    // Para HLS streams
    if (strpos($stream_url, '.m3u8') !== false) {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        
        // Si es una playlist HLS, podemos procesarla
        if (isset($_GET['segment'])) {
            // Servir segmentos individuales
            $segment_url = $stream_url . $_GET['segment'];
            readfile($segment_url);
        } else {
            // Servir playlist principal
            $playlist = file_get_contents($stream_url);
            
            // Reemplazar URLs de segmentos por nuestro proxy
            $playlist = preg_replace_callback(
                '/(\S+\.ts)/',
                function($matches) use ($stream_url) {
                    return 'stream_proxy.php?segment=' . urlencode($matches[1]) . '&base=' . urlencode($stream_url);
                },
                $playlist
            );
            
            echo $playlist;
        }
    } else {
        // Para otros tipos de stream, redirigir o servir directamente
        // En producción, considerar usar readfile() o curl para ocultar la URL real
        
        // Opción 1: Redirección (menos seguro)
        // header('Location: ' . $stream_url);
        
        // Opción 2: Proxy completo (más seguro)
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $stream_url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($curl, $header) {
            // Filtrar headers que no queremos pasar
            $headers_to_pass = ['content-type', 'content-length', 'accept-ranges'];
            $header_lower = strtolower($header);
            
            foreach ($headers_to_pass as $h) {
                if (strpos($header_lower, $h) === 0) {
                    header($header);
                }
            }
            
            return strlen($header);
        });
        
        $response = curl_exec($ch);
        $content_type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        
        if ($content_type) {
            header('Content-Type: ' . $content_type);
        }
        
        echo $response;
        curl_close($ch);
    }
}

// Procesar solicitud
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = $_GET['token'] ?? '';
    $device_id = $_SERVER['HTTP_X_DEVICE_ID'] ?? $_SERVER['REMOTE_ADDR'];
    
    // Verificar token
    $verify = verifyToken($token, $device_id);
    
    if (!$verify['valid']) {
        header('HTTP/1.1 401 Unauthorized');
        echo 'Acceso no autorizado';
        exit;
    }
    
    // Obtener stream del usuario
    $stream_url = getUserStream($verify['user_id']);
    
    if (!$stream_url) {
        header('HTTP/1.1 404 Not Found');
        echo 'No hay stream disponible para este usuario';
        exit;
    }
    
    // Servir stream
    serveStream($stream_url);
    
} else {
    header('HTTP/1.1 405 Method Not Allowed');
    echo 'Método no permitido';
}
?>
