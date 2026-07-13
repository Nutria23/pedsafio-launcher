const fs = require('fs');
const path = require('path');

const repoUrl = process.argv[2];
if (!repoUrl) {
  console.error("Error: URL de repositorio no especificada.");
  process.exit(1);
}

// Extract username and repository name from github URL
// matches e.g. https://github.com/user/repo or git@github.com:user/repo.git
const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
if (!match) {
  console.error("Error: URL de GitHub no valida. Debe ser del tipo: https://github.com/Usuario/Repositorio");
  process.exit(1);
}

const username = match[1];
const repo = match[2];

console.log(`Configurando endpoints para el usuario: ${username}, repositorio: ${repo}`);

// 1. Update launcher/src/launcher-config.json
const launcherConfigPath = path.join(__dirname, 'launcher', 'src', 'launcher-config.json');
if (fs.existsSync(launcherConfigPath)) {
  const launcherConfig = JSON.parse(fs.readFileSync(launcherConfigPath, 'utf8'));
  // Set main source of config to GitHub raw file
  launcherConfig.remoteUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/backend/config.json`;
  fs.writeFileSync(launcherConfigPath, JSON.stringify(launcherConfig, null, 2), 'utf8');
  console.log("✓ Enlace de configuracion remota vinculado a launcher-config.json");
}

// 2. Update backend/config.json
const backendConfigPath = path.join(__dirname, 'backend', 'config.json');
if (fs.existsSync(backendConfigPath)) {
  const backendConfig = JSON.parse(fs.readFileSync(backendConfigPath, 'utf8'));
  // Set default download assets to GitHub raw resources
  backendConfig.background = `https://raw.githubusercontent.com/${username}/${repo}/main/launcher/resources/background.jpg`;
  backendConfig.logo = `https://raw.githubusercontent.com/${username}/${repo}/main/launcher/resources/logo.png`;
  backendConfig.downloadServer = `https://raw.githubusercontent.com/${username}/${repo}/main/backend/public`;
  fs.writeFileSync(backendConfigPath, JSON.stringify(backendConfig, null, 2), 'utf8');
  console.log("✓ Direccion del Servidor de Descargas vinculado a backend/config.json");
}

console.log("Integracion con GitHub configurada con exito.");
