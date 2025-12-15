// js/auth-nocodb.js - Autenticación con NocoDB API
const NocoDBAuth = {
    // CONFIGURACIÓN - ¡IMPORTANTE! Cambia estos valores
    config: {
        // Tu URL de NocoDB API
        apiUrl: 'https://TU_NocoDB_URL/api/v1/db/data/v1/',
        
        // Tu API Key de NocoDB (Settings → API Tokens)
        apiKey: 'TU_API_KEY_SECRETA',
        
        // Nombre de tu proyecto en NocoDB
        projectName: 'TU_PROJECT_NAME',
        
        // Nombre de las tablas (deben coincidir con NocoDB)
        tables: {
            users: 'users',
            sessions: 'sessions'
        }
    },
    
    // Estado actual
    currentUser: null,
    currentSession: null,
    
    // Inicializar
    init() {
        this.loadStoredSession();
    },
    
    // Cargar sesión almacenada
    loadStoredSession() {
        try {
            const sessionData = localStorage.getItem('nocodb_session');
            const userData = localStorage.getItem('nocodb_user');
            
            if (sessionData && userData) {
                this.currentSession = JSON.parse(sessionData);
                this.currentUser = JSON.parse(userData);
                
                // Verificar si la sesión sigue activa
                this.verifySession().then(valid => {
                    if (!valid) {
                        this.logout();
                    }
                });
            }
        } catch (error) {
            console.error('Error loading session:', error);
        }
    },
    
    // Función para llamar a NocoDB API
    async callNocoDB(endpoint, method = 'GET', data = null) {
        try {
            const url = `${this.config.apiUrl}${endpoint}`;
            const headers = {
                'xc-auth': this.config.apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            const options = {
                method: method,
                headers: headers,
                mode: 'cors' // Importante para GitHub Pages
            };
            
            if (data && (method === 'POST' || method === 'PATCH')) {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch(url, options);
            
            // Verificar si hay error de CORS
            if (!response.ok && response.status === 0) {
                throw new Error('Error de CORS. Verifica que NocoDB permita tu dominio.');
            }
            
            const result = await response.json();
            
            return {
                success: response.ok,
                data: result,
                status: response.status
            };
            
        } catch (error) {
            console.error('NocoDB API Error:', error);
            return {
                success: false,
                error: error.message,
                status: 0
            };
        }
    },
    
    // Generar ID único del dispositivo
    generateDeviceId() {
        let deviceId = localStorage.getItem('nocodb_device_id');
        if (!deviceId) {
            const navigatorInfo = navigator.userAgent + navigator.language + 
                                screen.width + screen.height;
            deviceId = 'nocodb_dev_' + Date.now() + '_' + 
                      btoa(navigatorInfo).substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
            localStorage.setItem('nocodb_device_id', deviceId);
        }
        return deviceId;
    },
    
    // Generar token de sesión
    generateToken() {
        return 'nocodb_token_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },
    
    // Iniciar sesión
    async login(username, password) {
        try {
            console.log('Intentando login para:', username);
            
            // 1. Buscar usuario en NocoDB
            const usersResponse = await this.callNocoDB(
                `${this.config.tables.users}?where=(username,eq,${encodeURIComponent(username)})`
            );
            
            if (!usersResponse.success || !usersResponse.data.list || usersResponse.data.list.length === 0) {
                return {
                    success: false,
                    error: 'Usuario no encontrado'
                };
            }
            
            const user = usersResponse.data.list[0];
            
            // 2. Verificar contraseña (texto plano)
            if (user.password !== password) {
                return {
                    success: false,
                    error: 'Contraseña incorrecta'
                };
            }
            
            // 3. Verificar estado
            if (user.status !== 'active') {
                return {
                    success: false,
                    error: 'Cuenta inactiva'
                };
            }
            
            const deviceId = this.generateDeviceId();
            
            // 4. Verificar sesiones activas
            const sessionsResponse = await this.callNocoDB(
                `${this.config.tables.sessions}?where=(username,eq,${encodeURIComponent(username)})~(is_active,eq,true)`
            );
            
            if (sessionsResponse.success && sessionsResponse.data.list) {
                const activeSessions = sessionsResponse.data.list;
                
                // Verificar límite de dispositivos
                if (activeSessions.length >= (user.max_devices || 1)) {
                    // Verificar si ya hay sesión en otro dispositivo
                    const otherDeviceSession = activeSessions.find(s => s.device_id !== deviceId);
                    if (otherDeviceSession) {
                        return {
                            success: false,
                            error: 'Ya hay una sesión activa en otro dispositivo'
                        };
                    }
                }
            }
            
            // 5. Generar token
            const sessionToken = this.generateToken();
            
            // 6. Crear nueva sesión en NocoDB
            const newSession = {
                username: username,
                device_id: deviceId,
                session_token: sessionToken,
                login_time: new Date().toISOString(),
                last_activity: new Date().toISOString(),
                is_active: true
            };
            
            const createSessionResponse = await this.callNocoDB(
                this.config.tables.sessions,
                'POST',
                newSession
            );
            
            if (!createSessionResponse.success) {
                return {
                    success: false,
                    error: 'Error al crear sesión'
                };
            }
            
            // 7. Guardar datos localmente
            this.currentUser = {
                id: user.Id,
                username: user.username,
                user_type: user.user_type,
                name: user.name || user.username,
                max_devices: user.max_devices || 1,
                status: user.status,
                stream_url: user.stream_url
            };
            
            this.currentSession = {
                token: sessionToken,
                deviceId: deviceId,
                loginTime: new Date().toISOString()
            };
            
            // Guardar en localStorage
            localStorage.setItem('nocodb_user', JSON.stringify(this.currentUser));
            localStorage.setItem('nocodb_session', JSON.stringify(this.currentSession));
            
            return {
                success: true,
                user: this.currentUser,
                session: this.currentSession
            };
            
        } catch (error) {
            console.error('Login error:', error);
            return {
                success: false,
                error: 'Error de conexión con el servidor'
            };
        }
    },
    
    // Verificar sesión
    async verifySession() {
        const sessionData = localStorage.getItem('nocodb_session');
        const userData = localStorage.getItem('nocodb_user');
        
        if (!sessionData || !userData) {
            return false;
        }
        
        try {
            const session = JSON.parse(sessionData);
            const user = JSON.parse(userData);
            
            // Buscar sesión en NocoDB
            const response = await this.callNocoDB(
                `${this.config.tables.sessions}?where=(session_token,eq,${encodeURIComponent(session.token)})~(is_active,eq,true)`
            );
            
            if (!response.success || !response.data.list || response.data.list.length === 0) {
                this.logout();
                return false;
            }
            
            const dbSession = response.data.list[0];
            
            // Verificar dispositivo
            if (dbSession.device_id !== session.deviceId) {
                this.logout();
                return false;
            }
            
            // Actualizar última actividad
            await this.callNocoDB(
                `${this.config.tables.sessions}/${dbSession.Id}`,
                'PATCH',
                { last_activity: new Date().toISOString() }
            );
            
            // Actualizar datos locales
            this.currentUser = user;
            this.currentSession = session;
            
            return true;
            
        } catch (error) {
            console.error('Verify session error:', error);
            return false;
        }
    },
    
    // Cerrar sesión
    async logout() {
        const sessionData = localStorage.getItem('nocodb_session');
        
        if (sessionData) {
            try {
                const session = JSON.parse(sessionData);
                
                // Buscar y desactivar sesión en NocoDB
                const response = await this.callNocoDB(
                    `${this.config.tables.sessions}?where=(session_token,eq,${encodeURIComponent(session.token)})`
                );
                
                if (response.success && response.data.list && response.data.list.length > 0) {
                    const dbSession = response.data.list[0];
                    await this.callNocoDB(
                        `${this.config.tables.sessions}/${dbSession.Id}`,
                        'PATCH',
                        { is_active: false }
                    );
                }
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        
        // Limpiar datos locales
        this.currentUser = null;
        this.currentSession = null;
        localStorage.removeItem('nocodb_user');
        localStorage.removeItem('nocodb_session');
        
        return { success: true };
    },
    
    // Obtener usuario actual
    getCurrentUser() {
        if (!this.currentUser) {
            const userData = localStorage.getItem('nocodb_user');
            this.currentUser = userData ? JSON.parse(userData) : null;
        }
        return this.currentUser;
    },
    
    // Obtener stream del usuario
    getCurrentStream() {
        const user = this.getCurrentUser();
        return user ? user.stream_url : null;
    },
    
    // Verificar si es admin
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.user_type === 'admin';
    },
    
    // Obtener tiempo restante de sesión
    getSessionTimeLeft() {
        const sessionData = localStorage.getItem('nocodb_session');
        if (!sessionData) return 0;
        
        try {
            const session = JSON.parse(sessionData);
            const loginTime = new Date(session.loginTime);
            const now = new Date();
            const diffMs = now - loginTime;
            const diffMins = Math.floor(diffMs / 60000);
            
            // Sesión de 60 minutos
            return Math.max(0, 60 - diffMins);
        } catch {
            return 0;
        }
    }
};

// Inicializar
NocoDBAuth.init();

// Exportar para uso global
window.NocoDBAuth = NocoDBAuth;
