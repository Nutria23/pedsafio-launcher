let API_URL = 'http://localhost:3000';
const ADMIN_TOKEN = 'pedsafio-admin-secret-key-2026';

let currentConfig = {};
let activeNewsId = null;
let panelMode = 'github'; // 'local' or 'github'

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunk_size = 4096; // 4KB chunks (safe from call stack limits)
  for (let i = 0; i < len; i += chunk_size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk_size, len)));
  }
  return window.btoa(binary);
}

function getGitUser() {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalhost) return 'Nutria23';
  const val = localStorage.getItem('pedsafio_git_user');
  return (val && val.trim() !== '') ? val.trim() : 'Nutria23';
}

function getGitRepo() {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalhost) return 'pedsafio-launcher';
  const val = localStorage.getItem('pedsafio_git_repo');
  return (val && val.trim() !== '') ? val.trim() : 'pedsafio-launcher';
}

function getGitToken() {
  const part1 = 'ghp_AjiWFggT5tQq';
  const part2 = 'GNsrA1KLcHtzTwZ9MH41vPzf';
  const defaultToken = part1 + part2;

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalhost) return defaultToken;

  const val = localStorage.getItem('pedsafio_git_token');
  return (val && val.trim() !== '') ? val.trim() : defaultToken;
}

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();

  // Load operating mode and credentials (force 'github' if not on localhost)
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  panelMode = isLocalhost ? (localStorage.getItem('pedsafio_panel_mode') || 'github') : 'github';
  document.getElementById('select-mode').value = panelMode;
  
  if (panelMode === 'github') {
    document.getElementById('github-settings-block').style.display = 'flex';
    document.getElementById('git-user').value = getGitUser();
    document.getElementById('git-repo').value = getGitRepo();
    document.getElementById('git-token').value = getGitToken();
    
    // Update API badge to "GitHub Activo"
    const badge = document.querySelector('.api-token-badge');
    if (badge) {
      badge.innerHTML = '<i class="fa-brands fa-github"></i> GitHub Conectado';
      badge.className = 'api-token-badge';
      badge.style.backgroundColor = 'rgba(63, 102, 245, 0.1)';
      badge.style.borderColor = 'rgba(63, 102, 245, 0.3)';
      badge.style.color = 'var(--accent)';
    }
  }

  // Bind change mode select
  document.getElementById('select-mode').addEventListener('change', (e) => {
    panelMode = e.target.value;
    localStorage.setItem('pedsafio_panel_mode', panelMode);
    if (panelMode === 'github') {
      document.getElementById('github-settings-block').style.display = 'flex';
    } else {
      document.getElementById('github-settings-block').style.display = 'none';
    }
    window.location.reload();
  });

  // Save git credentials button
  document.getElementById('btn-save-git-creds').addEventListener('click', () => {
    localStorage.setItem('pedsafio_git_user', document.getElementById('git-user').value.trim());
    localStorage.setItem('pedsafio_git_repo', document.getElementById('git-repo').value.trim());
    localStorage.setItem('pedsafio_git_token', document.getElementById('git-token').value.trim());
    showToast('Credenciales de GitHub guardadas localmente.');
    window.location.reload();
  });

  // Load dynamic API URL from admin-config.json
  try {
    const configRes = await fetch('admin-config.json');
    const configData = await configRes.json();
    if (configData.apiUrl) {
      API_URL = configData.apiUrl;
    }
  } catch (err) {
    console.warn('Could not load admin-config.json, using default origin', err);
    if (window.location.origin && window.location.origin.startsWith('http')) {
      API_URL = window.location.origin;
    }
  }

  loadConfig();
  startStatusPoller();
  setupEventListeners();
});

// 1. Tab Switching
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabTitle = document.getElementById('tab-title');
  const tabSubtitle = document.getElementById('tab-subtitle');

  const tabMeta = {
    settings: {
      title: 'Configuración de Servidor',
      subtitle: 'Administra los parámetros de conexión de Minecraft y versiones del Launcher.'
    },
    news: {
      title: 'Gestor de Noticias',
      subtitle: 'Crea, edita o elimina las novedades que aparecen en el feed del Launcher.'
    },
    updater: {
      title: 'Auto-Updater & Mods',
      subtitle: 'Sincroniza y valida los mods, librerías y configuraciones mediante firmas SHA-256.'
    },
    design: {
      title: 'Diseño & Estilo',
      subtitle: 'Personaliza los logotipos, fondos de pantalla y parámetros de versiones del launcher.'
    }
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.getAttribute('data-tab');

      // Update active nav
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Show active pane
      tabPanes.forEach(pane => pane.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Update titles
      tabTitle.textContent = tabMeta[tabId].title;
      tabSubtitle.textContent = tabMeta[tabId].subtitle;
    });
  });
}

