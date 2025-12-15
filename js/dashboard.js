// js/dashboard.js
// Funciones específicas para el dashboard

class Dashboard {
    constructor(authSystem) {
        this.auth = authSystem;
        this.videoPlayer = document.getElementById('videoPlayer');
        this.videoOverlay = document.getElementById('videoOverlay');
        this.streamUrl = null;
        this.heartbeatInterval = null;
        this.sessionCheckInterval = null;
    }
    
    // Inicializar dashboard
    async init() {
        // Verificar sesión
        const isProtected = await this.auth.protectPage('user');
        if (!isProtected) return;
        
        // Cargar información del usuario
        this.loadUserInfo();
        
        // Configurar eventos
        this.setupEventListeners();
        
        // Iniciar monitoreo de sesión
        this.startSessionMonitoring();
        
        // Cargar stream después de 2 segundos
        setTimeout(() => {
            this.loadStream();
        }, 2000);
        
        // Añadir protección contra inspección
        this.addProtection();
    }
    
    // Cargar información del usuario
    loadUserInfo() {
        const user = this.auth.getCurrentUser();
        
        // Actualizar elementos del DOM
        const elements = {
            'usernameDisplay': user.username || 'Usuario',
            'userType': user.user_type === 'admin' ? 'Administrador' : 'Usuario',
            'infoUsername': user.username || '-',
            'infoType': user.user_type === 'admin' ? 'Administrador' : 'Usuario',
            'infoDevices': `${user.max_devices || 1} dispositivo(s)`,
            'infoDeviceId': (localStorage.getItem('secure_device_id') || '').substring(0, 20) + '...',
            'infoLoginTime': new Date().toLocaleTimeString(),
            'infoStatus': 'Activa'
        };
        
        for (const [id, value] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }
        
        // Actualizar estado de sesión
        this.updateSessionStatus();
    }
    
