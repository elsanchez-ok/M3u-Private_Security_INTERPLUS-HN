// auth-ultra-simple.js - Sistema SUPER simple
const UltraAuth = {
    // CONFIG - ¡CAMBIAR ESTO!
    config: {
        baseUrl: 'https://app.nocodb.com/api/v3/meta/bases/p5xsjpo507ot933/swagger',
        projectId: 'p5xsjpo507ot933',      // Tu Project ID
        apiKey: 'ZedVPgS8jEw22E1zo5Icw2IFLG2jbJhOy77qkw7j'         // Tu API Token
    },
    
    // Método universal para NocoDB
    async nocoFetch(endpoint, method = 'GET', data = null) {
        const url = `${this.config.baseUrl}${this.config.projectId}/${endpoint}`;
        console.log(`📡 ${method} ${url}`);
        
        const options = {
            method: method,
            headers: {
                'xc-auth': this.config.apiKey,
                'Content-Type': 'application/json'
            }
        };
        
        if (data && (method === 'POST' || method === 'PATCH')) {
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, options);
            const result = await response.json();
            
            return {
                ok: response.ok,
                status: response.status,
                data: result
            };
        } catch (error) {
            console.error('❌ Error:', error);
            return { ok: false, error: error.message };
        }
    },
    
    // ========== USERS TABLE (SOLO GET) ==========
    
    // Buscar usuario por username
    async findUser(username) {
        // Intenta con 'filter' primero, si falla prueba con 'where'
        const endpoints = [
            `users?filter=(username,eq,${encodeURIComponent(username)})`,
            `users?where=(username,eq,${encodeURIComponent(username)})`,
            `users`
        ];
        
        for (const endpoint of endpoints) {
            const result = await this.nocoFetch(endpoint);
            
            if (result.ok && result.data) {
                // Buscar usuario en los datos
                let users = [];
                
                if (result.data.list) users = result.data.list;
                else if (Array.isArray(result.data)) users = result.data;
                
                const user = users.find(u => u.username === username);
                if (user) return user;
            }
        }
        
        return null;
    },
    
    // ========== SESSIONS TABLE (POST, GET, PATCH) ==========
    
    // Crear sesión (POST)
    async createSession(userId, deviceId, token) {
        const sessionData = {
            user_id: userId,
            device_id: deviceId,
            session_token: token,
            is_active: true,
            login_time: new Date().toISOString().split('T')[0] + ' ' + 
                       new Date().toLocaleTimeString('en-GB')
        };
        
        return await this.nocoFetch('sessions', 'POST', sessionData);
    },
    
    // Buscar sesión activa por token (GET)
    async findSessionByToken(token) {
        const endpoints = [
            `sessions?filter=(session_token,eq,${encodeURIComponent(token)})~(is_active,eq,true)`,
            `sessions?where=(session_token,eq,${encodeURIComponent(token)})~(is_active,eq,true)`
        ];
        
        for (const endpoint of endpoints) {
            const result = await this.nocoFetch(endpoint);
            
            if (result.ok && result.data) {
                if (result.data.list && result.data.list.length > 0) {
                    return result.data.list[0];
                } else if (Array.isArray(result.data) && result.data.length > 0) {
                    return result.data[0];
                }
            }
        }
        
        return null;
    },
    
    // Actualizar sesión (PATCH)
    async updateSession(sessionId, updates) {
        return await this.nocoFetch(`sessions/${sessionId}`, 'PATCH', updates);
    },
    
    // ========== LOGIN FLOW ==========
    
    async login(username, password) {
        try {
            console.log(`🔐 Login attempt: ${username}`);
            
            // 1. Buscar usuario (GET en users)
            const user = await this.findUser(username);
            
            if (!user) {
                return { success: false, error: 'Usuario no encontrado' };
            }
            
            // 2. Verificar contraseña
            if (user.password !== password) {
                return { success: false, error: 'Contraseña incorrecta' };
            }
            
            // 3. Verificar estado
            if (user.status !== 'active') {
                return { success: false, error: 'Cuenta inactiva' };
            }
            
            // 4. Generar token y device ID
            const deviceId = 'dev_' + Date.now();
            const token = 'tok_' + Date.now() + Math.random().toString(36).substr(2, 6);
            
            // 5. Verificar sesiones activas (GET en sessions)
            const activeEndpoint = `sessions?filter=(user_id,eq,${user.id})~(is_active,eq,true)`;
            const activeResult = await this.nocoFetch(activeEndpoint);
            
            if (activeResult.ok && activeResult.data) {
                const activeSessions = activeResult.data.list || activeResult.data || [];
                
                if (activeSessions.length >= (user.max_devices || 1)) {
                    return { 
                        success: false, 
                        error: 'Ya hay una sesión activa en otro dispositivo' 
                    };
                }
            }
            
            // 6. Crear nueva sesión (POST en sessions)
            const createResult = await this.createSession(user.id, deviceId, token);
            
            if (!createResult.ok) {
                return { success: false, error: 'Error al crear sesión' };
            }
            
            // 7. Guardar datos localmente
            const userData = {
                id: user.id,
                username: user.username,
                user_type: user.user_type,
                stream_url: user.stream_url,
                name: user.name || user.username
            };
            
            localStorage.setItem('nocodb_user', JSON.stringify(userData));
            localStorage.setItem('nocodb_token', token);
            localStorage.setItem('nocodb_device', deviceId);
            
            console.log('✅ Login exitoso');
            
            return {
                success: true,
                user: userData,
                token: token
            };
            
        } catch (error) {
            console.error('❌ Login error:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Verificar sesión
    async verifySession() {
        const token = localStorage.getItem('nocodb_token');
        
        if (!token) return false;
        
        try {
            // GET en sessions para verificar
            const session = await this.findSessionByToken(token);
            
            if (!session) return false;
            
            // PATCH en sessions para actualizar actividad
            await this.updateSession(session.id, {
                last_activity: new Date().toISOString().split('T')[0] + ' ' + 
                             new Date().toLocaleTimeString('en-GB')
            });
            
            return true;
            
        } catch (error) {
            console.error('❌ Verify error:', error);
            return false;
        }
    },
    
    // Cerrar sesión
    async logout() {
        const token = localStorage.getItem('nocodb_token');
        
        if (token) {
            try {
                // GET para encontrar la sesión
                const session = await this.findSessionByToken(token);
                
                if (session) {
                    // PATCH para desactivarla
                    await this.updateSession(session.id, {
                        is_active: false
                    });
                }
            } catch (error) {
                console.error('❌ Logout error:', error);
            }
        }
        
        // Limpiar localStorage
        localStorage.removeItem('nocodb_user');
        localStorage.removeItem('nocodb_token');
        localStorage.removeItem('nocodb_device');
        
        return { success: true };
    },
    
    // Obtener usuario actual
    getCurrentUser() {
        const data = localStorage.getItem('nocodb_user');
        return data ? JSON.parse(data) : null;
    },
    
    // Obtener stream del usuario
    getCurrentStream() {
        const user = this.getCurrentUser();
        return user ? user.stream_url : null;
    }
};

// Inicializar
window.UltraAuth = UltraAuth;
