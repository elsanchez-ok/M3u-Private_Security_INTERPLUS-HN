// js/auth.js
// Sistema de autenticación para NocoDB

class AuthSystem {
    constructor() {
        this.API_BASE_URL = 'https://tudominio.com/api'; // CAMBIAR POR TU DOMINIO
        this.deviceId = this.generateDeviceId();
        this.sessionToken = localStorage.getItem('session_token');
        this.userData = JSON.parse(localStorage.getItem('user_data') || '{}');
    }
    
    // Generar ID único del dispositivo
    generateDeviceId() {
        let deviceId = localStorage.getItem('secure_device_id');
        if (!deviceId) {
            const navigatorInfo = navigator.userAgent + navigator.language + 
                                screen.width + screen.height + 
                                (navigator.hardwareConcurrency || '');
            const hash = btoa(navigatorInfo).substring(0, 32);
            deviceId = 'dev_' + Date.now() + '_' + hash.replace(/[^a-zA-Z0-9]/g, '');
            localStorage.setItem('secure_device_id', deviceId);
        }
        return deviceId;
    }
    
    // Iniciar sesión
    async login(username, password) {
        try {
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
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error en la autenticación');
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Credenciales incorrectas');
            }
            
            // Guardar datos de sesión
            this.sessionToken = data.session.token;
            this.userData = data.user;
            
            localStorage.setItem('session_token', data.session.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            localStorage.setItem('device_id', this.deviceId);
            localStorage.setItem('stream_key', data.stream_key || '');
            localStorage.setItem('login_time', new Date().toISOString());
            
            // Guardar en sessionStorage también para más seguridad
            sessionStorage.setItem('current_session', data.session.token);
            
            return {
                success: true,
                user: data.user,
                session: data.session
            };
            
        } catch (error) {
            console.error('Login error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Verificar sesión
    async verifySession() {
        if (!this.sessionToken) {
            return { valid: false };
        }
        
        try {
            const response = await fetch(`${this.API_BASE_URL}/auth.php?action=verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({
                    token: this.sessionToken,
                    deviceId: this.deviceId
                })
            });
            
            const data = await response.json();
            
            if (!data.valid) {
                this.logout();
            }
            
            return data;
            
        } catch (error) {
            console.error('Verify session error:', error);
            return { valid: false };
        }
    }
    
    // Cerrar sesión
    async logout() {
        if (this.sessionToken) {
            try {
                await fetch(`${this.API_BASE_URL}/auth.php?action=logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: this.sessionToken })
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        
        // Limpiar almacenamiento local
        localStorage.removeItem('session_token');
        localStorage.removeItem('user_data');
        localStorage.removeItem('stream_key');
        localStorage.removeItem('login_time');
        sessionStorage.removeItem('current_session');
        
        // Mantener device_id para futuros logins
        this.sessionToken = null;
        this.userData = {};
        
        return { success: true };
    }
    
    // Obtener stream del usuario
    async getStream() {
        if (!this.sessionToken) {
            return { error: 'No hay sesión activa' };
        }
        
        try {
            const response = await fetch(`${this.API_BASE_URL}/auth.php?action=get_stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                },
                body: JSON.stringify({ token: this.sessionToken })
            });
            
            if (!response.ok) {
                throw new Error('Error al obtener stream');
            }
            
            const data = await response.json();
            return data;
            
        } catch (error) {
            console.error('Get stream error:', error);
            return { error: error.message };
        }
    }
    
    // Obtener información del usuario actual
    getCurrentUser() {
        return this.userData;
    }
    
    // Verificar si es admin
    isAdmin() {
        return this.userData.user_type === 'admin';
    }
    
    // Obtener tiempo de sesión restante
    getSessionTimeLeft() {
        const loginTime = localStorage.getItem('login_time');
        if (!loginTime) return 0;
        
        const loginDate = new Date(loginTime);
        const now = new Date();
        const diffMs = now - loginDate;
        const diffMins = Math.floor(diffMs / 60000);
        
        // Sesión de 60 minutos
        return Math.max(0, 60 - diffMins);
    }
    
    // Redirigir según tipo de usuario
    redirectByUserType() {
        if (!this.userData.user_type) {
            window.location.href = 'index.html';
            return;
        }
        
        if (this.userData.user_type === 'admin') {
            window.location.href = 'admin.html';
        } else {
            window.location.href = 'dashboard.html';
        }
    }
    
    // Proteger página (usar en cada página)
    async protectPage(requiredUserType = null) {
        const verification = await this.verifySession();
        
        if (!verification.valid) {
            window.location.href = 'index.html';
            return false;
        }
        
        // Verificar tipo de usuario si se especifica
        if (requiredUserType && this.userData.user_type !== requiredUserType) {
            window.location.href = 'index.html';
            return false;
        }
        
        return true;
    }
}

// Exportar para uso global
window.AuthSystem = AuthSystem;
