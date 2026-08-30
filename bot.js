// ============================================================
//  Aternos AFK Bot — mineflayer (Node.js)
//  Versão com HTTP server para deploy no Render
// ============================================================

require('dotenv').config();

const mineflayer = require('mineflayer');
const mcping = require('minecraft-protocol').ping;
const express = require('express');

// ── Configuração ────────────────────────────────────────────
const CONFIG = {
  host:     process.env.SERVER_HOST     || 'seuservidor.aternos.me',
  port:     parseInt(process.env.SERVER_PORT) || 25565,
  username: process.env.BOT_USERNAME    || 'AFK_Bot',
  version:  process.env.MC_VERSION      || false,
  auth:     'offline',

  afkInterval:   parseInt(process.env.AFK_INTERVAL)   || 30_000,
  reconnectBase: parseInt(process.env.RECONNECT_BASE) || 5_000,
  reconnectMax:  parseInt(process.env.RECONNECT_MAX)  || 60_000,

  httpPort: parseInt(process.env.PORT) || 3000,
};

// ── Estado global ───────────────────────────────────────────
let bot = null;
let afkTimer = null;
let reconnectAttempt = 0;
let isReconnecting = false;
let botStatus = 'starting';
let lastAction = 'nenhuma';
let connectedSince = null;
let totalReconnects = 0;
let lastError = '';
let spawnCount = 0;

// ── Helpers ─────────────────────────────────────────────────
function timestamp() {
  return new Date().toLocaleTimeString('pt-BR');
}

function log(icon, msg) {
  console.log(`[${timestamp()}] ${icon}  ${msg}`);
}