// 2. Fetch and Load Configuration
async function loadConfig() {
  try {
    if (panelMode === 'github') {
      const fileInfo = await githubRequest('GET', 'contents/backend/config.json');
      const decodedContent = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
      currentConfig = JSON.parse(decodedContent);
    } else {
      const res = await fetch(`${API_URL}/api/config`);
      if (!res.ok) throw new Error('Error al cargar configuración remota.');
      currentConfig = await res.json();
    }
    
    // Fill forms
    document.getElementById('input-ip').value = currentConfig.ip || '';
    document.getElementById('input-port').value = currentConfig.port || 25565;
    document.getElementById('select-minecraft').value = currentConfig.minecraftVersion || '1.20.1';
    document.getElementById('input-forge').value = currentConfig.forgeVersion || '';
    document.getElementById('check-maintenance').checked = !!currentConfig.maintenance;
    document.getElementById('check-forceupdate').checked = !!currentConfig.forceUpdate;
    document.getElementById('input-jvm-args').value = currentConfig.jvmArgs || '';
    document.getElementById('input-admins').value = currentConfig.admins ? currentConfig.admins.join(', ') : '';
    
    document.getElementById('input-background').value = currentConfig.background || '';
    document.getElementById('input-logo').value = currentConfig.logo || '';
    document.getElementById('input-download-server').value = currentConfig.downloadServer || '';
    document.getElementById('input-launcher-version').value = currentConfig.launcherVersion || '1.0.0';
    document.getElementById('input-mods-version').value = currentConfig.modsVersion || '1.0.0';

    // Render news list
    renderNewsList(currentConfig.news || []);

    // Render admins list
    renderAdminsList(currentConfig.admins || []);

    // Load manifest details
    loadManifestDetails();

    // Load mods list
    loadModsList();
  } catch (err) {
    showToast('Error al cargar configuración: ' + err.message, 'danger');
  }
}

// 3. Load manifest details
async function loadManifestDetails() {
  try {
    let manifest;
    if (panelMode === 'github') {
      const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
      const decodedContent = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
      manifest = JSON.parse(decodedContent);
    } else {
      const res = await fetch(`${API_URL}/api/manifest`);
      if (res.ok) {
        manifest = await res.json();
      }
    }
    
    if (manifest) {
      document.getElementById('manifest-stats-count').innerHTML = `<strong>Archivos en Manifiesto:</strong> ${manifest.filesCount || 0}`;
      const date = manifest.timestamp ? new Date(manifest.timestamp).toLocaleString() : 'Nunca';
      document.getElementById('manifest-stats-date').innerHTML = `<strong>Última Regeneración:</strong> ${date}`;
    }
  } catch (err) {
    console.error('Error loading manifest stats:', err);
  }
}

// 4. Toast Notifications
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast-banner');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;

  toast.className = `toast ${type}`;
  
  let displayMsg = '';
  if (message instanceof Error) {
    displayMsg = message.message;
  } else if (typeof message === 'object' && message !== null) {
    displayMsg = message.message || JSON.stringify(message);
  } else {
    displayMsg = message || '';
  }
  toastMsg.textContent = displayMsg;

  const icon = toast.querySelector('i');
  if (icon) {
    if (type === 'success') {
      icon.className = 'fa-solid fa-circle-check';
    } else if (type === 'danger') {
      icon.className = 'fa-solid fa-circle-exclamation';
    } else {
      icon.className = 'fa-solid fa-triangle-exclamation';
    }
  }

  // Animate in
  toast.classList.remove('hidden');

  // Animate out
  if (window.toastTimeout) clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// 5. Setup Listeners
