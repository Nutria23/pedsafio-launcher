const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Helper to download files (redirect-aware)
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    
    const request = (targetUrl) => {
      https.get(targetUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Código de estado HTTP: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    };
    
    request(url);
  });
}

function runLaunchSequence(remoteConfig, settings, onStatus, onLog, onLaunchComplete, onLaunchClosed) {
  return new Promise(async (resolve, reject) => {
    try {
      const launcher = new Client();
      const gameFolder = settings.gameFolder || path.join(process.env.APPDATA, '.pedsafio-client');
      
      if (!fs.existsSync(gameFolder)) {
        fs.mkdirSync(gameFolder, { recursive: true });
      }
      
      onLog(`Directorio de juego: ${gameFolder}`);

      // 1. Configure Authentication
      let authObj;
      const username = (settings.authType === 'microsoft' && settings.profile)
        ? settings.profile.name
        : (settings.username || 'PedsafioPlayer');
        
      const isAdmin = remoteConfig.admins && Array.isArray(remoteConfig.admins)
        ? remoteConfig.admins.some(adm => adm.toLowerCase().trim() === username.toLowerCase().trim())
        : false;

      if (settings.authType === 'microsoft' && settings.profile) {
        onLog(`Iniciando sesión Premium con Microsoft como: ${username}`);
        authObj = settings.profile;
      } else {
        onLog(`Iniciando sesión Offline como: ${username}`);
        authObj = Authenticator.getAuth(username);
      }

      // 1.4. Copiar automáticamente los paquetes .zip.enc desde la carpeta del ejecutable si existen
      try {
        const isPackaged = process.resourcesPath && (process.resourcesPath.includes('app.asar') || process.resourcesPath.includes('app'));
        const exeDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
        const parentDir = path.dirname(exeDir);
        
        let localExePublic = path.join(exeDir, 'instance.zip.enc');
        if (!fs.existsSync(localExePublic)) {
          localExePublic = path.join(parentDir, 'instance.zip.enc');
        }
        
        let localExeAdmin = path.join(exeDir, 'instance-admin.zip.enc');
        if (!fs.existsSync(localExeAdmin)) {
          localExeAdmin = path.join(parentDir, 'instance-admin.zip.enc');
        }
        
        const gameFolderPublic = path.join(gameFolder, 'instance.zip.enc');
        const gameFolderAdmin = path.join(gameFolder, 'instance-admin.zip.enc');

        if (fs.existsSync(localExePublic)) {
          let shouldCopy = !fs.existsSync(gameFolderPublic);
          if (!shouldCopy) {
            const localStat = fs.statSync(localExePublic);
            const gameStat = fs.statSync(gameFolderPublic);
            // Copiar si el tamaño es diferente o si el archivo local es más nuevo por al menos 1 segundo
            shouldCopy = (localStat.size !== gameStat.size) || (localStat.mtimeMs > gameStat.mtimeMs + 1000);
          }
          if (shouldCopy) {
            onLog(`[Seguridad] Copiando nueva instancia pública desde la carpeta del launcher...`);
            fs.copyFileSync(localExePublic, gameFolderPublic);
            onLog(`[Seguridad] Instancia copiada con éxito.`);
            const oldHash = gameFolderPublic + '.hash';
            if (fs.existsSync(oldHash)) fs.unlinkSync(oldHash);
          }
        }

        if (fs.existsSync(localExeAdmin)) {
          if (isAdmin) {
            let shouldCopy = !fs.existsSync(gameFolderAdmin);
            if (!shouldCopy) {
              const localStat = fs.statSync(localExeAdmin);
              const gameStat = fs.statSync(gameFolderAdmin);
              // Copiar si el tamaño es diferente o si el archivo local es más nuevo por al menos 1 segundo
              shouldCopy = (localStat.size !== gameStat.size) || (localStat.mtimeMs > gameStat.mtimeMs + 1000);
            }
            if (shouldCopy) {
              onLog(`[Seguridad] Copiando nueva instancia de administrador desde la carpeta del launcher...`);
              fs.copyFileSync(localExeAdmin, gameFolderAdmin);
              onLog(`[Seguridad] Instancia de administrador copiada con éxito.`);
              const oldHash = gameFolderAdmin + '.hash';
              if (fs.existsSync(oldHash)) fs.unlinkSync(oldHash);
            }
          } else {
            onLog(`[Seguridad] Se detectó un paquete de administrador en la carpeta del launcher, pero tu usuario no tiene rango. Omitiendo copia.`);
          }
        }
      } catch (copyErr) {
        onLog(`[Aviso] No se pudo copiar la instancia desde la carpeta del ejecutable: ${copyErr.message}`);
      }

      // 1.5. Descomprimir paquetes de instancia (.zip / .mrpack / .zip.enc) si existen
      const zipFiles = isAdmin
        ? ['instance-admin.zip', 'instance-admin.zip.enc']
        : ['instance.zip', 'instance.zip.enc'];
      const { execSync } = require('child_process');
      const crypto = require('crypto');
      
      const ALGORITHM = 'aes-256-cbc';
      const SECRET_KEY = crypto.scryptSync('PedSafioSecureKey2026!', 'salt_pedsafio_instance', 32);
      const IV = Buffer.alloc(16, 9);

      const decryptFile = (src, dest) => {
        return new Promise((resResolve, resReject) => {
          try {
            const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, IV);
            const input = fs.createReadStream(src);
            const output = fs.createWriteStream(dest);

            decipher.on('error', (err) => {
              output.close();
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              resReject(new Error(`Error de descifrado (clave incorrecta o archivo dañado): ${err.message}`));
            });

            output.on('error', (err) => {
              output.close();
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              resReject(err);
            });

            input.on('error', resReject);

            input.pipe(decipher).pipe(output);
            
            output.on('finish', () => {
              resResolve();
            });
          } catch (e) {
            resReject(e);
          }
        });
      };

      const extractZip = (zipFilePath, destFolder) => {
        return new Promise((exResolve, exReject) => {
          // Reemplazar contrabarras (\) por barras diagonales (/) para evitar problemas de escape con tar en Windows
          const safeZip = zipFilePath.replace(/\\/g, '/');
          const safeDest = destFolder.replace(/\\/g, '/');
          
          const cmd = process.platform === 'win32'
            ? `tar -xf "${safeZip}" -C "${safeDest}"`
            : `unzip -o "${safeZip}" -d "${safeDest}"`;
          
          onLog(`[Seguridad] Ejecutando comando de extracción: ${cmd}`);
          const { exec } = require('child_process');
          exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) {
              onLog(`[Aviso] Falló tar.exe (${error.message}). Intentando fallback a .NET ZipFile...`);
              if (process.platform === 'win32') {
                // Fallback 1: Usar clase .NET ZipFile de PowerShell (muy rápida)
                const netCmd = `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${safeZip}', '${safeDest}', $true)"`;
                exec(netCmd, (netErr, netOut, netStderr) => {
                  if (netErr) {
                    onLog(`[Aviso] Falló .NET ZipFile (${netErr.message}). Intentando fallback a PowerShell Expand-Archive...`);
                    // Fallback 2: Usar Expand-Archive lento pero compatible
                    const psCmd = `powershell -Command "Expand-Archive -Path '${zipFilePath}' -DestinationPath '${destFolder}' -Force"`;
                    exec(psCmd, (psErr, psOut, psStderr) => {
                      if (psErr) {
                        exReject(new Error(psStderr || psErr.message));
                      } else {
                        exResolve();
                      }
                    });
                  } else {
                    exResolve();
                  }
                });
              } else {
                exReject(new Error(stderr || error.message));
              }
            } else {
              exResolve();
            }
          });
        });
      };

      const moveFolderContents = (src, dest) => {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }
        const files = fs.readdirSync(src);
        for (const file of files) {
          const srcPath = path.join(src, file);
          const destPath = path.join(dest, file);
          const stat = fs.statSync(srcPath);
          if (stat.isDirectory()) {
            moveFolderContents(srcPath, destPath);
          } else {
            if (fs.existsSync(destPath)) {
              try {
                fs.unlinkSync(destPath);
              } catch (e) {}
            }
            fs.renameSync(srcPath, destPath);
          }
        }
        try {
          fs.rmdirSync(src);
        } catch (e) {}
      };
      
      for (const zipName of zipFiles) {
        const zipPath = path.join(gameFolder, zipName);
        if (fs.existsSync(zipPath)) {
          let extractPath = zipPath;
          let isEncrypted = zipName.endsWith('.enc');
          const isAdminZip = zipName.includes('admin');

          // Si es un archivo de admin y el usuario no lo es, omitirlo por seguridad
          if (isAdminZip && !isAdmin) {
            onLog(`[Seguridad] Intento de acceso denegado: saltando extracción de paquete de administrador ${zipName}.`);
            continue;
          }

          try {
            // Asegurar que la carpeta mods exista
            fs.mkdirSync(path.join(gameFolder, 'mods'), { recursive: true });
            
            if (isEncrypted) {
              onLog(`[Seguridad] Descifrando paquete de instancia ${zipName}...`);
              extractPath = zipPath.slice(0, -4); // instance.zip
              await decryptFile(zipPath, extractPath);
              
              const sizeEnc = fs.statSync(zipPath).size;
              const sizeDec = fs.statSync(extractPath).size;
              onLog(`[Seguridad] Paquete descifrado. Cifrado: ${(sizeEnc/(1024*1024)).toFixed(2)} MB | Descifrado: ${(sizeDec/(1024*1024)).toFixed(2)} MB`);
            }

            onLog(`[Seguridad] Preparando instancia desde ${path.basename(extractPath)}...`);
            
            if (process.platform === 'win32') {
              // Ocultar el ZIP temporalmente
              try {
                execSync(`attrib +h +s "${extractPath}"`);
              } catch(e) {}
            }
            
            // Descomprimir de forma asíncrona para no congelar la interfaz
            await extractZip(extractPath, gameFolder);
            onLog(`[Seguridad] Instancia ${zipName} descomprimida y lista.`);

            // Si los archivos se extrajeron dentro de una subcarpeta "instance" o "instance-admin", moverlos a la raíz del juego
            const possibleSubDirs = [
              path.join(gameFolder, 'instance'),
              path.join(gameFolder, 'instance-admin')
            ];
            for (const subDir of possibleSubDirs) {
              if (fs.existsSync(subDir)) {
                onLog(`[Seguridad] Detectada subcarpeta "${path.basename(subDir)}". Moviendo archivos a la raíz de juego...`);
                try {
                  moveFolderContents(subDir, gameFolder);
                  onLog(`[Seguridad] Archivos de la instancia movidos con éxito.`);
                } catch (moveErr) {
                  onLog(`[Aviso] No se pudieron mover automáticamente los archivos de la subcarpeta: ${moveErr.message}`);
                }
              }
            }

            // Generar el recibo de firma del archivo cifrado (.hash) para evitar descifrados redundantes en el próximo inicio
            try {
              onLog(`[Seguridad] Generando recibo de verificación para ${zipName}...`);
              const fileHash = await new Promise((hashResolve) => {
                const hash = crypto.createHash('sha256');
                const stream = fs.createReadStream(zipPath);
                stream.on('data', (data) => hash.update(data));
                stream.on('end', () => {
                  stream.destroy(); // Liberar el archivo inmediatamente en Windows
                  hashResolve(hash.digest('hex'));
                });
                stream.on('error', () => {
                  stream.destroy();
                  hashResolve('');
                });
              });
              if (fileHash) {
                fs.writeFileSync(zipPath + '.hash', fileHash, 'utf8');
                onLog(`[Seguridad] Firma de verificación guardada con éxito.`);
              }
            } catch (hashErr) {
              onLog(`[Aviso] No se pudo escribir recibo de firma: ${hashErr.message}`);
            }

            // Eliminar el archivo ZIP temporal descifrado si existía
            if (isEncrypted && fs.existsSync(extractPath)) {
              try {
                fs.unlinkSync(extractPath);
              } catch (e) {}
            }

            // Eliminar el archivo de descarga original si NO es cifrado (.enc)
            if (!isEncrypted) {
              try {
                fs.unlinkSync(zipPath);
                onLog(`[Seguridad] Paquete original de descarga eliminado del disco.`);
              } catch (unlinkErr) {
                onLog(`[Aviso] No se pudo eliminar el archivo temporal: ${unlinkErr.message}`);
              }
            } else {
              onLog(`[Seguridad] Paquete cifrado original preservado para próximas ejecuciones.`);
            }
          } catch (err) {
            onLog(`[Error Seguridad] Fallo al procesar ${zipName}: ${err.message}`);
            reject(new Error(`Fallo de seguridad al preparar mods: ${err.message}`));
            return;
          }
        }
      }

      // 2. Format JVM arguments
      // Merge remote server optimizations and custom client configurations
      const customJvm = settings.jvmArgs ? settings.jvmArgs.trim() : '';
      const serverJvm = remoteConfig.jvmArgs ? remoteConfig.jvmArgs.trim() : '';
      const combinedJvmString = `${serverJvm} ${customJvm}`.trim();
      const jvmArray = combinedJvmString.split(/\s+/).filter(arg => arg.length > 0);

      // 3. Minecraft launcher parameters
      const opts = {
        authorization: authObj,
        root: gameFolder,
        version: {
          number: '1.20.1',
          type: 'release'
        },
        memory: {
          max: parseInt(settings.ram) || 4096,
          min: 1024
        },
        overrides: {
          detached: false, // Keep process piped to listen to logs
          jvmArgs: jvmArray,
          resolution: {
            width: parseInt(settings.resolutionWidth) || 1024,
            height: parseInt(settings.resolutionHeight) || 768,
            fullscreen: !!settings.fullscreen
          }
        }
      };

      // Always install/verify Minecraft Forge version 47.4.10
      onLog("Instalando/Verificando Minecraft Forge versión: 47.4.10");
      
      const forgeVersion = '47.4.10';
      const mcVersion = '1.20.1';
      const forgeInstallerName = `forge-${mcVersion}-${forgeVersion}-installer.jar`;
      const forgeInstallerPath = path.join(gameFolder, forgeInstallerName);
      
      const versionId = `${mcVersion}-forge-${forgeVersion}`;
      const versionPath = path.join(gameFolder, 'forge', versionId, 'version.json');
      
      if (!fs.existsSync(versionPath)) {
        if (!fs.existsSync(forgeInstallerPath)) {
          onStatus("Descargando instalador de Forge (aprox. 6MB)...");
          onLog("El archivo de configuración de Forge no se encuentra localmente. Descargando instalador oficial...");
          const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/${forgeInstallerName}`;
          try {
            await downloadFile(forgeUrl, forgeInstallerPath);
            onLog("Instalador de Forge descargado con éxito.");
          } catch (downloadErr) {
            onLog(`Error al descargar instalador de Forge: ${downloadErr.message}`);
            reject(new Error(`Fallo la descarga de Forge: ${downloadErr.message}`));
            return;
          }
        }
        opts.forge = forgeInstallerPath;
      } else {
        opts.forge = null; // Already installed, MCLC will boot using version.json
      }

      // Auto-connect to server if configured in remoteConfig
      if (remoteConfig.ip) {
        opts.overrides.gameArgs = [
          '--server', remoteConfig.ip,
          '--port', (remoteConfig.port || 25565).toString()
        ];
        onLog(`Configurando conexión automática al servidor: ${remoteConfig.ip}:${remoteConfig.port || 25565}`);
        
        // Escribir el archivo servers.dat para que aparezca en la lista de servidores multijugador
        writeServersDat(gameFolder, remoteConfig.ip + ":" + (remoteConfig.port || 25565));
      }

      // Add custom Java Path if configured, fallback to autodetecting official Java 17
      let javaPathToUse = settings.javaPath;
      if (!javaPathToUse || !fs.existsSync(javaPathToUse)) {
        onLog("Buscando runtime de Java compatible de forma automática...");
        
        const os = require('os');
        const userHome = os.homedir();
        const possiblePaths = [
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Minecraft Launcher\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\javaw.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Minecraft Launcher\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\javaw.exe'),
          path.join(userHome, 'AppData\\Local\\Packages\\Microsoft.4297127D64ECE_8wekyb3d8bbwe\\LocalCache\\Local\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\javaw.exe'),
          path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData\\Local'), 'Minecraft Launcher\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\javaw.exe'),
          
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Minecraft Launcher\\runtime\\java-runtime-beta\\windows-x64\\java-runtime-beta\\bin\\javaw.exe'),
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Minecraft Launcher\\runtime\\java-runtime-alpha\\windows-x64\\java-runtime-alpha\\bin\\javaw.exe'),
        ];

        let foundJava = null;
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            foundJava = p;
            break;
          }
        }

        if (foundJava) {
          onLog(`[Java] Se detectó y configuró Java 17 oficial: ${foundJava}`);
          opts.javaPath = foundJava;
        } else {
          onLog(`[Advertencia] No se detectó Java 17 de Minecraft Oficial. Se usará el Java del sistema.`);
          onLog(`[Advertencia] Si el juego no abre, por favor instala Java 17 o el launcher oficial de Minecraft.`);
        }
      } else {
        onLog(`Usando ejecutable de Java personalizado: ${javaPathToUse}`);
        opts.javaPath = javaPathToUse;
      }

      // 4. Hook Event Listeners
      launcher.on('debug', (e) => {
        onLog('[Debug] ' + e);
      });

      launcher.on('data', (e) => {
        // Stream game console outputs
        const cleanLine = e.toString().replace(/[\r\n]+/g, '');
        if (cleanLine) onLog(cleanLine);
      });

      launcher.on('download-status', (e) => {
        onStatus(`Descargando dependencias de Minecraft: ${e.type} (${e.task} / ${e.total})`);
      });

      launcher.on('progress', (e) => {
        // e contains: type, task, total, percent
        if (e.type === 'assets' || e.type === 'classes') {
          onStatus(`Descargando ${e.type}: ${Math.round(e.percent)}%`);
        }
      });

      // Spawns/spit trigger
      launcher.on('arguments', (args) => {
        onLog("Iniciando Java con argumentos:");
        onLog(args.join(' '));
        onLaunchComplete();
        resolve(); // Release caller, game is running
      });

      launcher.on('close', (code) => {
        onLog(`Proceso de Minecraft finalizado con código de salida: ${code}`);
        
        // Vaciado automático de mods al cerrar el juego para evitar copia o robo de archivos
        try {
          const modsDir = path.join(gameFolder, 'mods');
          if (fs.existsSync(modsDir)) {
            const files = fs.readdirSync(modsDir);
            for (const file of files) {
              const filePath = path.join(modsDir, file);
              if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
              }
            }
            onLog("[Seguridad] Carpeta de mods limpiada y vaciada para evitar copia/robo de archivos.");
          }
        } catch (err) {
          onLog("[Seguridad] Error al vaciar mods al cerrar: " + err.message);
        }

        onLaunchClosed();
      });

      // Ocultar la carpeta de mods en Windows como archivo protegido del sistema
      const modsDir = path.join(gameFolder, 'mods');
      if (fs.existsSync(modsDir) && process.platform === 'win32') {
        try {
          const { exec } = require('child_process');
          exec(`attrib +h +s "${modsDir}"`);
        } catch (e) {}
      }

      // Start launch
      launcher.launch(opts).catch(err => {
        onLog(`Error crítico al arrancar Minecraft: ${err.message}`);
        reject(err);
      });

    } catch (err) {
      reject(err);
    }
  });
}

function writeServersDat(gameFolder, ip, serverName = "Pedsafio Hardcore") {
  try {
    const serversDatPath = path.join(gameFolder, 'servers.dat');
    const ipBytes = Buffer.from(ip, 'utf8');
    const nameBytes = Buffer.from(serverName, 'utf8');
    
    const parts = [
      Buffer.from([10, 0, 0]), // TAG_Compound (root), length 0
      Buffer.from([9, 0, 7]),  // TAG_List, length 7
      Buffer.from("servers", 'utf8'),
      Buffer.from([10, 0, 0, 0, 1]), // list item type TAG_Compound, length 1
      
      // Server Item Compound
      Buffer.from([8, 0, 2]), // TAG_String, length 2
      Buffer.from("ip", 'utf8'),
      Buffer.from([ (ipBytes.length >> 8) & 0xff, ipBytes.length & 0xff ]), // string length
      ipBytes,
      
      Buffer.from([8, 0, 4]), // TAG_String, length 4
      Buffer.from("name", 'utf8'),
      Buffer.from([ (nameBytes.length >> 8) & 0xff, nameBytes.length & 0xff ]), // string length
      nameBytes,
      
      Buffer.from([0]), // TAG_End of compound
      Buffer.from([0])  // TAG_End of root compound
    ];
    
    const finalBuffer = Buffer.concat(parts);
    fs.writeFileSync(serversDatPath, finalBuffer);
  } catch (err) {
    console.error("Error al generar servers.dat:", err);
  }
}

module.exports = { runLaunchSequence };
