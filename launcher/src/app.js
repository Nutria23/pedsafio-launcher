let localSettings = {};
let remoteConfig = {};
let activeAuthTab = 'offline';
let configSettings = { remoteUrl: '', statusUrl: '' };
let isStatusPollerRunning = false;

document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  setupSettingsModal();
  setupConsoleModal();
  setupAuthTabs();
  
  // Load Launcher Config file using the preload API (bypassing file:// CORS restrictions)
  try {
    if (window.api && typeof window.api.getLauncherConfig === 'function') {
      const configData = window.api.getLauncherConfig();
      if (configData) {
        configSettings = configData;
      } else {
        throw new Error('El puente de lectura devolvió vacío.');
      }
    } else {
      // Fallback a fetch si se corre fuera de Electron (ej. en desarrollo web común)
      const configRes = await fetch('launcher-config.json');
      configSettings = await configRes.json();
    }
  } catch (err) {
    console.error('Error loading launcher-config.json, falling back to defaults', err);
    configSettings = {
      remoteUrl: 'http://localhost:3000/api/config',
      statusUrl: 'http://localhost:3000/api/status'
    };
  }

  // 1. Load Local Settings
  localSettings = await window.api.getLocalSettings();
  loadSettingsIntoUI(localSettings);

  // 2. Fetch Remote Configuration
  await fetchRemoteConfig();
  
  // Refrescar al enfocar la ventana o al pasar el mouse por el botón Jugar (sincronización instantánea inteligente)
  window.addEventListener('focus', () => {
    fetchRemoteConfig(true);
  });

  const playBtn = document.getElementById('btn-action-play');
  if (playBtn) {
    playBtn.addEventListener('mouseenter', () => {
      fetchRemoteConfig(true);
    });
  }

  // Refresco secundario en segundo plano cada 60 segundos (evita agotar el límite de la API de GitHub)
  setInterval(() => fetchRemoteConfig(true, true), 60000);

  // 3. Check Session Auto-Login
  checkAutoLogin();

  // 4. Setup Authentication forms handlers
  setupAuthForms();

  // 5. Setup JUGAR play button listener
  setupPlayHandler();
});

// Custom borderless window top control buttons
function setupWindowControls() {
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.api.minimizeWindow();
  });
  document.getElementById('btn-maximize').addEventListener('click', () => {
    window.api.maximizeWindow();
  });
  document.getElementById('btn-close').addEventListener('click', () => {
    window.api.closeWindow();
  });
}

// Remote Configuration Fetcher
let rateLimitRemaining = 60;
let rateLimitWarned = false;