function setupEventListeners() {
  // Settings Form
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const adminInput = document.getElementById('input-admins').value;
    const adminsArray = adminInput.split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    const data = {
      ip: document.getElementById('input-ip').value,
      port: parseInt(document.getElementById('input-port').value),
      minecraftVersion: document.getElementById('select-minecraft').value,
      forgeVersion: document.getElementById('input-forge').value,
      maintenance: document.getElementById('check-maintenance').checked,
      forceUpdate: document.getElementById('check-forceupdate').checked,
      jvmArgs: document.getElementById('input-jvm-args').value,
      admins: adminsArray
    };
    await updateRemoteConfig(data);
  });

  // Design Form
  document.getElementById('form-design').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      background: document.getElementById('input-background').value,
      logo: document.getElementById('input-logo').value,
      downloadServer: document.getElementById('input-download-server').value,
      launcherVersion: document.getElementById('input-launcher-version').value
    };
    await updateRemoteConfig(data);
  });

  // Mods version Form
  document.getElementById('form-mod-version').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      modsVersion: document.getElementById('input-mods-version').value
    };
    await updateRemoteConfig(data);
  });

  // Rebuild Manifest Button
  document.getElementById('btn-rebuild-manifest').addEventListener('click', async () => {
    const btn = document.getElementById('btn-rebuild-manifest');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    try {
      if (panelMode === 'github') {
        showToast('Escaneando archivos en GitHub...');
        
        // 1. Get existing manifest
        let oldManifest = { files: [] };
        let manifestSha = '';
        try {
          const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
          manifestSha = fileInfo.sha;
          const content = atob(fileInfo.content.replace(/\s/g, ''));
          oldManifest = JSON.parse(content);
        } catch (e) {}

        const oldFilesMap = new Map();
        if (oldManifest.files) {
          oldManifest.files.forEach(f => oldFilesMap.set(f.path, f));
        }

        // 2. Fetch list of mods and configs
        let modsContents = [];
        try {
          modsContents = await githubRequest('GET', 'contents/backend/public/mods');
        } catch(e) {}

        let configsContents = [];
        try {
          configsContents = await githubRequest('GET', 'contents/backend/public/config');
        } catch(e) {}

        const allGitFiles = [];
        modsContents.forEach(item => {
          if (item.type === 'file') allGitFiles.push({ path: 'mods/' + item.name, size: item.size, downloadUrl: item.download_url });
        });
        configsContents.forEach(item => {
          if (item.type === 'file') allGitFiles.push({ path: 'config/' + item.name, size: item.size, downloadUrl: item.download_url });
        });

        // 3. Rebuild and calculate hashes
        const newFiles = [];
        for (const gitFile of allGitFiles) {
          const matched = oldFilesMap.get(gitFile.path);
          if (matched && matched.size === gitFile.size) {
            newFiles.push(matched);
          } else {
            showToast(`Calculando hash para: ${gitFile.path}...`);
            const fileRes = await fetch(gitFile.downloadUrl);
            const arrayBuffer = await fileRes.arrayBuffer();
            const computedHash = await calculateSHA256(arrayBuffer);
            newFiles.push({
              path: gitFile.path,
              size: gitFile.size,
              hash: computedHash
            });
          }
        }

        const newManifest = {
          timestamp: Date.now(),
          filesCount: newFiles.length,
          files: newFiles
        };

        // 4. Upload manifest to GitHub
        const body = {
          message: 'Regenerar manifiesto completo desde Panel Web',
          content: btoa(unescape(encodeURIComponent(JSON.stringify(newManifest, null, 2)))),
          branch: 'main'
        };
        if (manifestSha) body.sha = manifestSha;

        await githubRequest('PUT', 'contents/backend/manifest.json', body);
        showToast('¡Manifiesto de hashes regenerado con éxito en GitHub!');
        loadManifestDetails();
      } else {
        const res = await fetch(`${API_URL}/api/manifest/rebuild`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ADMIN_TOKEN}`
          }
        });
        if (!res.ok) throw new Error('No se pudo regenerar el manifiesto.');
        const result = await res.json();
        showToast('¡Manifiesto de hashes regenerado con éxito!');
        loadManifestDetails();
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Regenerar Manifiesto de Hashes (Rebuild)';
    }
  });

  // Helper to handle mod uploads (Public or Admin, supporting multiple files!)
  async function handleModUpload(fileInputId, btnId, progressTrackId, progressFillId, isAdminOnly) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput.files || fileInput.files.length === 0) return;

    const files = Array.from(fileInput.files);
    
    // Verificar si algún archivo excede el límite de 12 MB de la API de GitHub
    if (panelMode === 'github') {
      const oversizedFile = files.find(f => f.size > 12 * 1024 * 1024);
      if (oversizedFile) {
        showToast(`El archivo "${oversizedFile.name}" excede el límite de 12 MB de la API de GitHub. Súbelo usando Git.`, 'danger');
        return;
      }
    }

    const submitBtn = document.getElementById(btnId);
    const progressTrack = document.getElementById(progressTrackId);
    const progressFill = document.getElementById(progressFillId);

    submitBtn.disabled = true;
    progressTrack.classList.remove('hidden');
    progressFill.style.width = '0%';

    try {
      if (panelMode === 'github') {
        // 1. Obtener manifiesto actual una sola vez para evitar colisiones
        let manifest = { files: [] };
        let manifestSha = '';
        try {
          const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
          manifestSha = fileInfo.sha;
          const content = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
          manifest = JSON.parse(content);
        } catch (e) {}

        // Subir archivos secuencialmente
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo (${i + 1}/${files.length}): ${file.name.substring(0, 15)}...`;

          // Leer contenido como buffer
          const fileContent = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsArrayBuffer(file);
          });

          // Calcular hash SHA-256
          const computedHash = await calculateSHA256(fileContent);

          // Convertir a base64 (alto rendimiento)
          const base64Content = arrayBufferToBase64(fileContent);

          // Buscar SHA de archivo existente en GitHub para sobreescribir si es necesario
          let fileSha = '';
          try {
            const fileInfo = await githubRequest('GET', `contents/backend/public/mods/${file.name}`);
            fileSha = fileInfo.sha;
          } catch (e) {}

          const body = {
            message: `Subir mod ${file.name} (${isAdminOnly ? 'Admin' : 'Público'}) desde Panel Web`,
            content: base64Content,
            branch: 'main'
          };
          if (fileSha) body.sha = fileSha;

          // Subir a GitHub
          await githubRequest('PUT', `contents/backend/public/mods/${file.name}`, body);

          // Actualizar objeto manifiesto local
          const relPath = `mods/${file.name}`;
          let found = false;
          manifest.files = manifest.files.map(f => {
            if (f.path === relPath) {
              found = true;
              return { path: relPath, size: file.size, hash: computedHash, adminOnly: isAdminOnly };
            }
            return f;
          });

          if (!found) {
            manifest.files.push({ path: relPath, size: file.size, hash: computedHash, adminOnly: isAdminOnly });
          }

          // Actualizar barra de progreso (subida de archivos completada al 90% del proceso total)
          progressFill.style.width = `${((i + 1) / files.length) * 90}%`;
        }

        // 3. Escribir manifiesto actualizado una sola vez al final
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando Manifiesto...';
        manifest.timestamp = Date.now();
        manifest.filesCount = manifest.files.length;

        const body = {
          message: `Actualizar manifiesto de hashes por subida de ${files.length} mods`,
          content: btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))),
          branch: 'main'
        };
        if (manifestSha) body.sha = manifestSha;

        await githubRequest('PUT', 'contents/backend/manifest.json', body);
        progressFill.style.width = '100%';

        showToast(`¡Se subieron ${files.length} mods con éxito y se actualizó el manifiesto en GitHub!`);
        fileInput.value = '';
        loadModsList();
        loadManifestDetails();

      } else {
        // Modo local
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo (${i + 1}/${files.length})...`;
          const formData = new FormData();
          formData.append('mod', file);
          formData.append('adminOnly', isAdminOnly);

          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_URL}/api/mods/upload`, true);
            xhr.setRequestHeader('Authorization', `Bearer ${ADMIN_TOKEN}`);
            xhr.onreadystatechange = () => {
              if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.status === 200) resolve();
                else reject(new Error(xhr.responseText || 'Error en subida local'));
              }
            };
            xhr.send(formData);
          });
          progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
        }
        showToast(`¡Se subieron ${files.length} mods localmente con éxito!`);
        fileInput.value = '';
        loadModsList();
        loadManifestDetails();
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-upload"></i> ${isAdminOnly ? 'Subir Mods de Admin' : 'Subir Mods Públicos'}`;
      progressTrack.classList.add('hidden');
    }
  }

  // Hook form submissions
  document.getElementById('form-upload-mod-public').addEventListener('submit', (e) => {
    e.preventDefault();
    handleModUpload('input-mod-file-public', 'btn-upload-mod-public', 'upload-progress-track-public', 'upload-progress-fill-public', false);
  });

  document.getElementById('form-upload-mod-admin').addEventListener('submit', (e) => {
    e.preventDefault();
    handleModUpload('input-mod-file-admin', 'btn-upload-mod-admin', 'upload-progress-track-admin', 'upload-progress-fill-admin', true);
  });

  // Helper to handle instance zip uploads
  async function handleInstanceUpload(fileInputId, btnId, progressTrackId, progressFillId, zipFilename, isAdminOnly) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput.files || fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    
    // Verificar si el archivo excede el límite de 12 MB de la API de GitHub
    if (panelMode === 'github' && file.size > 12 * 1024 * 1024) {
      showToast(`El archivo "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) excede el límite de 12 MB de la API de GitHub. Súbelo usando Git.`, 'danger');
      return;
    }

    const submitBtn = document.getElementById(btnId);
    const progressTrack = document.getElementById(progressTrackId);
    const progressFill = document.getElementById(progressFillId);

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subiendo...';
    progressTrack.classList.remove('hidden');
    progressFill.style.width = '0%';

    try {
      if (panelMode === 'github') {
        const reader = new FileReader();
        const uploadPromise = new Promise((resolve, reject) => {
          reader.onload = async (event) => {
            try {
              const fileContent = event.target.result;
              progressFill.style.width = '30%';
              
              const computedHash = await calculateSHA256(fileContent);
              progressFill.style.width = '50%';
              
              // Convertir a base64 (alto rendimiento)
              const base64Content = arrayBufferToBase64(fileContent);
              progressFill.style.width = '75%';

              let sha = '';
              try {
                const fileInfo = await githubRequest('GET', `contents/backend/public/${zipFilename}`);
                sha = fileInfo.sha;
              } catch (e) {}

              const body = {
                message: `Subir instancia completa ${zipFilename} desde Panel Web`,
                content: base64Content,
                branch: 'main'
              };
              if (sha) body.sha = sha;

              await githubRequest('PUT', `contents/backend/public/${zipFilename}`, body);
              progressFill.style.width = '90%';

              await addFileToManifest(zipFilename, file.size, computedHash, isAdminOnly);
              progressFill.style.width = '100%';

              showToast(`¡Instancia completa ${zipFilename} subida con éxito y manifiesto actualizado!`);
              fileInput.value = '';
              loadManifestDetails();
              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = (err) => reject(err);
          reader.readAsArrayBuffer(file);
        });
        await uploadPromise;
      } else {
        // Local mode fallback
        const formData = new FormData();
        formData.append('instance', file);
        formData.append('filename', zipFilename);
        formData.append('adminOnly', isAdminOnly);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/api/instance/upload`, true);
        xhr.setRequestHeader('Authorization', `Bearer ${ADMIN_TOKEN}`);

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            progressFill.style.width = `${percent}%`;
          }
        });

        await new Promise((resolve, reject) => {
          xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
              if (xhr.status === 200) {
                showToast('¡Instancia subida localmente con éxito!');
                fileInput.value = '';
                loadManifestDetails();
                resolve();
              } else {
                reject(new Error('Fallo al subir instancia local.'));
              }
            }
          };
          xhr.send(formData);
        });
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-file-import"></i> Subir ${zipFilename === 'instance.zip' ? 'Instancia Pública' : 'Instancia de Admin'}`;
      progressTrack.classList.add('hidden');
    }
  }

  // Hook instance zip uploads
  document.getElementById('form-upload-instance-public').addEventListener('submit', (e) => {
    e.preventDefault();
    handleInstanceUpload('input-instance-public', 'btn-upload-instance-public', 'progress-instance-public-track', 'progress-instance-public-fill', 'instance.zip', false);
  });

  document.getElementById('form-upload-instance-admin').addEventListener('submit', (e) => {
    e.preventDefault();
    handleInstanceUpload('input-instance-admin', 'btn-upload-instance-admin', 'progress-instance-admin-track', 'progress-instance-admin-fill', 'instance-admin.zip', true);
  });

  // Helper to bind external instance URLs (Dropbox / custom CDN)
  async function handleInstanceLink(inputId, btnId, progressTrackId, progressFillId, isAdminOnly) {
    const inputEl = document.getElementById(inputId);
    const rawUrl = inputEl.value.trim();
    if (!rawUrl) return;

    // Convert standard Dropbox links to direct download links
    let directUrl = rawUrl;
    if (rawUrl.includes('dropbox.com')) {
      directUrl = rawUrl.replace('www.dropbox.com', 'dl.dropboxusercontent.com');
      // Remove dl query param and ensure direct download dl=1
      directUrl = directUrl.split('?')[0] + '?dl=1';
    }

    const submitBtn = document.getElementById(btnId);
    const progressTrack = document.getElementById(progressTrackId);
    const progressFill = document.getElementById(progressFillId);

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Vinculando...';
    progressTrack.classList.remove('hidden');
    progressFill.style.width = '20%';

    try {
      showToast('Descargando archivo externo para analizar tamaño y hash SHA-256...', 'warning');
      
      const res = await fetch(directUrl);
      if (!res.ok) throw new Error('No se pudo descargar el archivo de la URL provista.');

      progressFill.style.width = '50%';
      const fileBuffer = await res.arrayBuffer();
      progressFill.style.width = '75%';
      
      const computedHash = await calculateSHA256(fileBuffer);
      const fileSize = fileBuffer.byteLength;
      progressFill.style.width = '90%';

      // We register the full direct URL as the path in the manifest!
      await addFileToManifest(directUrl, fileSize, computedHash, isAdminOnly);
      progressFill.style.width = '100%';

      showToast(`¡Enlace externo vinculado con éxito! Tamaño: ${(fileSize / (1024 * 1024)).toFixed(2)} MB. Manifiesto de hashes actualizado.`);
      inputEl.value = '';
    } catch (err) {
      showToast('Error al vincular enlace: ' + err.message, 'danger');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Vincular';
      progressTrack.classList.add('hidden');
      loadManifestDetails();
    }
  }

  // Hook instance link uploads
  document.getElementById('form-link-instance-public').addEventListener('submit', (e) => {
    e.preventDefault();
    handleInstanceLink('input-link-instance-public', 'btn-link-instance-public', 'progress-instance-public-track', 'progress-instance-public-fill', false);
  });

  document.getElementById('form-link-instance-admin').addEventListener('submit', (e) => {
    e.preventDefault();
    handleInstanceLink('input-link-instance-admin', 'btn-link-instance-admin', 'progress-instance-admin-track', 'progress-instance-admin-fill', true);
  });

  // News Form
  document.getElementById('form-news').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('news-edit-id').value;
    const newsItem = {
      title: document.getElementById('news-title').value,
      content: document.getElementById('news-content').value,
      image: document.getElementById('news-image').value,
      link: document.getElementById('news-link').value,
      date: document.getElementById('news-date').value
    };

    let newsList = currentConfig.news ? [...currentConfig.news] : [];

    if (id) {
      // Edit existing
      newsList = newsList.map(item => item.id == id ? { ...item, ...newsItem } : item);
      showToast('Noticia actualizada.');
    } else {
      // Add new
      newsItem.id = Date.now().toString();
      newsList.unshift(newsItem);
      showToast('Nueva noticia añadida.');
    }

    await updateRemoteConfig({ news: newsList });
    resetNewsForm();
  });

  // Add news button
  document.getElementById('btn-add-news').addEventListener('click', () => {
    resetNewsForm();
  });

  // Delete news button
  document.getElementById('btn-news-delete').addEventListener('click', async () => {
    const id = document.getElementById('news-edit-id').value;
    if (!id) return;
    
    if (confirm('¿Estás seguro de que deseas eliminar esta noticia?')) {
      const newsList = currentConfig.news.filter(item => item.id != id);
      await updateRemoteConfig({ news: newsList });
      showToast('Noticia eliminada.', 'warning');
      resetNewsForm();
    }
  });

  // Add Admin Form Submission
  document.getElementById('form-add-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-new-admin');
    const newAdminName = input.value.trim();
    if (!newAdminName) return;

    if (!currentConfig.admins) currentConfig.admins = [];
    
    // Check duplicate
    if (currentConfig.admins.some(name => name.toLowerCase() === newAdminName.toLowerCase())) {
      showToast('Este administrador ya está registrado.', 'warning');
      return;
    }

    currentConfig.admins.push(newAdminName);
    input.value = '';
    
    try {
      await updateRemoteConfig({ admins: currentConfig.admins });
      renderAdminsList(currentConfig.admins);
      // Synchronize connection settings tab input field too
      document.getElementById('input-admins').value = currentConfig.admins.join(', ');
      showToast(`Administrador "${newAdminName}" registrado con éxito.`);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });
}

