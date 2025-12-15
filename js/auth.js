// js/auth.js - Sistema de autenticación para GitHub Pages
const AuthSystem = {
    // Usuarios con contraseñas en texto plano (para GitHub Pages)
    users: {
        'admin': { 
            password: 'admin123', 
            user_type: 'admin',
            name: 'Administrador Principal',
            stream_url: 'https://rst.cyphn.site/memfs/366c450b-a9f7-40c8-92df-f398d8cb693c.m3u8',
            max_devices: 1,
            status: 'active'
        },
        'usuario': { 
            password: 'cliente123', 
            user_type: 'user',
            name: 'Usuario Premium',
            stream_url: 'https://rst.cyphn.site/memfs/366c450b-a9f7-40c8-92df-f398d8cb693c.m3u8',
            max_devices: 1,
            status: 'active'
        },
        'invitado': { 
            password: 'invitado2024', 
            user_type: 'user',
            name: 'Usuario Invitado',
            stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
            max_devices: 1,
            status: 'active'
        }
    },
    
    // Sesiones activas
    sessions: new Map(),
    
    // Inicializar
    init() {
        this.loadSessions();
        this.startSessionCleanup();
    },
    
    // Cargar sesiones desde localStorage
    loadSessions() {
        try {
            const sessionsData = localStorage.getItem('secure_stream_sessions');
            if (sessionsData) {
                const sessions = JSON.parse(sessionsData);
                sessions.forEach(session => {
                    this.sessions.set(session.id, session);
                });
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
        }
    },
    
    // Guardar sesiones en localStorage
    saveSessions() {
        const sessionsArray = Array.from(this.sessions.values());
        localStorage.setItem('secure_stream_sessions', JSON.stringify(sessionsArray));
    },
    
    // Generar ID de dispositivo
    generateDeviceId() {
        let deviceId = localStorage.getItem('secure_device_id');
        if (!deviceId) {
            const navigatorInfo = navigator.userAgent + navigator.language + 
                                screen.width + screen.height;
            deviceId = 'dev_' + Date.now() + '_' + 
                      btoa(navigatorInfo).substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
            localStorage.setItem('secure_device_id', deviceId);
        }
        return deviceId;
    },
    
    // Iniciar sesión
    async login(username, password) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const user = this.users[username];
                
                // Verificar usuario
                if (!user) {
                    resolve({ 
                        success: false, 
                        error: 'Usuario no encontrado' 
                    });
                    return;
                }
                
                // Verificar contraseña (texto plano)
                if (user.password !== password) {
                    resolve({ 
                        success: false, 
                        error: 'Contraseña incorrecta' 
                    });
                    return;
                }
                
                // Verificar estado
                if (user.status !== 'active') {
                    resolve({ 
                        success: false, 
                        error: 'Cuenta inactiva' 
                    });
                    return;
                }
                
                const deviceId = this.generateDeviceId();
                
                // Verificar sesión única
                const existingSession = Array.from(this.sessions.values())
                    .find(s => s.username === username && s.active);
                
                if (existingSession && existingSession.deviceId !== deviceId) {
                    resolve({ 
                        success: false, 
                        error: 'Ya hay una sesión activa en otro dispositivo' 
                    });
                    return;
                }
                
                // Crear nueva sesión
                const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                const session = {
                    id: sessionId,
                    username: username,
                    deviceId: deviceId,
                    userData: user,
                    loginTime: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    active: true
                };
                
                // Guardar sesión
                this.sessions.set(sessionId, session);
                this.saveSessions();
                
                // Guardar en localStorage para fácil acceso
                localStorage.setItem('current_session_id', sessionId);
                localStorage.setItem('current_user', JSON.stringify(user));
                
                resolve({
                    success: true,
                    user: {
                        username: username,
                        user_type: user.user_type,
                        name: user.name,
                        max_devices: user.max_devices,
                        status: user.status
                    },
                    session: {
                        id: sessionId,
                        deviceId: deviceId,
                        expires_in: 3600
                    },
                    stream_url: user.stream_url
                });
                
            }, 800); // Simular delay de red
        });
    },
    
    // Verificar sesión
    async verifySession() {
        const sessionId = localStorage.getItem('current_session_id');
        
        if (!sessionId) {
            return { valid: false, reason: 'No hay sesión activa' };
        }
        
        const session = this.sessions.get(sessionId);
        
        if (!session || !session.active) {
            return { valid: false, reason: 'Sesión no encontrada o inactiva' };
        }
        
        // Verificar timeout (24 horas)
        const loginTime = new Date(session.loginTime);
        const now = new Date();
        const diffHours = (now - loginTime) / (1000 * 60 * 60);
        
        if (diffHours > 24) {
            this.logout();
            return { valid: false, reason: 'Sesión expirada' };
        }
        
        // Actualizar última actividad
        session.lastActivity = new Date().toISOString();
        this.sessions.set(sessionId, session);
        this.saveSessions();
        
        return { valid: true };
    },
    
    // Cerrar sesión
    async logout() {
        const sessionId = localStorage.getItem('current_session_id');
        
        if (sessionId) {
            const session = this.sessions.get(sessionId);
            if (session) {
                session.active = false;
                this.sessions.set(sessionId, session);
                this.saveSessions();
            }
        }
        
        // Limpiar localStorage
        localStorage.removeItem('current_session_id');
        localStorage.removeItem('current_user');
        
        return { success: true };
    },
    
    // Obtener usuario actual
    getCurrentUser() {
        const userData = localStorage.getItem('current_user');
        return userData ? JSON.parse(userData) : null;
    },
    
    // Verificar si hay sesión activa
    isLoggedIn() {
        const sessionId = localStorage.getItem('current_session_id');
        return !!sessionId;
    },
    
    // Obtener stream del usuario
    getCurrentStream() {
        const user = this.getCurrentUser();
        return user ? user.stream_url : null;
    },
    
    // Limpiar sesiones expiradas
    startSessionCleanup() {
        setInterval(() => {
            const now = new Date();
            let hasChanges = false;
            
            for (const [sessionId, session] of this.sessions.entries()) {
                if (session.active) {
                    const lastActivity = new Date(session.lastActivity);
                    const diffHours = (now - lastActivity) / (1000 * 60 * 60);
                    
                    // Expirar sesiones inactivas por más de 1 hora
                    if (diffHours > 1) {
                        session.active = false;
                        this.sessions.set(sessionId, session);
                        hasChanges = true;
                    }
                }
            }
            
            if (hasChanges) {
                this.saveSessions();
                
                // Verificar si la sesión actual expiró
                const currentSessionId = localStorage.getItem('current_session_id');
                if (currentSessionId) {
                    const currentSession = this.sessions.get(currentSessionId);
                    if (!currentSession || !currentSession.active) {
                        localStorage.removeItem('current_session_id');
                        localStorage.removeItem('current_user');
                    }
                }
            }
        }, 60000); // Verificar cada minuto
    },
    
    // Obtener tiempo restante de sesión
    getSessionTimeLeft() {
        const sessionId = localStorage.getItem('current_session_id');
        if (!sessionId) return 0;
        
        const session = this.sessions.get(sessionId);
        if (!session) return 0;
        
        const lastActivity = new Date(session.lastActivity);
        const now = new Date();
        const diffMs = now - lastActivity;
        const diffMins = Math.floor(diffMs / 60000);
        
        // Sesión expira después de 60 minutos de inactividad
        return Math.max(0, 60 - diffMins);
    }
};

// Inicializar el sistema
AuthSystem.init();

// Exportar para uso global
window.AuthSystem = AuthSystem;
