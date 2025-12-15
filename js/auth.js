// js/auth.js - Sistema de autenticación para NocoDB
class NocoDBAuth {
    constructor() {
        // CONFIGURA ESTA URL CON TU DOMINIO
        this.API_BASE_URL = 'https://tudominio.com/api';
        this.currentToken = null;
        this.userData = null;
        this.deviceId = this.getDeviceId();
        this.sessionCheckInterval = null;
    }
    
    // Generar ID único del dispositivo
    getDeviceId() {
        let deviceId = localStorage.getItem('nocodb_device_id');
        if (!deviceId) {
            const navigatorInfo = navigator.userAgent + navigator.language + 
                                screen.width + screen.height + 
                                (navigator.hardwareConcurrency || '');
            deviceId = 'nocodb_dev_' + Date.now() + '_' + 
                      btoa(navigatorInfo).substr(0, 20).replace(/[^a-zA-Z0-9]/g, '');
            localStorage.setItem('nocodb_device_id', deviceId);
        }
        return deviceId;
    }
    
    // Mostrar mensajes de error
    showError(message, isWarning = false) {
        console.error('Auth Error:', message);
        
        // Si hay elemento de mensaje en la página
        const messageEl = document.getElementById('message') || 
                         document.getElementById('messageBox') ||
                         document.getElementById('errorMessage');
        
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.style.display = 'block';
            messageEl.className = isWarning ? 'message warning' : 'message error';
            
            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 5000);
        }
        
        return { success: false, error: message };
    }
    
    // Iniciar sesión
    async login(username, password) {
        try {
            console.log('Intentando login para:', username);
            
            const response = await fetch(`${this.API_BASE_URL}/auth.php?action=login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    deviceId: this.deviceId
                })
            });
            
            // Verificar respuesta HTTP
            if (!response.ok) {
                throw new Error(`Error HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Verificar respuesta del servidor
            if (!data.success) {
                throw new Error(data.error || 'Error en la autenticación');
            }
            
            console.log('Login exitoso:', data.user.username);
            
            // Guardar datos
            this.currentToken = data.session.token;
            this.userData = data.user;
            
            // Guardar en localStorage
            localStorage.setItem('nocodb_session_token', data.session.token);
            localStorage.setItem('nocodb_user_data', JSON.stringify(data.user));
            localStorage.setItem('nocodb_stream_url', data.stream_url || '');
            localStorage.setItem('nocodb_login_time', new Date().toISOString());
            
            return {
                success: true,
                user: data.user,
                session: data.session,
                stream_url: data.stream_url
            };
            
        } catch (error) {
            console.error('Login error:', error);
            
            // Mensajes específicos para errores comunes
            let userMessage = error.message;
            
            if (error.message.includes('Failed to fetch')) {
                userMessage = 'No se puede conectar con el servidor. Verifica tu conexión.';
            } else if (error.message.includes('HTTP')) {
                userMessage = 'Error del servidor. Intenta nuevamente.';
            }
            
            return this.showError(userMessage, userMessage.includes('otro dispositivo'));
        }
    }
    
    // Verificar sesión
    async verifySession() {
        const token = localStorage.getItem('nocodb_session_token');
        
        if (!token) {
            return { valid: false, reason: 'No hay token' };
        }
        
        try {
            const response = await fetch(`${this.API_BASE_URL}/auth.php?action=verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({
                    token: token,
                    deviceId: this.deviceId
                })
            });
            
            if (!response.ok) {
                return { valid: false, reason: 'Error HTTP' };
            }
            
            const data = await response.json();
            
            if (data.valid) {
                // Actualizar datos locales
                this.currentToken = token;
                this.userData = JSON.parse(localStorage.getItem('nocodb_user_data') || '{}');
            } else {
                // Sesión inválida, limpiar
                this.logout();
            }
            
            return data;
            
        } catch (error) {
            console.error('Verify error:', error);
            return { valid: false, reason: 'Error de conexión' };
        }
    }
    
    // Obtener stream del usuario
    async getStream() {
        const token = localStorage.getItem('nocodb_session_token');
        
        if (!token) {
            throw new Error('No hay sesión activa');
        }
        
        try {
            const response = await fetch(`${this.API_BASE_URL}/auth.php?action=get_stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({
                    token: token,
                    deviceId: this.deviceId
                })
            });
            
            if (!response.ok) {
                throw new Error('Error al obtener stream');
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            return data;
            
        } catch (error) {
            console.error('Get stream error:', error);
            throw error;
        }
    }
    
    // Cerrar sesión
    async logout() {
        const token = localStorage.getItem('nocodb_session_token');
        
        if (token) {
            try {
                await fetch(`${this.API_BASE_URL}/auth.php?action=logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token })
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        
        // Limpiar localStorage
        localStorage.removeItem('nocodb_session_token');
        localStorage.removeItem('nocodb_user_data');
        localStorage.removeItem('nocodb_stream_url');
        localStorage.removeItem('nocodb_login_time');
        
        // Limpiar variables
        this.currentToken = null;
        this.userData = null;
        
        // Detener monitoreo de sesión
        if (this.sessionCheckInterval) {
            clearInterval(this.sessionCheckInterval);
        }
        
        return { success: true };
    }
    
    // Obtener usuario actual
    getCurrentUser() {
        if (!this.userData) {
            const stored = localStorage.getItem('nocodb_user_data');
            this.userData = stored ? JSON.parse(stored) : null;
        }
        return this.userData;
    }
    
    // Verificar si es admin
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.user_type === 'admin';
    }
    
    // Redirigir según tipo de usuario
    redirectByUserType() {
        const user = this.getCurrentUser();
        
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        
        if (user.user_type === 'admin') {
            window.location.href = 'admin.html';
        } else {
            window.location.href = 'dashboard.html';
        }
    }
    
    // Iniciar monitoreo de sesión
    startSessionMonitoring() {
        // Verificar cada 30 segundos
        this.sessionCheckInterval = setInterval(async () => {
            const verification = await this.verifySession();
            
            if (!verification.valid) {
                clearInterval(this.sessionCheckInterval);
                
                // Mostrar mensaje y redirigir
                this.showError('Sesión expirada. Redirigiendo...', true);
                
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 3000);
            }
        }, 30000);
    }
    
    // Verificar autenticación en página
    async requireAuth(requiredUserType = null) {
        const verification = await this.verifySession();
        
        if (!verification.valid) {
            window.location.href = 'index.html';
            return false;
        }
        
        // Verificar tipo de usuario si se especifica
        if (requiredUserType) {
            const user = this.getCurrentUser();
            if (!user || user.user_type !== requiredUserType) {
                window.location.href = 'index.html';
                return false;
            }
        }
        
        return true;
    }
    
    // Obtener tiempo de sesión restante
    getSessionTimeLeft() {
        const loginTime = localStorage.getItem('nocodb_login_time');
        if (!loginTime) return 0;
        
        const loginDate = new Date(loginTime);
        const now = new Date();
        const diffMs = now - loginDate;
        const diffMins = Math.floor(diffMs / 60000);
        
        // Sesión de 60 minutos
        return Math.max(0, 60 - diffMins);
    }
}

// Crear instancia global
window.nocodbAuth = new NocoDBAuth();