function uptime() {
  if (!connectedSince) return 'N/A';
  const diff = Date.now() - connectedSince;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

// ── HTTP Server ─────────────────────────────────────────────
const app = express();

app.get('/', (req, res) => {
  const info = {
    status: botStatus,
    server: `${CONFIG.host}:${CONFIG.port}`,
    bot: CONFIG.username,
    uptime: uptime(),
    lastAction,
    lastError,
    reconnects: totalReconnects,
    spawnCount,
    position: bot && bot.entity ? {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z),
    } : null,
    health: bot ? bot.health : null,
    food: bot ? bot.food : null,
    players: bot && bot.players ? Object.keys(bot.players) : [],
    timestamp: new Date().toISOString(),
  };
  res.json(info);
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(CONFIG.httpPort, () => {
  log('🌐', `HTTP server na porta ${CONFIG.httpPort}`);
});

// ── Anti-AFK Actions ────────────────────────────────────────
function doAntiAfk() {
  if (!bot || !bot.entity) {
    log('⚠️', `Anti-AFK pulado: bot=${!!bot} entity=${bot ? !!bot.entity : 'N/A'}`);
    return;
  }

  const actions = [
    () => {
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 400);
      lastAction = '🦘 Pulou';
      log('🦘', `Pulou (pos: ${bot.entity.position.x.toFixed(0)}, ${bot.entity.position.y.toFixed(0)}, ${bot.entity.position.z.toFixed(0)})`);
    },
    () => {
      bot.swingArm();
      lastAction = '🤚 Braço';
      log('🤚', 'Balançou o braço');
    },
    () => {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI;
      bot.look(yaw, pitch);
      lastAction = '👀 Olhou';
      log('👀', 'Olhou ao redor');
    },
    () => {
      bot.setControlState('sneak', true);
      setTimeout(() => { if (bot) bot.setControlState('sneak', false); }, 600);
      lastAction = '🧎 Agachou';
      log('🧎', 'Agachou');
    },
  ];

  try {
    const action = actions[Math.floor(Math.random() * actions.length)];
    action();
  } catch (e) {
    log('⚠️', `Erro anti-AFK: ${e.message}`);
    lastError = e.message;
  }
}

// ── Criar e conectar o bot ──────────────────────────────────
function createBot() {
  if (isReconnecting) return;
  isReconnecting = true;
  botStatus = 'connecting';

  log('🔌', `Conectando a ${CONFIG.host}:${CONFIG.port} como "${CONFIG.username}" (versão: ${CONFIG.version || 'auto'})...`);

  try {
    bot = mineflayer.createBot({
      host:     CONFIG.host,
      port:     CONFIG.port,
      username: CONFIG.username,
      version:  CONFIG.version || undefined,
      auth:     CONFIG.auth,
      hideErrors: false,
    });
  } catch (e) {
    log('❌', `Erro ao criar bot: ${e.message}`);
    lastError = e.message;
    isReconnecting = false;
    botStatus = 'error';
    scheduleReconnect();
    return;
  }

  isReconnecting = false;

  // ── Login (antes do spawn) ────────────────────────
  bot.on('login', () => {
    log('🔑', `Login OK! Entity ID: ${bot.entity ? bot.entity.id : 'N/A'}`);
  });

  // ── Spawn ─────────────────────────────────────────
  bot.on('spawn', () => {
    reconnectAttempt = 0;
    botStatus = 'online';
    connectedSince = Date.now();
    spawnCount++;

    const playerList = bot.players ? Object.keys(bot.players) : [];
    const pos = bot.entity ? bot.entity.position : null;

    log('✅', `SPAWN #${spawnCount}! Jogadores: [${playerList.join(', ')}]`);
    if (pos) {
      log('📍', `Posição: x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)} z=${pos.z.toFixed(1)}`);
    }
    log('❤️', `Vida: ${bot.health} | Fome: ${bot.food}`);

    if (afkTimer) clearInterval(afkTimer);
    afkTimer = setInterval(doAntiAfk, CONFIG.afkInterval);
  });

  // ── Chat ──────────────────────────────────────────
  bot.on('chat', (username, message) => {
    if (!username || username === bot.username) return;
    log('💬', `<${username}> ${message}`);
  });

  // ── Kicked ────────────────────────────────────────
  bot.on('kicked', (reason) => {
    let reasonStr;
    try {
      reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    } catch (e) {
      reasonStr = 'desconhecido';
    }
    log('🚫', `KICKED: ${reasonStr}`);
    lastError = `kicked: ${reasonStr}`;
  });

  // ── Erro ──────────────────────────────────────────
  bot.on('error', (err) => {
    log('❌', `ERRO: ${err.message}`);
    lastError = err.message;
  });

  // ── Desconexão ────────────────────────────────────
  bot.on('end', (reason) => {
    log('🔴', `DESCONECTADO: ${reason || 'motivo desconhecido'}`);
    lastError = `disconnected: ${reason}`;
    botStatus = 'disconnected';
    connectedSince = null;
    cleanup();
    scheduleReconnect();
  });

  // ── Health ────────────────────────────────────────
  bot.on('health', () => {
    if (!bot) return;
    log('❤️', `Vida: ${bot.health} | Fome: ${bot.food}`);
    if (bot.health <= 0) {
      log('💀', 'MORREU! Fazendo respawn...');
      try {
        if (typeof bot.respawn === 'function') {
          bot.respawn();
        } else {
          bot._client.write('client_command', { actionId: 0 });
        }
      } catch (e) {
        log('⚠️', `Erro respawn: ${e.message}`);
        lastError = `respawn failed: ${e.message}`;
      }
    }
  });

  // ── Player events ─────────────────────────────────
  bot.on('playerJoined', (player) => {
    if (player && player.username) {
      log('📥', `JOINED: ${player.username}`);
    }
  });

  bot.on('playerLeft', (player) => {
    if (player && player.username) {
      log('📤', `LEFT: ${player.username}`);
    }
  });

  // ── Debug: raw packets ────────────────────────────
  bot._client.on('packet', (data, meta) => {
    // Loga apenas pacotes importantes
    if (['kick_disconnect', 'disconnect'].includes(meta.name)) {
      log('📦', `PACKET ${meta.name}: ${JSON.stringify(data).substring(0, 200)}`);
    }
  });
}

// ── Cleanup ─────────────────────────────────────────────────
function cleanup() {
  if (afkTimer) { clearInterval(afkTimer); afkTimer = null; }
  bot = null;
}

// ── Reconexão INTELIGENTE ────────────────────────────────────
// Pinga o servidor antes de tentar conectar.
// Se offline, espera 5 min entre pings (leve, não bloqueia IP).
// Só tenta login completo quando o ping confirma que tá online.

const PING_INTERVAL = 5 * 60 * 1000; // 5 min entre pings quando offline
const RECONNECT_QUICK = 10_000;       // 10s pra reconectar quando ping OK

async function pingServer() {
  return new Promise((resolve) => {
    mcping({
      host: CONFIG.host,
      port: CONFIG.port,
    }, (err, result) => {
      if (err) {
        resolve(null);
      } else {
        resolve(result);
      }
    });
  });
}

async function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  botStatus = 'reconnecting';
  totalReconnects++;
  reconnectAttempt++;

  // Primeiras 3 tentativas: reconexão rápida (pode ter sido lag)
  if (reconnectAttempt <= 3) {
    const delay = CONFIG.reconnectBase * reconnectAttempt;
    log('⏳', `Reconexão rápida em ${delay / 1000}s (tentativa #${reconnectAttempt})...`);
    await new Promise(r => setTimeout(r, delay));
    isReconnecting = false;
    createBot();
    return;
  }

  // Depois: pinga antes de tentar conectar
  log('🔍', `Pingando servidor antes de reconectar (tentativa #${reconnectAttempt})...`);
  botStatus = 'waiting_server';

  const pingResult = await pingServer();

  if (pingResult) {
    // Servidor tá online! Reconecta
    log('✅', `Servidor online! ${pingResult.players?.online || '?'} jogadores. Conectando em ${RECONNECT_QUICK / 1000}s...`);
    await new Promise(r => setTimeout(r, RECONNECT_QUICK));
    isReconnecting = false;
    reconnectAttempt = 0;  // reseta porque o servidor tá de volta
    createBot();
  } else {
    // Servidor offline — espera 5 min e tenta pingar de novo
    log('💤', `Servidor offline. Próximo ping em ${PING_INTERVAL / 60000} minutos...`);
    botStatus = 'server_offline';
    await new Promise(r => setTimeout(r, PING_INTERVAL));
    isReconnecting = false;
    scheduleReconnect();
  }
}