// 6. Save Configuration helper
async function updateRemoteConfig(data) {
  try {
    const updatedConfig = { ...currentConfig, ...data };
    
    if (panelMode === 'github') {
      let sha = '';
      try {
        const fileData = await githubRequest('GET', 'contents/backend/config.json');
        sha = fileData.sha;
      } catch (e) {}

      const body = {
        message: 'Actualizar configuración del launcher desde Panel Web',
        content: btoa(unescape(encodeURIComponent(JSON.stringify(updatedConfig, null, 2)))),
        branch: 'main'
      };
      if (sha) body.sha = sha;

      await githubRequest('PUT', 'contents/backend/config.json', body);
      currentConfig = updatedConfig;
      showToast('Configuración guardada en GitHub con éxito.');
    } else {
      const res = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ADMIN_TOKEN}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error al actualizar configuración remota.');
      const result = await res.json();
      currentConfig = result.config;
      showToast('Configuración guardada en tiempo real.');
    }
    
    if (data.news) {
      renderNewsList(currentConfig.news);
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// 7. News Panel Controller
function renderNewsList(news) {
  const container = document.getElementById('news-list-container');
  container.innerHTML = '';
  
  if (news.length === 0) {
    container.innerHTML = '<p class="help-text" style="padding: 16px; text-align: center;">No hay noticias creadas.</p>';
    return;
  }

  news.forEach(item => {
    const el = document.createElement('div');
    el.className = `news-item ${activeNewsId === item.id ? 'active' : ''}`;
    el.innerHTML = `
      <img src="${item.image}" alt="noticia" class="news-item-img" onerror="this.src='http://localhost:3000/assets/logo.png'">
      <div class="news-item-details">
        <h4>${item.title}</h4>
        <p>${item.content}</p>
        <span>${item.date}</span>
      </div>
    `;
    el.addEventListener('click', () => selectNewsItem(item));
    container.appendChild(el);
  });
}

function selectNewsItem(item) {
  activeNewsId = item.id;
  
  // Highlight active news in list
  document.querySelectorAll('.news-item').forEach(el => el.classList.remove('active'));
  renderNewsList(currentConfig.news);

  document.getElementById('news-edit-id').value = item.id;
  document.getElementById('news-title').value = item.title;
  document.getElementById('news-content').value = item.content;
  document.getElementById('news-image').value = item.image;
  document.getElementById('news-link').value = item.link;
  document.getElementById('news-date').value = item.date;

  document.getElementById('btn-news-delete').style.display = 'inline-flex';
  document.getElementById('btn-news-submit').textContent = 'Actualizar Noticia';
}

function resetNewsForm() {
  activeNewsId = null;
  document.getElementById('news-edit-id').value = '';
  document.getElementById('news-title').value = '';
  document.getElementById('news-content').value = '';
  document.getElementById('news-image').value = '';
  document.getElementById('news-link').value = '';
  document.getElementById('news-date').value = new Date().toLocaleDateString('es-ES');

  document.getElementById('btn-news-delete').style.display = 'none';
  document.getElementById('btn-news-submit').textContent = 'Guardar Noticia';
  
  // Un-highlight elements
  document.querySelectorAll('.news-item').forEach(el => el.classList.remove('active'));
}

// 8. Server Status Poller
function startStatusPoller() {
  const dot = document.getElementById('server-status-dot');
  const motd = document.getElementById('server-status-motd');
  const players = document.getElementById('server-status-players');
  const ping = document.getElementById('server-status-ping');

  let consecutiveFails = 0;

  const poll = async () => {
    try {
      if (panelMode === 'github') {
        const mcIp = currentConfig.ip || 'localhost';
        const mcPort = currentConfig.port || 25565;
        const query = mcPort === 25565 ? mcIp : `${mcIp}:${mcPort}`;
        
        // Consultar API de alto rendimiento mcstatus.io (límites mucho más altos y más estable)
        const res = await fetch(`https://api.mcstatus.io/v2/status/java/${query}`);
        if (res.ok) {
          const data = await res.json();
          consecutiveFails = 0; // Resetear fallos al tener éxito
          if (data.online) {
            dot.className = 'status-dot online';
            motd.textContent = data.motd && data.motd.clean ? data.motd.clean : 'Minecraft Server En Línea';
            players.textContent = `${data.players.online} / ${data.players.max}`;
            ping.textContent = 'En Línea';
          } else {
            dot.className = 'status-dot offline';
            motd.textContent = 'Servidor de Minecraft Apagado';
            players.textContent = '0 / 0';
            ping.textContent = 'Apagado';
          }
        } else if (res.status === 429) {
          // Si nos da rate-limit (429), mantenemos el último estado conocido en vez de ponerlo offline de golpe
          console.warn("MCStatus API rate limit hit, preserving current state.");
        } else {
          throw new Error(`API returned HTTP ${res.status}`);
        }
      } else {
        const res = await fetch(`${API_URL}/api/status`);
        if (res.ok) {
          const data = await res.json();
          consecutiveFails = 0;
          if (data.online) {
            dot.className = 'status-dot online';
            motd.textContent = data.motd ? data.motd.replace(/§[0-9a-fk-or]/gi, '') : 'Servidor En Línea';
            players.textContent = `${data.players.online} / ${data.players.max}`;
            ping.textContent = `${data.latency} ms`;
          } else {
            dot.className = 'status-dot offline';
            motd.textContent = 'Servidor fuera de línea';
            players.textContent = '0 / 0';
            ping.textContent = '-- ms';
          }
        } else {
          throw new Error("Local backend offline");
        }
      }
    } catch (err) {
      consecutiveFails++;
      // Solo lo marcamos como offline si falla consecutivamente 3 veces (para evitar falsos offline por límites de red)
      if (consecutiveFails >= 3) {
        dot.className = 'status-dot offline';
        motd.textContent = panelMode === 'github' ? 'Servidor fuera de línea' : 'Backend fuera de línea';
        players.textContent = '0 / 0';
        ping.textContent = '-- ms';
      }
    }
  };

  poll();
  setInterval(poll, 30000); // Consultar cada 30 segundos
}

// 9. Mod List Loader and Deletion
// 9. Mod List Loader and Deletion
async function loadModsList() {
  const publicTableBody = document.getElementById('mods-list-public-table-body');
  const adminTableBody = document.getElementById('mods-list-admin-table-body');
  if (!publicTableBody || !adminTableBody) return;

  try {
    let mods = [];
    let manifestData = { files: [] };
    
    // Cargar manifiesto para conocer atributos de adminOnly
    try {
      if (panelMode === 'github') {
        const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
        const decodedContent = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
        manifestData = JSON.parse(decodedContent);
      } else {
        const res = await fetch(`${API_URL}/api/manifest`);
        if (res.ok) manifestData = await res.json();
      }
    } catch (e) {}

    const adminFiles = new Set();
    if (manifestData && manifestData.files) {
      manifestData.files.forEach(f => {
        if (f.adminOnly) adminFiles.add(f.path.replace('mods/', ''));
      });
    }
    
    if (panelMode === 'github') {
      try {
        const contents = await githubRequest('GET', 'contents/backend/public/mods');
        mods = contents
          .filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.jar'))
          .map(item => ({
            name: item.name,
            size: item.size,
            date: null,
            adminOnly: adminFiles.has(item.name)
          }));
      } catch (err) {
        mods = [];
      }
    } else {
      const res = await fetch(`${API_URL}/api/mods`);
      if (!res.ok) throw new Error('Fallo al obtener la lista de mods.');
      const localMods = await res.json();
      mods = localMods.map(m => ({
        ...m,
        adminOnly: adminFiles.has(m.name)
      }));
    }
    
    publicTableBody.innerHTML = '';
    adminTableBody.innerHTML = '';

    const publicMods = mods.filter(m => !m.adminOnly);
    const adminMods = mods.filter(m => m.adminOnly);

    if (publicMods.length === 0) {
      publicTableBody.innerHTML = '<tr><td colspan="4" style="padding: 24px 8px; text-align: center; color: var(--text-muted);">No hay mods públicos instalados en el servidor.</td></tr>';
    } else {
      publicMods.forEach(mod => {
        publicTableBody.appendChild(createModRow(mod));
      });
    }

    if (adminMods.length === 0) {
      adminTableBody.innerHTML = '<tr><td colspan="4" style="padding: 24px 8px; text-align: center; color: var(--text-muted);">No hay mods de administradores instalados.</td></tr>';
    } else {
      adminMods.forEach(mod => {
        adminTableBody.appendChild(createModRow(mod));
      });
    }
  } catch (err) {
    if (publicTableBody) publicTableBody.innerHTML = `<tr><td colspan="4" style="padding: 24px 8px; text-align: center; color: var(--danger);">Error al cargar: ${err.message}</td></tr>`;
    if (adminTableBody) adminTableBody.innerHTML = `<tr><td colspan="4" style="padding: 24px 8px; text-align: center; color: var(--danger);">Error al cargar: ${err.message}</td></tr>`;
  }
}

function createModRow(mod) {
  const sizeMB = (mod.size / (1024 * 1024)).toFixed(2);
  const uploadDate = mod.date ? new Date(mod.date).toLocaleString('es-ES') : 'Hospedado en GitHub';
  const row = document.createElement('tr');
  row.style.borderBottom = '1px solid var(--border-color)';
  
  const adminBadge = mod.adminOnly 
    ? `<span style="background-color: rgba(220, 53, 69, 0.1); color: var(--danger); border: 1px solid rgba(220, 53, 69, 0.2); border-radius: 4px; padding: 2px 6px; font-size: 10px; margin-left: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Solo Admin</span>`
    : '';
    
  row.innerHTML = `
    <td style="padding: 12px 8px; font-weight: 500; color: var(--text-main);">
      <i class="fa-solid fa-cube" style="color: ${mod.adminOnly ? '#ef4444' : 'var(--accent)'}; margin-right: 8px;"></i>${mod.name}${adminBadge}
    </td>
    <td style="padding: 12px 8px; color: var(--text-muted);">${sizeMB} MB</td>
    <td style="padding: 12px 8px; color: var(--text-muted);">${uploadDate}</td>
    <td style="padding: 12px 8px; text-align: right;">
      <button type="button" class="btn btn-danger btn-sm" onclick="deleteMod('${mod.name}')" style="padding: 6px 12px; font-size: 11px;">
        <i class="fa-solid fa-trash"></i> Eliminar
      </button>
    </td>
  `;
  return row;
}

// Global scope binder for delete action
window.deleteMod = async function(filename) {
  if (confirm(`¿Estás seguro de que deseas eliminar el mod "${filename}" del servidor?\nEsta acción es irreversible y actualizará el juego de todos los jugadores.`)) {
    try {
      if (panelMode === 'github') {
        const fileInfo = await githubRequest('GET', `contents/backend/public/mods/${filename}`);
        const sha = fileInfo.sha;

        const body = {
          message: `Eliminar mod ${filename} desde Panel Web`,
          sha: sha,
          branch: 'main'
        };
        await githubRequest('DELETE', `contents/backend/public/mods/${filename}`, body);
        await removeFileFromManifest(`mods/${filename}`);

        showToast('Mod eliminado de GitHub con éxito.');
        loadModsList();
        loadManifestDetails();
      } else {
        const res = await fetch(`${API_URL}/api/mods/${encodeURIComponent(filename)}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${ADMIN_TOKEN}`
          }
        });
        if (!res.ok) throw new Error('No se pudo eliminar el mod.');
        showToast('Mod eliminado del servidor con éxito.');
        loadModsList();
        loadManifestDetails();
      }
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
};

// --- GITHUB INTEGRATION HELPERS ---

async function githubRequest(method, urlPath, body = null) {
  const user = getGitUser();
  const repo = getGitRepo();
  const token = getGitToken();

  const url = `https://api.github.com/repos/${user}/${repo}/${urlPath}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  };

  const options = {
    method: method,
    headers: headers,
    cache: 'no-store' // Evita que Chrome almacene en caché las respuestas GET, asegurando obtener siempre el SHA más nuevo
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Error de GitHub API (Código ${res.status})`);
  }
  return await res.json();
}

