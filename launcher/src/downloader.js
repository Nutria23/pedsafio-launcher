const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// Helper to compute SHA-256 hash of a local file
function getFileHash(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

// Helper to download a single file with progress tracking
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const fetchUrl = (currentUrl) => {
      const client = currentUrl.startsWith('https') ? https : http;
      
      client.get(currentUrl, (res) => {
        // Manejar Redirecciones (301, 302, 307, 308) habituales en Dropbox, Drive, etc.
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return fetchUrl(res.headers.location);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Server returned status code ${res.statusCode}`));
        }

        const fileStream = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          fileStream.write(chunk);
          onProgress(chunk.length);
        });

        res.on('end', () => {
          fileStream.end();
          resolve();
        });

        res.on('error', (err) => {
          fileStream.end();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        });
      }).on('error', (err) => {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    };

    fetchUrl(url);
  });
}

// Main Updater Execution
async function startSync(remoteConfig, settings, onProgress, onLog) {
  const downloadServer = remoteConfig.downloadServer || 'http://localhost:3000';
  const gameFolder = settings.gameFolder;
  
  onLog(`Conectando con el servidor de descargas: ${downloadServer}`);
  
  // 1. Fetch Remote Manifest
  let manifest = { files: [] };
  try {
    const manifestUrl = downloadServer.includes('raw.githubusercontent.com')
      ? `${downloadServer.replace('/public', '')}/manifest.json?nocache=${Date.now()}`
      : `${downloadServer}/api/manifest`;
      
    const resText = await fetchText(manifestUrl);
    manifest = JSON.parse(resText);
    onLog(`Manifiesto remoto cargado. Servidor registra ${manifest.filesCount || 0} archivos.`);
  } catch (err) {
    onLog(`No se pudo obtener el manifiesto remoto: ${err.message}. Saltando actualización delta.`);
    return; // Skip update if server is down, start game offline
  }

  // Ensure game folder exists
  if (!fs.existsSync(gameFolder)) {
    fs.mkdirSync(gameFolder, { recursive: true });
  }

  // Obtener el nombre del jugador y validar si es Administrador
  const username = (settings.authType === 'microsoft' && settings.profile)
    ? settings.profile.name
    : (settings.username || 'PedsafioPlayer');
    
  const isAdmin = remoteConfig.admins && Array.isArray(remoteConfig.admins)
    ? remoteConfig.admins.some(adm => adm.toLowerCase().trim() === username.toLowerCase().trim())
    : false;
    
  onLog(`Verificando rango. Jugador: ${username} | ¿Rango Administrador? ${isAdmin ? 'SÍ' : 'NO'}`);

  // 2. Scan Local Files and Compare
  const filesToDownload = [];
  const localFilesFound = new Set();
  
  onLog("Analizando integridad de archivos locales...");
  
  for (const remoteFile of manifest.files) {
    // Los admins solo procesan el paquete de administrador (instance-admin.zip.enc)
    // Los jugadores comunes solo procesan el paquete público (instance.zip.enc)
    if (remoteFile.adminOnly !== isAdmin) {
      continue;
    }

    let localRelPath = remoteFile.path;
    if (remoteFile.path.startsWith('http://') || remoteFile.path.startsWith('https://')) {
      try {
        const urlObj = new URL(remoteFile.path);
        const segments = urlObj.pathname.split('/');
        localRelPath = segments[segments.length - 1] || 'instance.zip';
      } catch (err) {
        localRelPath = 'instance.zip';
      }
    }

    const localPath = path.join(gameFolder, localRelPath);
    localFilesFound.add(localRelPath);

    // Si es un archivo ZIP o cifrado de instancia, verificar firma usando el recibo local (.hash)
    const isZip = localRelPath.endsWith('.zip') || localRelPath.endsWith('.zip.enc');
    const hashReceiptPath = localPath + '.hash';

    if (isZip) {
      localFilesFound.add(localRelPath + '.hash');
      
      // Si el recibo de hash coincide, la instancia ya está extraída y al día
      if (fs.existsSync(hashReceiptPath)) {
        try {
          const localHashReceipt = fs.readFileSync(hashReceiptPath, 'utf8').trim();
          if (localHashReceipt === remoteFile.hash) {
            continue;
          }
        } catch (e) {}
      }

      // Si no coincide o no se ha extraído, verificar si el archivo cifrado existe localmente
      if (!fs.existsSync(localPath)) {
        onLog(`[Aviso] Instancia cifrada ${localRelPath} no encontrada. Cópiala en la carpeta de juego para poder iniciar.`);
      }
      
      // Omitir descarga por internet de este archivo de instancia pesada
      continue;
    }

    if (!fs.existsSync(localPath)) {
      filesToDownload.push(remoteFile);
      continue;
    }

    const localHash = await getFileHash(localPath);
    if (localHash !== remoteFile.hash) {
      onLog(`Archivo modificado detectado: ${localRelPath} (Hash local: ${localHash || 'null'} | Servidor: ${remoteFile.hash})`);
      filesToDownload.push(remoteFile);
    }
  }

  // 3. Delete obsolete files (cleanup local folder)
  // Clean up mods, config and resourcepacks folders if files are not in server manifest anymore
  // to avoid client crashes due to mismatched mods versions
  const directoriesToClean = ['mods', 'config', 'resourcepacks', 'shaders'];
  for (const dirName of directoriesToClean) {
    const dirPath = path.join(gameFolder, dirName);
    if (fs.existsSync(dirPath)) {
      cleanDirectoryRecursively(dirPath, gameFolder, localFilesFound, onLog);
    }
  }

  if (filesToDownload.length === 0) {
    onLog("Todos los archivos están actualizados.");
    onProgress({ progress: 100, speed: 0, file: 'Listo', eta: 0 });
    return;
  }

  onLog(`Iniciando descarga de ${filesToDownload.length} archivos...`);

  // 4. Download files in parallel with limits
  const CONCURRENCY_LIMIT = 5;
  const totalBytes = filesToDownload.reduce((sum, f) => sum + f.size, 0);
  let totalDownloadedBytes = 0;
  
  let startTime = Date.now();
  let lastTime = Date.now();
  let lastBytes = 0;
  let currentSpeed = 0; // in MB/s

  const queue = [...filesToDownload];
  const activeDownloads = [];

  const runDownloaderWorker = () => {
    if (queue.length === 0) return Promise.resolve();
    
    const fileItem = queue.shift();
    let fileUrl = '';
    let localRelPath = fileItem.path;
    
    // Soporte para URLs completas externas (ej. Dropbox) en el manifiesto
    if (fileItem.path.startsWith('http://') || fileItem.path.startsWith('https://')) {
      fileUrl = fileItem.path;
      try {
        const urlObj = new URL(fileItem.path);
        const segments = urlObj.pathname.split('/');
        localRelPath = segments[segments.length - 1] || 'instance.zip';
      } catch (err) {
        localRelPath = 'instance.zip';
      }
    } else {
      fileUrl = `${downloadServer}/${fileItem.path}`;
    }
    
    const localDest = path.join(gameFolder, localRelPath);

    onLog(`Descargando: ${localRelPath} (${(fileItem.size / (1024 * 1024)).toFixed(2)} MB)`);

    return downloadFile(fileUrl, localDest, (chunkLen) => {
      totalDownloadedBytes += chunkLen;
      
      // Calculate speed and progress periodically
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000; // seconds
      
      if (timeDiff >= 0.5) {
        const bytesDiff = totalDownloadedBytes - lastBytes;
        currentSpeed = (bytesDiff / (1024 * 1024)) / timeDiff; // MB/s
        
        lastTime = now;
        lastBytes = totalDownloadedBytes;
      }

      // Calculate progress and remaining time
      const progress = Math.min(100, Math.round((totalDownloadedBytes / totalBytes) * 100));
      const remainingBytes = totalBytes - totalDownloadedBytes;
      const eta = currentSpeed > 0 ? Math.round((remainingBytes / (1024 * 1024)) / currentSpeed) : 0;

      onProgress({
        progress,
        speed: currentSpeed.toFixed(2),
        file: fileItem.path,
        eta
      });
    })
    .then(() => {
      onLog(`Descargado con éxito: ${fileItem.path}`);
      // Guardar firma del hash para los archivos ZIP o cifrados
      if (localRelPath.endsWith('.zip') || localRelPath.endsWith('.zip.enc')) {
        try {
          fs.writeFileSync(localDest + '.hash', fileItem.hash, 'utf8');
        } catch (e) {
          onLog(`[Aviso] No se pudo escribir recibo de firma: ${e.message}`);
        }
      }
      return runDownloaderWorker(); // Run next in queue
    })
    .catch((err) => {
      onLog(`[Error de descarga] falló ${fileItem.path}: ${err.message}. Reintentando...`);
      queue.push(fileItem); // Add back to queue for retry
      return runDownloaderWorker();
    });
  };

  // Launch parallel workers
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, filesToDownload.length); i++) {
    workers.push(runDownloaderWorker());
  }

  await Promise.all(workers);
  
  onLog("Sincronización de archivos finalizada con éxito.");
  onProgress({ progress: 100, speed: 0, file: 'Listo', eta: 0 });
}

// Helper to fetch text contents from URL
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', err => reject(err));
    }).on('error', err => reject(err));
  });
}

// Helper to recursively scan local client directory and delete files that are not listed in server's manifest
function cleanDirectoryRecursively(dir, gameFolder, allowedRelPaths, onLog) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      cleanDirectoryRecursively(filePath, gameFolder, allowedRelPaths, onLog);
      // Remove empty directory
      if (fs.readdirSync(filePath).length === 0) {
        fs.rmdirSync(filePath);
      }
    } else {
      const relPath = path.relative(gameFolder, filePath).replace(/\\/g, '/');
      if (!allowedRelPaths.has(relPath)) {
        onLog(`Eliminando archivo huérfano local: ${relPath}`);
        fs.unlinkSync(filePath);
      }
    }
  }
}

module.exports = { startSync };
