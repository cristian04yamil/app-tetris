'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// rect redondeado con fallback a arcos si no hay roundRect nativo
function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (context.roundRect) { context.roundRect(x, y, w, h, r); return; }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// patrón fijo 4×4 de la skin pixel: 1 = claro, -1 = oscuro, 0 = color base
const PIXEL_PATTERN = [
  [1, 1, 0, 0],
  [1, 0, 0, -1],
  [0, 0, 1, -1],
  [0, -1, -1, -1],
];

// cada skin: colors alineados a PIECES (índice 0 = null), grid opcional y drawBlock en píxeles
const SKINS = {
  retro: {
    label: 'Retro',
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#90caf9', '#ffb74d'],
    drawBlock(context, px, py, size, color) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      context.fillStyle = themeColors.highlight;
      context.fillRect(px + 1, py + 1, size - 2, 4);
    },
  },
  neon: {
    label: 'Neon',
    colors: [null, '#00f0ff', '#fff200', '#d400ff', '#39ff14', '#ff073a', '#2979ff', '#ff9100'],
    grid: '#10141c',
    drawBlock(context, px, py, size, color) {
      context.shadowColor = color;
      context.shadowBlur = size / 2;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 3, py + 3, size - 6, size - 6);
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      context.fillStyle = color;
      context.globalAlpha *= 0.3;
      context.fillRect(px + 5, py + 5, size - 10, size - 10);
    },
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fdf1a6', '#d7b8f3', '#b9e8c2', '#f7b5b5', '#b5cff7', '#fcd5a8'],
    drawBlock(context, px, py, size, color) {
      const r = size / 4;
      context.fillStyle = color;
      roundRectPath(context, px + 1.5, py + 1.5, size - 3, size - 3, r);
      context.fill();
      context.fillStyle = themeColors.highlight;
      roundRectPath(context, px + size / 5, py + size / 6, size * 0.45, size / 6, size / 12);
      context.fill();
    },
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#3cbcfc', '#f8b800', '#b53dff', '#58d854', '#f83800', '#0058f8', '#fc7460'],
    drawBlock(context, px, py, size, color) {
      const sub = (size - 2) / 4;
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          const v = PIXEL_PATTERN[r][c];
          if (!v) continue;
          context.fillStyle = v > 0 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
          // redondeo para que los sub-bloques queden nítidos
          context.fillRect(Math.round(px + 1 + c * sub), Math.round(py + 1 + r * sub), Math.ceil(sub), Math.ceil(sub));
        }
    },
  },
};

const DEFAULT_SKIN = 'retro';

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const ENERGY_MAX = 100;
const ENERGY_PER_LINE = 10;
const SLOW_DURATION = 10000; // ms de juego
const PEEK_COUNT = 5;
const PIECE_NAMES = [null, 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// run() devuelve true si se usó (consume energía), false si no está disponible, null si abre submenú
const ABILITIES = [
  { name: 'Ver siguientes 5 piezas', run: abilityPeek },
  { name: 'Cambiar pieza actual', run: abilitySwap },
  { name: 'Ralentizar 10s', run: abilitySlow },
  { name: 'Deshacer última colocación', run: abilityUndo, available: () => !!undoState },
];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const queueSection = document.getElementById('queue-section');
const queueCanvas = document.getElementById('queue-canvas');
const queueCtx = queueCanvas.getContext('2d');
const energyBar = document.getElementById('energy-bar');
const energyFill = document.getElementById('energy-fill');
const energyStatus = document.getElementById('energy-status');
const abilityList = document.getElementById('ability-list');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const themeLabel = document.getElementById('theme-label');
const skinSelect = document.getElementById('skin-select');

const THEME_KEY = 'tetris-theme';
let themeColors = { grid: '#22222e', highlight: 'rgba(255,255,255,0.12)' };
const SKIN_KEY = 'tetris-skin';
let skin = SKINS[DEFAULT_SKIN];

let board, current, next, queue, hold, holdUsed, energy, slowRemaining, peekCount, turnStart, undoState, menu, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function newPiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return newPiece(Math.floor(Math.random() * 7) + 1);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    energy = Math.min(ENERGY_MAX, energy + cleared * ENERGY_PER_LINE);
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  undoState = turnStart;
  merge();
  clearLines();
  holdUsed = false;
  spawn();
  drawHold();
}