// ── Error handlers globais ──────────────────────────────────
process.on('uncaughtException', (err) => {
  log('💥', `UNCAUGHT: ${err.message}`);
  log('💥', err.stack);
  lastError = `uncaught: ${err.message}`;
});

process.on('unhandledRejection', (reason) => {
  log('💥', `UNHANDLED: ${reason}`);
  lastError = `unhandled: ${reason}`;
});

process.on('SIGINT', () => {
  log('👋', 'Desligando...');
  if (bot) try { bot.end(); } catch (e) {}
  setTimeout(() => process.exit(0), 1000);
});

// ── Start ───────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       🤖 Aternos AFK Bot — mineflayer       ║');
console.log('╠══════════════════════════════════════════════╣');
console.log(`║  Servidor: ${(CONFIG.host + ':' + CONFIG.port).padEnd(33)}║`);
console.log(`║  Username: ${CONFIG.username.padEnd(33)}║`);
console.log(`║  Anti-AFK: a cada ${(CONFIG.afkInterval / 1000 + 's').padEnd(26)}║`);
console.log(`║  HTTP:     porta ${(CONFIG.httpPort + '').padEnd(27)}║`);
console.log(`║  Versão:   ${(CONFIG.version || 'auto').toString().padEnd(33)}║`);
console.log('╚══════════════════════════════════════════════╝');
console.log('');

createBot();