    // Configurar eventos
    setupEventListeners() {
        // Botón de cargar stream
        const loadStreamBtn = document.getElementById('loadStreamBtn');
        if (loadStreamBtn) {
            loadStreamBtn.addEventListener('click', () => this.loadStream());
        }
        
        // Botón de refrescar
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshStream());
        }
        
        // Botón de verificar sesión
        const checkSessionBtn = document.getElementById('checkSessionBtn');
        if (checkSessionBtn) {
            checkSessionBtn.addEventListener('click', () => this.checkSession());
        }
        
        // Botón de logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
        
        // Eventos del video player
        if (this.videoPlayer) {
            this.videoPlayer.addEventListener('error', (e) => this.handleVideoError(e));
            this.videoPlayer.addEventListener('play', () => this.sendHeartbeat());
        }
    }
    
    // Cargar stream seguro
    async loadStream() {
        try {
            // Ocultar overlay
            if (this.videoOverlay) {
                this.videoOverlay.style.display = 'none';
            }
            
            // Mostrar mensaje de carga
            this.showMessage('Cargando stream protegido...', 'info');
            
            // Obtener stream del backend
            const streamData = await this.auth.getStream();
            
            if (streamData.error) {
                throw new Error(streamData.error);
            }
            
            // El backend devuelve una URL encriptada o un endpoint proxy
            // Usaremos el proxy para mayor seguridad
            this.streamUrl = `${this.auth.API_BASE_URL}/stream_proxy.php?token=${encodeURIComponent(this.auth.sessionToken)}`;
            
            // Configurar video player
            if (this.videoPlayer) {
                this.videoPlayer.src = this.streamUrl;
                this.videoPlayer.style.display = 'block';
                
                // Intentar reproducir automáticamente
                const playPromise = this.videoPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log('Auto-play prevented:', error);
                        // Mostrar botón de play manual
                    });
                }
            }
            
            this.showMessage('Stream cargado exitosamente', 'success');
            
            // Iniciar heartbeat
            this.startHeartbeat();
            
        } catch (error) {
            console.error('Error loading stream:', error);
            
            // Mostrar overlay de error
            if (this.videoOverlay) {
                this.videoOverlay.style.display = 'flex';
                this.videoOverlay.innerHTML = `
                    <div style="text-align: center; padding: 30px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 4rem; color: #e94057; margin-bottom: 20px;"></i>
                        <h3>Error al cargar el stream</h3>
                        <p style="margin: 15px 0; color: #ccc;">${error.message}</p>
                        <button class="btn-retry" style="background: #8a2387; color: white; border: none; padding: 12px 25px; border-radius: 8px; cursor: pointer;">
                            <i class="fas fa-redo"></i> Reintentar
                        </button>
                    </div>
                `;
                
                // Agregar evento al botón de reintentar
                const retryBtn = this.videoOverlay.querySelector('.btn-retry');
                if (retryBtn) {
                    retryBtn.addEventListener('click', () => this.loadStream());
                }
            }
            
            this.showMessage(`Error: ${error.message}`, 'error');
        }
    }
    
    // Refrescar stream
    refreshStream() {
        if (this.videoPlayer) {
            // Limpiar src y recargar
            this.videoPlayer.src = '';
            setTimeout(() => {
                this.loadStream();
            }, 500);
        }
    }
    
    // Verificar sesión
    async checkSession() {
        const verification = await this.auth.verifySession();
        if (verification.valid) {
            this.showMessage('✅ Sesión válida', 'success');
        } else {
            this.showMessage('❌ Sesión inválida', 'error');
        }
    }
    
    // Cerrar sesión
    async logout() {
        await this.auth.logout();
        window.location.href = 'index.html';
    }
    
    // Mostrar mensajes
    showMessage(text, type = 'info') {
        const messageEl = document.getElementById('message') || 
                         document.getElementById('sessionAlert');
        
        if (messageEl) {
            const colors = {
                'success': '#10b981',
                'error': '#ef4444',
                'warning': '#f59e0b',
                'info': '#3b82f6'
            };
            
            messageEl.textContent = text;
            messageEl.style.backgroundColor = `rgba(${this.hexToRgb(colors[type])}, 0.2)`;
            messageEl.style.borderLeftColor = colors[type];
            messageEl.style.color = type === 'error' ? '#fecaca' : '#bfdbfe';
            messageEl.style.display = 'block';
            
            // Ocultar después de 5 segundos (excepto errores)
            if (type !== 'error') {
                setTimeout(() => {
                    messageEl.style.display = 'none';
                }, 5000);
            }
        }
    }
    
    // Convertir hex a rgb
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` 
            : '59, 130, 246';
    }
    
    // Iniciar monitoreo de sesión
    startSessionMonitoring() {
        // Verificar sesión cada 30 segundos
        this.sessionCheckInterval = setInterval(async () => {
            const verification = await this.auth.verifySession();
            if (!verification.valid) {
                clearInterval(this.sessionCheckInterval);
                this.showMessage('Sesión expirada. Redirigiendo...', 'error');
                setTimeout(() => this.logout(), 3000);
            } else {
                this.updateSessionStatus();
            }
        }, 30000);
    }
    
    // Actualizar estado de sesión
    updateSessionStatus() {
        const timeLeft = this.auth.getSessionTimeLeft();
        const statusElement = document.getElementById('infoStatus') || 
                             document.getElementById('sessionStatus');
        
        if (statusElement) {
            if (timeLeft > 10) {
                statusElement.textContent = `Activa (${timeLeft} min restantes)`;
                statusElement.style.color = '#6effa8';
            } else if (timeLeft > 0) {
                statusElement.textContent = `Por expirar (${timeLeft} min)`;
                statusElement.style.color = '#ffcc80';
            } else {
                statusElement.textContent = 'Expirada';
                statusElement.style.color = '#ff6b8b';
            }
        }
    }
    
    // Iniciar heartbeat (mantener sesión activa)
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(async () => {
            await this.auth.verifySession();
            this.updateSessionStatus();
        }, 60000); // Cada minuto
    }
    
    // Manejar errores del video
    handleVideoError(error) {
        console.error('Video error:', error);
        
        let errorMessage = 'Error desconocido';
        switch (this.videoPlayer.error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                errorMessage = 'Reproducción cancelada';
                break;
            case MediaError.MEDIA_ERR_NETWORK:
                errorMessage = 'Error de red';
                break;
            case MediaError.MEDIA_ERR_DECODE:
                errorMessage = 'Error al decodificar el video';
                break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = 'Formato no soportado';
                break;
        }
        
        this.showMessage(`Error de video: ${errorMessage}`, 'error');
        
        // Mostrar opción de recargar
        setTimeout(() => {
            if (confirm(`Error: ${errorMessage}. ¿Reintentar?`)) {
                this.refreshStream();
            }
        }, 2000);
    }
    
    // Enviar heartbeat (cuando el video se reproduce)
    sendHeartbeat() {
        if (this.videoPlayer && !this.videoPlayer.paused) {
            this.auth.verifySession();
        }
    }
    
    // Añadir protección contra inspección
    addProtection() {
        // Deshabilitar clic derecho
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('video') || e.target.closest('.video-container')) {
                e.preventDefault();
                this.showMessage('Acción no permitida en el reproductor', 'warning');
            }
        });
        
        // Deshabilitar dev tools (básico)
        document.addEventListener('keydown', (e) => {
            // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
            if (e.key === 'F12' || 
                (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
                (e.metaKey && e.altKey && e.key === 'I')) {
                e.preventDefault();
                this.showMessage('Acceso restringido', 'warning');
            }
        });
        
        // Ocultar controles en inspección
        const style = document.createElement('style');
        style.textContent = `
            video::-webkit-media-controls-enclosure {
                display: none !important;
            }
            
            #videoPlayer {
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
                pointer-events: auto;
            }
            
            /* Ocultar URL en inspección */
            video::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.01);
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Limpiar recursos
    cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.sessionCheckInterval) {
            clearInterval(this.sessionCheckInterval);
        }
        if (this.videoPlayer) {
            this.videoPlayer.src = '';
        }
    }
}

// Exportar para uso global
window.Dashboard = Dashboard;

// Inicializar automáticamente si hay elementos del dashboard
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('videoPlayer') || document.querySelector('.dashboard-screen')) {
        const auth = new AuthSystem();
        const dashboard = new Dashboard(auth);
        dashboard.init();
    }
});