function holdPiece() {
  if (holdUsed) return;
  // la pieza guardada vuelve a su orientación y posición de spawn
  const stored = newPiece(current.type);
  holdUsed = true;
  if (hold) {
    current = hold;
    hold = stored;
    if (collide(current.shape, current.x, current.y)) endGame();
  } else {
    hold = stored;
    spawn();
  }
  drawHold();
}

function spawn() {
  current = next;
  next = queue.length ? queue.shift() : randomPiece();
  if (peekCount > 0) peekCount--;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  turnStart = snapshot();
  drawNext();
  drawQueue();
}

// estado al aparecer la pieza (antes de sus puntos de drop); se vuelve undoState al fijarla.
// las piezas se mutan al jugarse, por eso se guardan solo sus tipos
function snapshot() {
  return {
    board: board.map(row => [...row]),
    type: current.type,
    nextType: next.type,
    queueTypes: queue.map(p => p.type),
    holdType: hold ? hold.type : 0,
    holdUsed, score, lines, level, dropInterval, peekCount,
  };
}

function abilityPeek() {
  while (queue.length < PEEK_COUNT - 1) queue.push(randomPiece());
  peekCount = PEEK_COUNT;
  drawQueue();
  return true;
}

function abilitySwap() {
  menu = 'swap';
  renderMenu();
  return null;
}

function swapTo(type) {
  const piece = newPiece(type);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collide(piece.shape, current.x + kick, current.y)) {
      piece.x = current.x + kick;
      piece.y = current.y;
      current = piece;
      return true;
    }
  }
  return false;
}

function abilitySlow() {
  slowRemaining = SLOW_DURATION;
  return true;
}

function abilityUndo() {
  if (!undoState) return false;
  const s = undoState;
  board = s.board.map(row => [...row]);
  current = newPiece(s.type);
  next = newPiece(s.nextType);
  queue = s.queueTypes.map(newPiece);
  hold = s.holdType ? newPiece(s.holdType) : null;
  ({ holdUsed, score, lines, level, dropInterval, peekCount } = s);
  undoState = null;
  turnStart = s;
  drawNext();
  drawHold();
  drawQueue();
  return true;
}