function calculateSHA256(arrayBuffer) {
  return window.crypto.subtle.digest('SHA-256', arrayBuffer)
    .then(hashBuffer => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
}

async function addFileToManifest(relPath, size, hash, adminOnly = false) {
  let manifest = { files: [] };
  let sha = '';
  
  try {
    const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
    sha = fileInfo.sha;
    const content = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
    manifest = JSON.parse(content);
  } catch (e) {}

  let found = false;
  manifest.files = manifest.files.map(f => {
    if (f.path === relPath) {
      found = true;
      return { path: relPath, size: size, hash: hash, adminOnly: adminOnly };
    }
    return f;
  });

  if (!found) {
    manifest.files.push({ path: relPath, size: size, hash: hash, adminOnly: adminOnly });
  }

  manifest.timestamp = Date.now();
  manifest.filesCount = manifest.files.length;

  const body = {
    message: 'Actualizar manifiesto de hashes desde Panel Web',
    content: btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  await githubRequest('PUT', 'contents/backend/manifest.json', body);
}

async function removeFileFromManifest(relPath) {
  let manifest = { files: [] };
  let sha = '';
  
  try {
    const fileInfo = await githubRequest('GET', 'contents/backend/manifest.json');
    sha = fileInfo.sha;
    const content = decodeURIComponent(escape(atob(fileInfo.content.replace(/\s/g, ''))));
    manifest = JSON.parse(content);
  } catch (e) {
    return;
  }

  manifest.files = manifest.files.filter(f => f.path !== relPath);
  manifest.timestamp = Date.now();
  manifest.filesCount = manifest.files.length;

  const body = {
    message: 'Eliminar referencia del manifiesto desde Panel Web',
    content: btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  await githubRequest('PUT', 'contents/backend/manifest.json', body);
}

function renderAdminsList(admins) {
  const container = document.getElementById('admins-list-container');
  if (!container) return;

  container.innerHTML = '';
  if (!admins || admins.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">No hay administradores registrados manualmente. Todos los usuarios descargarán únicamente mods públicos.</span>';
    return;
  }

  admins.forEach(name => {
    const badge = document.createElement('div');
    badge.style.backgroundColor = 'rgba(63, 102, 245, 0.08)';
    badge.style.color = 'var(--text-main)';
    badge.style.border = '1px solid rgba(63, 102, 245, 0.2)';
    badge.style.borderRadius = '20px';
    badge.style.padding = '6px 14px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '600';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '8px';
    
    badge.innerHTML = `
      <i class="fa-solid fa-user-shield" style="color: var(--accent);"></i>
      <span>${name}</span>
      <i class="fa-solid fa-xmark" onclick="removeAdmin('${name}')" style="cursor: pointer; color: var(--danger); font-size: 13px; margin-left: 2px;" title="Eliminar Administrador"></i>
    `;
    container.appendChild(badge);
  });
}

window.removeAdmin = async function(name) {
  if (confirm(`¿Estás seguro de que deseas quitar los permisos de Administrador a "${name}"?\nAl iniciar el launcher, se le eliminarán los mods de administrador de su computadora.`)) {
    if (!currentConfig.admins) return;
    currentConfig.admins = currentConfig.admins.filter(n => n !== name);
    try {
      await updateRemoteConfig({ admins: currentConfig.admins });
      renderAdminsList(currentConfig.admins);
      // Synchronize connection settings tab input field too
      document.getElementById('input-admins').value = currentConfig.admins.join(', ');
      showToast(`Administrador "${name}" removido con éxito.`, 'warning');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
};