async function fetchRemoteConfig(silent = false, isInterval = false) {
  const remoteUrl = configSettings.remoteUrl || 'http://localhost:3000/api/config';
  
  let fetchUrl = remoteUrl;
  const headers = {};

  // Usar el Token de GitHub local del desarrollador si existe para evadir el límite de 60 peticiones/hora
  if (localSettings && localSettings.gitToken) {
    headers['Authorization'] = `token ${localSettings.gitToken}`;
  }

  // Si es un refresco automático y nos estamos quedando sin solicitudes de API en la IP, pausarlo para ahorrar cuota
  if (isInterval && rateLimitRemaining <= 5) {
    return;
  }

  // Si es una URL de GitHub Raw, la convertimos a la API REST para saltear la caché de Fastly CDN (5 minutos)
  if (remoteUrl.includes('raw.githubusercontent.com')) {
    try {
      const parts = remoteUrl.split('/');
      const owner = parts[3];
      const repo = parts[4];
      const branch = parts[5];
      const pathSegments = parts.slice(6).join('/');
      fetchUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathSegments}?ref=${branch}&t=${Date.now()}`;
      headers['Accept'] = 'application/vnd.github.v3.raw';
    } catch (e) {
      fetchUrl = `${remoteUrl}?nocache=${Date.now()}`;
    }
  }

  if (!silent) {
    appendLog('Conectando con el servidor remoto: ' + fetchUrl, 'info');
  }
  try {
    const res = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: headers
    });
    if (!res.ok) throw new Error('El servidor remoto devolvió estado ' + res.status);
    
    // Leer los headers de rate limit de GitHub API para autogestionar el tráfico
    if (res.headers.has('x-ratelimit-remaining')) {
      rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining'));
      if (rateLimitRemaining < 5 && !rateLimitWarned) {
        rateLimitWarned = true;
        console.warn('Límite de API de GitHub bajo. Se desactivó el refresco en segundo plano temporalmente.');
      }
    }

    remoteConfig = await res.json();
    if (!silent) {
      appendLog('Configuración remota cargada con éxito.', 'success');
    }

    // Apply remote config to UI
    applyRemoteConfigToUI(remoteConfig);
    
    // Periodically poll server status
    startServerStatusPoller();
  } catch (err) {
    if (!silent) {
      appendLog(`Fallo al conectar con la API remota (${fetchUrl}): ${err.message}. Intentando fallback a Raw CDN...`, 'warning');
    }
    
    // Intento de fallback automático si falló la API y veníamos de un formato traducido
    if (fetchUrl !== remoteUrl) {
      try {
        const fallbackRes = await fetch(`${remoteUrl}?nocache=${Date.now()}`, { cache: 'no-store' });
        if (fallbackRes.ok) {
          remoteConfig = await fallbackRes.json();
          applyRemoteConfigToUI(remoteConfig);
          startServerStatusPoller();
          return;
        }
      } catch (fallbackErr) {
        console.error('Fallback fetch failed:', fallbackErr);
      }
    }

    // Solo muestra error crítico en el login si nunca cargamos nada
    if (!remoteConfig || Object.keys(remoteConfig).length === 0) {
      document.getElementById('login-brand-version').textContent = 'Error de conexión con la API';
    }
  }
}

function applyRemoteConfigToUI(config) {
  const versionString = `Serie Hardcore · ${config.minecraftVersion || '1.20.1'} ${config.forgeVersion ? 'Forge' : 'Vanilla'}`;
  
  document.getElementById('login-brand-version').textContent = versionString;

  // Actualizar la versión de los mods en la UI
  const modsVersionEl = document.getElementById('dash-mods-version');
  if (modsVersionEl) {
    modsVersionEl.textContent = config.modsVersion || '1.0.0';
  }

  // Actualizar la etiqueta de rango del jugador en tiempo real si está logueado en la pantalla del dash
  const nameEl = document.getElementById('dash-player-name');
  if (nameEl && nameEl.textContent) {
    const activePlayerName = nameEl.textContent.trim();
    const roleBadge = document.getElementById('player-role-badge');
    if (roleBadge) {
      const isAdmin = config.admins && Array.isArray(config.admins)
        ? config.admins.some(adm => adm.toLowerCase().trim() === activePlayerName.toLowerCase().trim())
        : false;
        
      if (isAdmin) {
        roleBadge.textContent = 'ADMINISTRADOR';
        roleBadge.className = 'role-badge admin';
      } else {
        roleBadge.textContent = 'JUGADOR';
        roleBadge.className = 'role-badge user';
      }
    }
  }

  // Apply custom background image dynamically
  if (config.background) {
    const bgElement = document.getElementById('launcher-bg');
    bgElement.style.backgroundImage = `url('${config.background}')`;
    // appendLog(`Fondo de pantalla cargado remotamente: ${config.background}`, 'debug');
  }

  // Apply custom logo dynamically
  if (config.logo) {
    document.getElementById('login-brand-logo').src = config.logo;
    document.getElementById('dash-brand-logo').src = config.logo;
    document.getElementById('sidebar-logo').src = config.logo;
    // appendLog(`Logotipo cargado remotamente: ${config.logo}`, 'debug');
  }

  // Verify launcher version and enforce mandatory update
  const clientVersion = '1.0.0';
  if (config.launcherVersion && config.launcherVersion !== clientVersion) {
    appendLog(`Nueva versión del Launcher disponible: v${config.launcherVersion} (Tu versión: v${clientVersion})`, 'warn');
    if (config.forceUpdate) {
      appendLog('¡Actualización forzosa del launcher requerida! Botón de inicio bloqueado.', 'error');
      const playBtn = document.getElementById('btn-action-play');
      playBtn.disabled = true;
      playBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ACTUALIZAR LAUNCHER';
      playBtn.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
      
      playBtn.onclick = () => {
        alert('Por favor, descarga la última versión del Launcher desde el sitio web oficial o el Panel de Administración.');
      };
    }
  }
}

// Server List Status Poller (MOTD and Players online count)
function startServerStatusPoller() {
  if (isStatusPollerRunning) return;
  isStatusPollerRunning = true;

  const dot = document.getElementById('dash-status-dot');
  const text = document.getElementById('dash-status-text');

  const poll = async () => {
    // Dot is always green (online) as requested
    dot.className = 'status-indicator-dot online';
    try {
      // Use direct client-side TCP socket ping to check Minecraft server status
      const host = remoteConfig.ip || 'localhost';
      const port = remoteConfig.port || 25565;
      
      const data = await window.api.pingServer(host, port);
      if (data && data.online) {
        text.textContent = `IP PROTEGIDA · En línea · ${data.players.online}/${data.players.max} jugadores`;
      } else {
        text.textContent = `IP PROTEGIDA · En línea`;
      }
    } catch (err) {
      text.textContent = `IP PROTEGIDA · En línea`;
    }
  };

  poll();
  setInterval(poll, 15000); // Poll status every 15 seconds
}

// Session Auto Login checker
function checkAutoLogin() {
  if (localSettings.authType === 'microsoft' && localSettings.msToken) {
    appendLog('Intentando reanudar sesión guardada de Microsoft...', 'info');
    document.getElementById('login-brand-version').textContent = 'Reconectando sesión Microsoft...';
    
    window.api.loginMicrosoftRefresh(localSettings.msToken).then(res => {
      if (res.success) {
        localSettings.profile = res.profile;
        localSettings.msToken = res.rawToken;
        window.api.saveLocalSettings(localSettings);
        
        appendLog(`Sesión Microsoft restablecida con éxito como: ${res.profile.name}`, 'success');
        showDashboard(res.profile.name);
      } else {
        appendLog('La sesión de Microsoft ha caducado. Vuelve a iniciar sesión.', 'warn');
        document.getElementById('login-brand-version').textContent = 'Sesión expirada';
        // Go back to login tab
        showLoginView();
      }
    });
  } else if (localSettings.authType === 'offline' && localSettings.username) {
    // Fill local username field
    document.getElementById('input-username').value = localSettings.username;
    appendLog(`Sesión offline anterior detectada: ${localSettings.username}`, 'info');
  }
}

// Authentication Tabs Controls
function setupAuthTabs() {
  const btnMs = document.getElementById('tab-login-microsoft');
  const btnOff = document.getElementById('tab-login-offline');
  const contentMs = document.getElementById('content-login-microsoft');
  const contentOff = document.getElementById('content-login-offline');

  btnMs.addEventListener('click', () => {
    activeAuthTab = 'microsoft';
    btnMs.classList.add('active');
    btnOff.classList.remove('active');
    contentMs.style.display = 'flex';
    contentOff.style.display = 'none';
  });

  btnOff.addEventListener('click', () => {
    activeAuthTab = 'offline';
    btnOff.classList.add('active');
    btnMs.classList.remove('active');
    contentOff.style.display = 'flex';
    contentMs.style.display = 'none';
  });
}

function setupAuthForms() {
  // Offline login submission
  document.getElementById('btn-submit-offline').addEventListener('click', () => {
    let nick = document.getElementById('input-username').value.trim();
    
    if (!nick) {
      // Auto-generar nick de invitado si está en blanco
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      nick = `Invitado_${randomNum}`;
    }
    
    // Alphanumeric validator
    const regex = /^[a-zA-Z0-9_]{3,16}$/;
    if (!regex.test(nick)) {
      alert('Nombre inválido. Debe tener entre 3 y 16 caracteres alfanuméricos (letras, números y guiones bajos).');
      return;
    }

    localSettings.authType = 'offline';
    localSettings.username = nick;
    localSettings.profile = null;
    localSettings.msToken = null;
    
    window.api.saveLocalSettings(localSettings);
    appendLog(`Usuario ingresó sesión offline: ${nick}`, 'success');
    showDashboard(nick);
  });

  // Microsoft OAuth login button
  document.getElementById('btn-submit-microsoft').addEventListener('click', async () => {
    const btn = document.getElementById('btn-submit-microsoft');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Autenticando...';
    
    appendLog('Abriendo navegador seguro para autenticación con Microsoft...', 'info');

    const result = await window.api.loginMicrosoft();
    
    if (result.success) {
      localSettings.authType = 'microsoft';
      localSettings.profile = result.profile;
      localSettings.msToken = result.rawToken;
      localSettings.username = result.profile.name;
      
      await window.api.saveLocalSettings(localSettings);
      appendLog(`Microsoft login correcto. Jugador: ${result.profile.name}`, 'success');
      showDashboard(result.profile.name);
    } else {
      appendLog(`Fallo en login de Microsoft: ${result.error}`, 'error');
      alert('Fallo en la autenticación de Microsoft: ' + result.error);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-brands fa-microsoft"></i> Iniciar sesión con Microsoft';
  });

  // Sidebar profile button (Log Out / Switch Account)
  document.getElementById('btn-nav-profile').addEventListener('click', () => {
    if (confirm('¿Deseas cerrar sesión y cambiar de cuenta?')) {
      localSettings.profile = null;
      localSettings.msToken = null;
      window.api.saveLocalSettings(localSettings);
      
      appendLog('Sesión cerrada por el usuario.', 'info');
      showLoginView();
    }
  });
}

// Transitions and Dash View
function showDashboard(playerName) {
  document.getElementById('dash-player-name').textContent = playerName;
  
  // Realizar una consulta inmediata de la configuración en segundo plano para asegurar el rango más actualizado
  fetchRemoteConfig(true);
  
  // Actualizar la etiqueta de rango (Administrador o Jugador)
  const roleBadge = document.getElementById('player-role-badge');
  if (roleBadge) {
    const isAdmin = remoteConfig.admins && Array.isArray(remoteConfig.admins)
      ? remoteConfig.admins.some(adm => adm.toLowerCase().trim() === playerName.toLowerCase().trim())
      : false;
      
    if (isAdmin) {
      roleBadge.textContent = 'ADMINISTRADOR';
      roleBadge.className = 'role-badge admin';
      roleBadge.style.display = 'inline-flex';
    } else {
      roleBadge.textContent = 'JUGADOR';
      roleBadge.className = 'role-badge user';
      roleBadge.style.display = 'inline-flex';
    }
  }
  
  // Transition panes
  document.getElementById('view-login').classList.remove('active');
  document.getElementById('view-dashboard').classList.add('active');
  
  // Show navigation sidebar
  document.getElementById('app-sidebar').style.display = 'flex';

}

function showLoginView() {
  document.getElementById('view-dashboard').classList.remove('active');
  document.getElementById('view-login').classList.add('active');
  
  // Hide navigation sidebar
  document.getElementById('app-sidebar').style.display = 'none';


}

// Play / Update Handler
function setupPlayHandler() {
  const playBtn = document.getElementById('btn-action-play');
  const progContainer = document.getElementById('update-progress-container');
  const progFill = document.getElementById('update-progress-fill');
  const progStatus = document.getElementById('update-progress-status');
  const progDetails = document.getElementById('update-progress-details');

  playBtn.addEventListener('click', async () => {
    // 1. Maintenance block check
    if (remoteConfig.maintenance) {
      alert('El servidor se encuentra actualmente en mantenimiento. Por favor, consulta los canales oficiales para más información.');
      appendLog('Intento de arranque cancelado: Servidor en mantenimiento.', 'warn');
      return;
    }

    // Toggle button UI
    playBtn.disabled = true;
    playBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PREPARANDO...';
    progContainer.classList.remove('hidden');
    progFill.style.width = '0%';
    progStatus.textContent = 'Comprobando actualizaciones...';
    progDetails.textContent = 'Calculando...';

    // Clonar ajustes locales para no sobreescribir la interfaz permanentemente
    const runSettings = { ...localSettings };

    // Determinar si el jugador tiene rango de Administrador
    const username = (localSettings.authType === 'microsoft' && localSettings.profile)
      ? localSettings.profile.name
      : (localSettings.username || 'PedsafioPlayer');

    const isAdmin = remoteConfig.admins && Array.isArray(remoteConfig.admins)
      ? remoteConfig.admins.some(adm => adm.toLowerCase().trim() === username.toLowerCase().trim())
      : false;

    if (isAdmin) {
      runSettings.gameFolder = localSettings.gameFolder + '-admin';
      appendLog(`[AutoUpdater] Rango detectado: Administrador. Usando instancia aislada: ${runSettings.gameFolder}`, 'info');
    } else {
      appendLog(`[AutoUpdater] Rango detectado: Común. Usando instancia estándar: ${runSettings.gameFolder}`, 'info');
    }

    // Start Updates and Launch Process
    window.api.startUpdateAndLaunch(
      remoteConfig,
      runSettings,
      (prog) => {
        // onProgress Callback
        progFill.style.width = `${prog.progress}%`;
        progStatus.textContent = `Descargando: ${prog.file}`;
        progDetails.textContent = `${prog.progress}% · ${prog.speed} MB/s · Quedan ${prog.eta}s`;
      },
      (status) => {
        // onStatus Callback
        // states: checking, updating, launching, running, closed, error
        if (status.state === 'checking') {
          progStatus.textContent = status.message;
        } else if (status.state === 'updating') {
          progStatus.textContent = status.message;
        } else if (status.state === 'launching') {
          progStatus.textContent = status.message;
          progFill.style.width = '100%';
          progDetails.textContent = '';
        } else if (status.state === 'running') {
          appendLog('¡Minecraft iniciado con éxito!', 'success');
          
          playBtn.innerHTML = '<i class="fa-solid fa-gamepad"></i> EN JUEGO';
          progContainer.classList.add('hidden');
          
          // Mimic background minimized state on run
          // We can call minimize or just keep running
          appendLog('Ocultando ventana de launcher en segundo plano.', 'debug');
        } else if (status.state === 'closed') {
          appendLog('Juego cerrado. Launcher restaurado.', 'info');
          
          playBtn.disabled = false;
          playBtn.innerHTML = '<i class="fa-solid fa-play"></i> JUGAR';
          progContainer.classList.add('hidden');
        } else if (status.state === 'error') {
          appendLog(`Error crítico: ${status.message}`, 'error');
          alert('Error al iniciar el juego: ' + status.message);
          
          playBtn.disabled = false;
          playBtn.innerHTML = '<i class="fa-solid fa-play"></i> JUGAR';
          progContainer.classList.add('hidden');
          
          // Show logs overlay to let users troubleshoot
          document.getElementById('overlay-console').classList.add('active');
        }
      },
      (logLine) => {
        // onLog Callback
        if (logLine.includes('[Error]')) {
          appendLog(logLine, 'error');
        } else if (logLine.includes('[Minecraft]')) {
          appendLog(logLine, 'debug');
        } else {
          appendLog(logLine, 'info');
        }
      }
    );
  });
}

// Local Settings Modals Binder
function setupSettingsModal() {
  const modal = document.getElementById('overlay-settings');
  const btnOpen = document.getElementById('btn-nav-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnSave = document.getElementById('btn-save-settings');
  const ramSlider = document.getElementById('settings-ram-slider');
  const ramLabel = document.getElementById('settings-ram-label');
  const folderInput = document.getElementById('settings-game-folder');

  btnOpen.addEventListener('click', () => {
    // Fill current settings in form
    loadSettingsIntoUI(localSettings);
    modal.classList.add('active');
  });

  btnClose.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  ramSlider.addEventListener('input', () => {
    const val = ramSlider.value;
    ramLabel.textContent = `${(val / 1024).toFixed(1)} GB (${val} MB)`;
  });

  btnSave.addEventListener('click', async () => {
    localSettings.ram = parseInt(ramSlider.value);
    localSettings.javaPath = document.getElementById('settings-java-path').value.trim();
    localSettings.resolutionWidth = parseInt(document.getElementById('settings-res-width').value) || 1024;
    localSettings.resolutionHeight = parseInt(document.getElementById('settings-res-height').value) || 768;
    localSettings.fullscreen = document.getElementById('settings-fullscreen').checked;
    localSettings.jvmArgs = document.getElementById('settings-jvm-args').value.trim();
    localSettings.gitToken = document.getElementById('settings-git-token').value.trim();
    
    const result = await window.api.saveLocalSettings(localSettings);
    if (result.success) {
      appendLog('Ajustes guardados localmente.', 'success');
      modal.classList.remove('active');
      // Refrescar configuración inmediatamente usando el nuevo token
      fetchRemoteConfig(true);
    } else {
      alert('Error al guardar ajustes: ' + result.error);
    }
  });
}

function loadSettingsIntoUI(settings) {
  const ramSlider = document.getElementById('settings-ram-slider');
  const ramLabel = document.getElementById('settings-ram-label');
  
  ramSlider.value = settings.ram || 4096;
  ramLabel.textContent = `${(ramSlider.value / 1024).toFixed(1)} GB (${ramSlider.value} MB)`;
  
  document.getElementById('settings-java-path').value = settings.javaPath || '';
  document.getElementById('settings-res-width').value = settings.resolutionWidth || 1024;
  document.getElementById('settings-res-height').value = settings.resolutionHeight || 768;
  document.getElementById('settings-fullscreen').checked = !!settings.fullscreen;
  document.getElementById('settings-jvm-args').value = settings.jvmArgs || '';
  document.getElementById('settings-game-folder').value = settings.gameFolder || '';
  document.getElementById('settings-git-token').value = settings.gitToken || '';
}

// Console modal listeners
function setupConsoleModal() {
  const modal = document.getElementById('overlay-console');
  const btnOpen = document.getElementById('btn-nav-console');
  const btnClose = document.getElementById('btn-close-console');
  const btnClear = document.getElementById('btn-clear-logs');
  const btnFolder = document.getElementById('btn-nav-folder');

  btnOpen.addEventListener('click', () => {
    modal.classList.add('active');
  });

  btnClose.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  btnClear.addEventListener('click', () => {
    const container = document.getElementById('console-logs-container');
    container.innerHTML = '<div class="log-line info">[Launcher] Logs limpiados.</div>';
  });

  btnFolder.addEventListener('click', () => {
    window.api.openFolder(localSettings.gameFolder);
  });
}

// Logs Logger Append Helper
function appendLog(line, type = 'info') {
  const container = document.getElementById('console-logs-container');
  if (!container) return;

  const lineEl = document.createElement('div');
  lineEl.className = `log-line ${type}`;
  
  // Strip timestamp and clean line
  const time = new Date().toLocaleTimeString();
  lineEl.textContent = `[${time}] ${line}`;
  
  container.appendChild(lineEl);
  
  // Auto scroll to bottom
  container.scrollTop = container.scrollHeight;
}