function renderMenu(hint = '') {
  abilityList.innerHTML = '';
  const items = menu === 'swap'
    ? PIECE_NAMES.slice(1).map(name => ({ name: `Pieza ${name}` }))
    : ABILITIES;
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<kbd>${i + 1}</kbd> ${item.name}`;
    if (item.available && !item.available()) li.classList.add('disabled');
    abilityList.appendChild(li);
  });
  overlayTitle.textContent = menu === 'swap' ? 'CAMBIAR PIEZA' : 'HABILIDAD';
  overlayScore.textContent = hint || (menu === 'swap' ? 'Esc: volver' : 'Esc: cancelar');
}

function openMenu() {
  if (energy < ENERGY_MAX) return;
  menu = 'main';
  cancelAnimationFrame(animId);
  renderMenu();
  abilityList.classList.remove('hidden');
  restartBtn.classList.add('hidden');
  overlay.classList.remove('hidden');
}

function closeMenu() {
  menu = null;
  overlay.classList.add('hidden');
  abilityList.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  updateHUD();
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function spendEnergy() {
  energy = 0;
  closeMenu();
}

function handleMenuKey(e) {
  if (e.code === 'Escape') {
    if (menu === 'swap') { menu = 'main'; renderMenu(); } else closeMenu();
    return;
  }
  const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (!m) return;
  const n = Number(m[2]);
  if (menu === 'swap') {
    if (n < 1 || n > 7) return;
    if (swapTo(n)) spendEnergy();
    else renderMenu('No cabe en esa posición');
    return;
  }
  if (n < 1 || n > ABILITIES.length) return;
  const used = ABILITIES[n - 1].run();
  if (used) spendEnergy();
  else if (used === false) renderMenu('No disponible');
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  energyFill.style.width = `${energy / ENERGY_MAX * 100}%`;
  energyBar.classList.toggle('full', energy >= ENERGY_MAX);
  updateEnergyStatus();
}

function updateEnergyStatus() {
  const parts = [];
  if (energy >= ENERGY_MAX) parts.push('E: activar');
  if (slowRemaining > 0) parts.push(`LENTO ${Math.ceil(slowRemaining / 1000)}s`);
  const text = parts.join(' · ');
  if (energyStatus.textContent !== text) energyStatus.textContent = text;
}

// delega en la skin activa; (x, y) en celdas de `size`
function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  skin.drawBlock(context, x * size, y * size, size, skin.colors[colorIndex], alpha ?? 1);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = skin.grid || themeColors.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// dibuja la pieza centrada en una grilla 4×4 de celdas `size`, con origen en (px, py)
function drawMini(context, piece, size, px, py) {
  const shape = piece.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  context.save();
  context.translate(px, py);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], size);
  context.restore();
}

function drawPreview(context, piece) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (piece) drawMini(context, piece, 30, 0, 0);
}

// piezas reveladas después de `next`
function drawQueue() {
  const QB = 15;
  const shown = peekCount > 1 ? queue.slice(0, peekCount - 1) : [];
  queueSection.classList.toggle('hidden', !shown.length);
  queueCtx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
  shown.forEach((piece, i) => drawMini(queueCtx, piece, QB, (queueCanvas.width - 4 * QB) / 2, i * 4 * QB));
}

function drawNext() {
  drawPreview(nextCtx, next);
}

function drawHold() {
  drawPreview(holdCtx, hold);
  holdCanvas.classList.toggle('locked', !!holdUsed);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (slowRemaining > 0) {
    slowRemaining = Math.max(0, slowRemaining - dt);
    updateEnergyStatus();
  }
  if (dropAccum >= (slowRemaining > 0 ? dropInterval * 2 : dropInterval)) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  hold = null;
  holdUsed = false;
  queue = [];
  energy = 0;
  slowRemaining = 0;
  peekCount = 0;
  undoState = null;
  menu = null;
  next = randomPiece();
  spawn();
  drawHold();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target === skinSelect) return; // teclas sobre el selector no mueven piezas
  if (menu) { handleMenuKey(e); return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      holdPiece();
      break;
    case 'KeyE':
      openMenu();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  themeColors = {
    grid: style.getPropertyValue('--grid').trim(),
    highlight: style.getPropertyValue('--block-highlight').trim(),
  };
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === 'light';
  themeToggle.setAttribute('aria-checked', String(isLight));
  themeToggle.setAttribute('aria-label', isLight ? 'Modo oscuro' : 'Modo claro');
  themeLabel.textContent = isLight ? 'Claro' : 'Oscuro';
  readThemeColors();
  redrawAll();
}

// redibuja todos los canvas, también en pausa o game over
function redrawAll() {
  if (current) draw();
  if (next) drawNext();
  drawHold();
  if (queue) drawQueue();
}

function applySkin(name) {
  if (!Object.hasOwn(SKINS, name)) name = DEFAULT_SKIN;
  skin = SKINS[name];
  document.documentElement.dataset.skin = name;
  skinSelect.value = name;
  redrawAll();
}

for (const [key, s] of Object.entries(SKINS)) skinSelect.add(new Option(s.label, key));

skinSelect.addEventListener('change', () => {
  try { localStorage.setItem(SKIN_KEY, skinSelect.value); } catch (_) {}
  applySkin(skinSelect.value);
  skinSelect.blur(); // flechas/Espacio vuelven al juego
});

themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  applyTheme(theme);
  themeToggle.blur(); // evita que Espacio/Enter reactive el switch durante la partida
});

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (_) {}
applyTheme(savedTheme);

let savedSkin = DEFAULT_SKIN;
try { savedSkin = localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN; } catch (_) {}
applySkin(savedSkin);

init();
