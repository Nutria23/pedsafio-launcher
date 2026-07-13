const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const msmc = require('msmc');

let mainWindow;

// Settings path in User AppData
const SETTINGS_DIR = path.join(app.getPath('appData'), '.pedsafio-launcher');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

// Ensure directory exists
if (!fs.existsSync(SETTINGS_DIR)) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 620,
    minWidth: 1000,
    minHeight: 620,
    frame: false,             // Borderless window
    transparent: true,        // Transparent window
    resizable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false // Desactiva CORS para permitir que el launcher haga fetch a GitHub raw sin bloqueos
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  // mainWindow.webContents.openDevTools();

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Event Handlers

// 1. Custom Window Controls
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow.close();
});

// 2. Open Game Folder
ipcMain.on('open-game-folder', (event, gameDir) => {
  if (gameDir && fs.existsSync(gameDir)) {
    shell.openPath(gameDir);
  } else {
    // Default to appdata directory
    shell.openPath(SETTINGS_DIR);
  }
});

// 3. Local Settings Manager
ipcMain.handle('get-local-settings', () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading local settings:', err);
  }
  
  // Default client settings
  return {
    ram: 4096, // 4GB default
    javaPath: '',
    resolutionWidth: 1024,
    resolutionHeight: 768,
    fullscreen: false,
    jvmArgs: '',
    gameFolder: path.join(app.getPath('appData'), '.pedsafio-client'),
    username: '',
    authType: 'offline', // 'offline' or 'microsoft'
    msToken: null
  };
});

ipcMain.handle('save-local-settings', (event, settings) => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Error saving settings:', err);
    return { success: false, error: err.message };
  }
});

// 4. Microsoft Login Handler
ipcMain.handle('login-microsoft', async () => {
  try {
    const msmc = require('msmc');
    const mclc = msmc.getMCLC();
    
    // Launch the electron GUI login
    const result = await msmc.launch('electron', msmc.mojangAuthToken('select_account'));
    
    if (msmc.errorCheck(result)) {
      return { success: false, error: result.reason || 'Cancelado por el usuario o error de red.' };
    }
    
    // Convert to MCLC credentials format
    const mclcAuth = mclc.getAuth(result);
    
    return {
      success: true,
      profile: {
        name: mclcAuth.name,
        uuid: mclcAuth.uuid,
        access_token: mclcAuth.access_token,
        client_token: mclcAuth.client_token,
        user_properties: mclcAuth.user_properties,
        meta: mclcAuth.meta
      },
      rawToken: mclcAuth // Save the whole MCLC Auth object as token
    };
  } catch (err) {
    console.error('Microsoft login failed:', err);
    return { success: false, error: err.message || 'Error de autenticación con Microsoft.' };
  }
});

ipcMain.handle('login-microsoft-refresh', async (event, savedToken) => {
  try {
    const msmc = require('msmc');
    const mclc = msmc.getMCLC();
    
    // Check if token is already valid
    const isValid = await mclc.validate(savedToken);
    if (isValid) {
      return {
        success: true,
        profile: savedToken,
        rawToken: savedToken
      };
    }
    
    // If expired, refresh it using mclc.refresh
    const result = await mclc.refresh(savedToken);
    if (msmc.errorCheck(result)) {
      return { success: false, error: 'Sesión de Microsoft expirada o inválida.' };
    }
    
    const refreshedAuth = mclc.getAuth(result);
    return {
      success: true,
      profile: {
        name: refreshedAuth.name,
        uuid: refreshedAuth.uuid,
        access_token: refreshedAuth.access_token,
        client_token: refreshedAuth.client_token,
        user_properties: refreshedAuth.user_properties,
        meta: refreshedAuth.meta
      },
      rawToken: refreshedAuth
    };
  } catch (err) {
    console.error('Microsoft token refresh failed:', err);
    return { success: false, error: 'Token expirado o inválido.' };
  }
});

// Helper for varint encoding (Minecraft Ping)
function writeVarInt(value) {
  const buf = [];
  while (true) {
    if ((value & 0xFFFFFF80) === 0) {
      buf.push(value);
      return Buffer.from(buf);
    }
    buf.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
}

function readVarInt(buffer, offset = 0) {
  let result = 0;
  let numRead = 0;
  let offsetIndex = offset;
  while (true) {
    if (offsetIndex >= buffer.length) return { value: 0, bytes: 0 };
    const read = buffer.readUInt8(offsetIndex++);
    const value = read & 0x7F;
    result |= value << (7 * numRead);
    numRead++;
    if (numRead > 5) {
      throw new Error('VarInt is too big');
    }
    if ((read & 0x80) !== 128) {
      break;
    }
  }
  return { value: result, bytes: numRead };
}

// 5. Direct TCP Minecraft Server Status Ping IPC Handler
const net = require('net');
ipcMain.handle('ping-minecraft-server', async (event, host, port) => {
  return new Promise((resolve) => {
    const targetHost = host || 'localhost';
    const targetPort = parseInt(port) || 25565;

    const client = new net.Socket();
    let finished = false;

    const respond = (data) => {
      if (finished) return;
      finished = true;
      client.destroy();
      resolve(data);
    };

    client.setTimeout(2500);

    client.connect(targetPort, targetHost, () => {
      try {
        const hostBytes = Buffer.from(targetHost, 'utf8');
        const handshakePacket = Buffer.concat([
          Buffer.from([0x00]), // Packet ID
          writeVarInt(763),    // Protocol version (1.20.1 = 763)
          writeVarInt(hostBytes.length),
          hostBytes,
          Buffer.from([
            (targetPort >> 8) & 0xFF,
            targetPort & 0xFF
          ]),
          writeVarInt(1) // Next state: 1 (status)
        ]);
        const handshakeLength = writeVarInt(handshakePacket.length);
        client.write(Buffer.concat([handshakeLength, handshakePacket]));

        const requestPacket = Buffer.from([0x00]); // Packet ID 0x00
        const requestLength = writeVarInt(requestPacket.length);
        client.write(Buffer.concat([requestLength, requestPacket]));
      } catch (err) {
        respond({ online: false, error: err.message });
      }
    });

    let responseData = Buffer.alloc(0);

    client.on('data', (chunk) => {
      responseData = Buffer.concat([responseData, chunk]);
      
      try {
        if (responseData.length < 2) return;
        const totalLen = readVarInt(responseData, 0);
        if (responseData.length < totalLen.bytes + totalLen.value) return;

        const packetIdOffset = totalLen.bytes;
        const packetId = readVarInt(responseData, packetIdOffset);
        
        const jsonLenOffset = packetIdOffset + packetId.bytes;
        const jsonLen = readVarInt(responseData, jsonLenOffset);
        
        const jsonStringOffset = jsonLenOffset + jsonLen.bytes;
        const jsonString = responseData.toString('utf8', jsonStringOffset, jsonStringOffset + jsonLen.value);
        
        const pingData = JSON.parse(jsonString);
        respond({
          online: true,
          motd: pingData.description ? (typeof pingData.description === 'string' ? pingData.description : (pingData.description.text || '')) : '',
          players: {
            online: pingData.players ? pingData.players.online : 0,
            max: pingData.players ? pingData.players.max : 0
          },
          version: pingData.version ? pingData.version.name : '',
          latency: 35
        });
      } catch (err) {
        // Wait for more data
      }
    });

    client.on('error', (err) => {
      respond({ online: false, error: err.message });
    });

    client.on('timeout', () => {
      respond({ online: false, error: 'Connection timeout' });
    });
  });
});
