const fs = require('fs');
const { execSync } = require('child_process');
const https = require('https');

async function run() {
  try {
    // Eliminar carpeta .github local si existe para evitar error de scope en tokens sin workflow
    if (fs.existsSync('.github')) {
      fs.rmSync('.github', { recursive: true, force: true });
      console.log("✓ Eliminada carpeta .github local para evitar error de permisos.");
    }

    // 1. Read github-credentials.txt
    if (!fs.existsSync('github-credentials.txt')) {
      console.error("Error: No se encontró github-credentials.txt.");
      process.exit(1);
    }
    
    const content = fs.readFileSync('github-credentials.txt', 'utf8')
      .replace(/\r/g, '') // remove carriage returns
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
      
    const token = content[0];
    const repoUrl = content[1];
    
    if (!token || !repoUrl) {
      console.error("Error: El archivo github-credentials.txt está incompleto.");
      process.exit(1);
    }

    // 1.5. Descargar config.json y manifest.json remotos para preservar cambios hechos en Vercel
    console.log("=== PRESERVANDO CONFIGURACION Y MANIFIESTO DESDE GITHUB ===");
    try {
      let cleanUrl = repoUrl.replace('https://', '').replace('http://', '');
      const urlParts = cleanUrl.split('/');
      const user = urlParts[1];
      const repo = urlParts[2].replace('.git', '');

      const downloadRemoteFile = (repoPath, localPath) => {
        return new Promise((resolve) => {
          const url = `https://raw.githubusercontent.com/${user}/${repo}/main/${repoPath}?nocache=${Date.now()}`;
          https.get(url, (res) => {
            if (res.statusCode === 200) {
              let rawData = '';
              res.on('data', chunk => rawData += chunk);
              res.on('end', () => {
                try {
                  // Si estamos sobreescribiendo manifest.json, comparar marcas de tiempo
                  if (repoPath === 'backend/manifest.json' && fs.existsSync(localPath)) {
                    const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
                    const remoteData = JSON.parse(rawData);
                    if (localData.timestamp && remoteData.timestamp && localData.timestamp > remoteData.timestamp) {
                      console.log(`✓ Preservado local (más nuevo): ${repoPath}`);
                      return resolve(true);
                    }
                  }
                } catch (e) {}

                fs.writeFileSync(localPath, rawData, 'utf8');
                console.log(`✓ Preservado de GitHub: ${repoPath}`);
                resolve(true);
              });
            } else {
              resolve(false);
            }
          }).on('error', () => resolve(false));
        });
      };

      // await downloadRemoteFile('backend/config.json', 'backend/config.json');
      await downloadRemoteFile('backend/manifest.json', 'backend/manifest.json');
    } catch (err) {
      console.log("Aviso: No se pudieron descargar los archivos remotos, usando locales.");
    }
    
    console.log("\n=== CONFIGURANDO ENDPOINTS EN EL CODIGO ===");
    execSync(`node update-git-config.js "${repoUrl}"`, { stdio: 'inherit' });
    execSync(`node setup-workspace.js`, { stdio: 'inherit' });
    
    console.log("\n=== LIMPIANDO HISTORIAL DE GIT ANTERIOR ===");
    if (fs.existsSync('.git')) {
      try {
        execSync('rmdir /s /q .git', { stdio: 'ignore' });
      } catch (e) {
        // fallback delete using fs
        fs.rmSync('.git', { recursive: true, force: true });
      }
    }
    
    console.log("\n=== PREPARANDO REPOSITORIO LIMPIO ===");
    execSync('git init', { stdio: 'inherit' });
    execSync('git add .', { stdio: 'inherit' });
    execSync('git commit -m "Inicializar Suite de Launcher Pedsafio con hosting en GitHub"', { stdio: 'inherit' });
    execSync('git branch -M main', { stdio: 'inherit' });
    
    console.log("\n=== CONFIGURANDO ORIGEN AUTENTICADO ===");
    let cleanUrl = repoUrl.replace('https://', '').replace('http://', '');
    // Clean trailing slashes or .git
    if (cleanUrl.endsWith('.git')) cleanUrl = cleanUrl.slice(0, -4);
    
    execSync(`git remote add origin https://${token}@${cleanUrl}.git`, { stdio: 'inherit' });
    
    console.log("\n=== SUBIENDO ARCHIVOS A GITHUB ===");
    execSync('git push -u origin main --force', { stdio: 'inherit' });
    
    console.log("\n==========================================================");
    console.log("¡PROYECTO SUBIDO CON EXITO A GITHUB!");
    console.log("==========================================================");
    
  } catch (err) {
    console.error("\n⚠ Ocurrió un error al subir los archivos:", err.message);
    process.exit(1);
  }
}

run();
