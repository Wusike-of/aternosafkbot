// ============================================================
//  Aternos AFK Bot — mineflayer (Node.js)
//  Versão com HTTP server para deploy no Render/Railway
// ============================================================

require('dotenv').config();

const mineflayer = require('mineflayer');
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

  // Porta HTTP pro UptimeRobot pingar
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

// ── HTTP Server (para UptimeRobot / Render health check) ────
const app = express();

app.get('/', (req, res) => {
  res.json({
    status: botStatus,
    server: `${CONFIG.host}:${CONFIG.port}`,
    bot: CONFIG.username,
    uptime: uptime(),
    lastAction: lastAction,
    reconnects: totalReconnects,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(CONFIG.httpPort, () => {
  log('🌐', `HTTP server rodando na porta ${CONFIG.httpPort}`);
  log('🌐', `Health check: http://localhost:${CONFIG.httpPort}/health`);
});

// ── Anti-AFK Actions ────────────────────────────────────────
function doAntiAfk() {
  if (!bot || !bot.entity) return;

  const actions = [
    () => {
      try {
        bot.setControlState('jump', true);
        setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 400);
        lastAction = '🦘 Pulou';
        log('🦘', 'Pulou');
      } catch (e) { log('⚠️', `Erro no pulo: ${e.message}`); }
    },
    () => {
      try {
        bot.swingArm();
        lastAction = '🤚 Balançou o braço';
        log('🤚', 'Balançou o braço');
      } catch (e) { log('⚠️', `Erro no braço: ${e.message}`); }
    },
    () => {
      try {
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI;
        bot.look(yaw, pitch);
        lastAction = '👀 Olhou ao redor';
        log('👀', `Olhou yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)}`);
      } catch (e) { log('⚠️', `Erro ao olhar: ${e.message}`); }
    },
    () => {
      try {
        bot.setControlState('sneak', true);
        setTimeout(() => { if (bot) bot.setControlState('sneak', false); }, 600);
        lastAction = '🧎 Agachou';
        log('🧎', 'Agachou');
      } catch (e) { log('⚠️', `Erro no sneak: ${e.message}`); }
    },
  ];

  const action = actions[Math.floor(Math.random() * actions.length)];
  action();
}

// ── Criar e conectar o bot ──────────────────────────────────
function createBot() {
  if (isReconnecting) return;
  isReconnecting = true;
  botStatus = 'connecting';

  log('🔌', `Conectando a ${CONFIG.host}:${CONFIG.port} como "${CONFIG.username}"...`);

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
    isReconnecting = false;
    botStatus = 'error';
    scheduleReconnect();
    return;
  }

  isReconnecting = false;

  bot.on('spawn', () => {
    reconnectAttempt = 0;
    botStatus = 'online';
    connectedSince = Date.now();

    const playerCount = bot.players ? Object.keys(bot.players).length : '?';
    log('✅', `Bot conectado! Jogadores online: ${playerCount}`);
    log('🔄', `Anti-AFK a cada ${CONFIG.afkInterval / 1000}s`);

    if (afkTimer) clearInterval(afkTimer);
    afkTimer = setInterval(doAntiAfk, CONFIG.afkInterval);
  });

  bot.on('chat', (username, message) => {
    if (!username || username === bot.username) return;
    log('💬', `<${username}> ${message}`);
  });

  bot.on('kicked', (reason) => {
    let reasonStr;
    try {
      reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    } catch (e) {
      reasonStr = 'desconhecido';
    }
    log('🚫', `Kickado: ${reasonStr}`);
  });

  bot.on('error', (err) => {
    log('❌', `Erro: ${err.message}`);
  });

  bot.on('end', (reason) => {
    log('🔴', `Desconectado: ${reason || 'motivo desconhecido'}`);
    botStatus = 'disconnected';
    connectedSince = null;
    cleanup();
    scheduleReconnect();
  });

  bot.on('health', () => {
    if (!bot) return;
    if (bot.health <= 0) {
      log('💀', 'Bot morreu! Auto-respawn...');
      try {
        if (typeof bot.respawn === 'function') {
          bot.respawn();
        } else {
          bot._client.write('client_command', { actionId: 0 });
        }
      } catch (e) {
        log('⚠️', `Erro no respawn: ${e.message}`);
      }
    }
  });

  bot.on('playerJoined', (player) => {
    if (player && player.username && player.username !== bot.username) {
      log('📥', `${player.username} entrou`);
    }
  });

  bot.on('playerLeft', (player) => {
    if (player && player.username && player.username !== bot.username) {
      log('📤', `${player.username} saiu`);
    }
  });
}

// ── Cleanup ─────────────────────────────────────────────────
function cleanup() {
  if (afkTimer) { clearInterval(afkTimer); afkTimer = null; }
  bot = null;
}

// ── Reconexão ───────────────────────────────────────────────
function scheduleReconnect() {
  if (isReconnecting) return;
  botStatus = 'reconnecting';
  totalReconnects++;
  reconnectAttempt++;

  const delay = Math.min(
    CONFIG.reconnectBase * Math.pow(2, reconnectAttempt - 1),
    CONFIG.reconnectMax
  );
  log('⏳', `Reconectando em ${delay / 1000}s (tentativa #${reconnectAttempt})...`);
  setTimeout(() => createBot(), delay);
}

// ── Error handlers globais ──────────────────────────────────
process.on('uncaughtException', (err) => {
  log('💥', `Erro não tratado: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  log('💥', `Promise rejeitada: ${reason}`);
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
console.log('╚══════════════════════════════════════════════╝');
console.log('');

createBot();
