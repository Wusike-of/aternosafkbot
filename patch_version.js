// ============================================================
//  Patch automático — Adiciona suporte à versão 26.2 do MC
//  Roda como postinstall no npm install
// ============================================================

const fs = require('fs');
const path = require('path');

const MC_DATA_ROOT = path.join(__dirname, 'node_modules', 'minecraft-data');
const PC_DATA = path.join(MC_DATA_ROOT, 'minecraft-data', 'data', 'pc');
const DATA_JS = path.join(MC_DATA_ROOT, 'data.js');
const VERSIONS_JSON = path.join(MC_DATA_ROOT, 'minecraft-data', 'data', 'pc', 'common', 'versions.json');
const LOADER_JS = path.join(__dirname, 'node_modules', 'mineflayer', 'lib', 'loader.js');

const SRC_VERSION = '26.1';
const DST_VERSION = '26.2';

function log(msg) {
  console.log(`[patch] ${msg}`);
}

// 1. Copiar dados da 26.1 pra 26.2
function copyVersionData() {
  const src = path.join(PC_DATA, SRC_VERSION);
  const dst = path.join(PC_DATA, DST_VERSION);

  if (fs.existsSync(dst)) {
    log(`${DST_VERSION} data já existe, pulando cópia`);
    return;
  }

  if (!fs.existsSync(src)) {
    log(`ERRO: dados da ${SRC_VERSION} não encontrados em ${src}`);
    process.exit(1);
  }

  fs.cpSync(src, dst, { recursive: true });

  // Atualizar version.json
  const versionFile = path.join(dst, 'version.json');
  const version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  version.minecraftVersion = DST_VERSION;
  version.version = (version.version || 0) + 1;
  fs.writeFileSync(versionFile, JSON.stringify(version, null, 2));

  log(`Copiou dados ${SRC_VERSION} → ${DST_VERSION}`);
}

// 2. Adicionar 26.2 ao data.js
function patchDataJs() {
  let content = fs.readFileSync(DATA_JS, 'utf8');

  if (content.includes(`'${DST_VERSION}':`)) {
    log('data.js já tem 26.2, pulando');
    return;
  }

  // Encontrar o bloco da 26.1 e duplicar pra 26.2
  const srcPattern = `'${SRC_VERSION}':`;
  const srcIndex = content.indexOf(srcPattern);

  if (srcIndex === -1) {
    log('ERRO: não encontrou bloco 26.1 no data.js');
    process.exit(1);
  }

  // Encontrar o fim do bloco 26.1 (procura "    }," ou "    }\n  },")
  let braceCount = 0;
  let blockEnd = -1;
  for (let i = content.indexOf('{', srcIndex); i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') braceCount--;
    if (braceCount === 0) {
      blockEnd = i + 1;
      break;
    }
  }

  if (blockEnd === -1) {
    log('ERRO: não encontrou fim do bloco 26.1');
    process.exit(1);
  }

  // Extrair bloco 26.1 e criar 26.2
  const srcBlock = content.substring(srcIndex, blockEnd);
  const dstBlock = srcBlock.replace(new RegExp(SRC_VERSION.replace('.', '\\.'), 'g'), DST_VERSION);

  // Inserir após o bloco 26.1
  const insertPoint = blockEnd;
  const newContent = content.substring(0, insertPoint) + ',\n    ' + dstBlock + content.substring(insertPoint);
  fs.writeFileSync(DATA_JS, newContent);

  log('Adicionou 26.2 ao data.js');
}

// 3. Adicionar 26.2 ao versions.json
function patchVersionsJson() {
  const versions = JSON.parse(fs.readFileSync(VERSIONS_JSON, 'utf8'));

  if (versions.includes(DST_VERSION)) {
    log('versions.json já tem 26.2, pulando');
    return;
  }

  versions.push(DST_VERSION);
  fs.writeFileSync(VERSIONS_JSON, JSON.stringify(versions, null, 2));

  log('Adicionou 26.2 ao versions.json');
}

// 4. Desabilitar version check do mineflayer
function patchMineflayer() {
  let content = fs.readFileSync(LOADER_JS, 'utf8');

  if (content.includes('// PATCHED')) {
    log('mineflayer loader.js já patcheado, pulando');
    return;
  }

  // Comentar o bloco de verificação de versão
  content = content.replace(
    /if \(versionData\['>'\]\(latestSupportedVersion\)[\s\S]*?throw new Error\(`Server version '\$\{serverPingVersion\}' is not supported\. Oldest supported version is '\$\{oldestSupportedVersion\}'\.`\)\s*\}/,
    `// PATCHED: skip version bounds check for custom version support
    // Version bounds check removed to allow 26.2 support`
  );

  fs.writeFileSync(LOADER_JS, content);
  log('Patcheou mineflayer loader.js');
}

// ── Executar ────────────────────────────────────────────────
log('Iniciando patch para MC ' + DST_VERSION + '...');
copyVersionData();
patchDataJs();
patchVersionsJson();
patchMineflayer();
log('Patch concluído com sucesso! ✅');
