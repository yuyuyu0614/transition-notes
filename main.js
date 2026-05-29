const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, globalShortcut } = require('electron');

if (app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '0');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Auto-updater (only active in packaged builds)
// const { autoUpdater } = require('electron-updater');
// autoUpdater.logger = log;
// autoUpdater.autoDownload = false;
// autoUpdater.on('update-available', () => { ... });
// autoUpdater.on('update-downloaded', () => { ... });
// autoUpdater.on('error', (err) => { ... });
const autoUpdater = { checkForUpdates: () => {}, on: () => {} };

let mainWindow = null;
let settingsWindow = null;
let timelineWindow = null;
let privacyWindow = null;
let aboutWindow = null;
let tray = null;
let SQL = null;
let db = null;
let dbPath = '';
const popupWindows = new Map();
let mainNormalBounds = null;
let _restoring = false; // 保存主窗口正常尺寸，用于最大化还原
let mainWindowMaximized = false;

const popupSizes = [
  { width: 280, height: 200 },
  { width: 560, height: 400 },
  { width: 840, height: 600 }
];

// 应用状态
let appSettings = {
  theme: 'light',
  language: 'zh-CN',
  privacyLevel: 'none',
  mainPassword: '',
  soundEnabled: true,
  autoLaunch: false,
  fontFamily: 'Segoe UI Variable',
  privacyShown: false,
  lightColor: "#0FBAB2",
  darkColor: "#8CB89A"
};

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 保存数据库到文件
async function saveDatabase() {
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
      try { log.info('Database saved'); } catch (e) { /* ignore */ }
    } catch (e) {
      try { log.error('Failed to save database:', e); } catch (e2) { /* ignore */ }
    }
  }
}

// 初始化 sql.js 数据库
async function initDatabase() {
  const initSqlJs = require('sql.js');
  
  // 获取 wasm 文件路径
  let wasmPath;
  if (app.isPackaged) {
    wasmPath = path.join(process.resourcesPath, 'sql-wasm.wasm');
  } else {
    wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  }
  
  SQL = await initSqlJs({
    locateFile: () => wasmPath
  });
  
  dbPath = path.join(app.getPath('userData'), 'transition.db');
  
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      log.info('Database loaded from file');
    } else {
      db = new SQL.Database();
      log.info('New database created');
    }
  } catch (e) {
    log.error('Failed to load database, creating new:', e.message);
    log.error('Stack:', e.stack);
    db = new SQL.Database();
    log.info('New database created (fallback)');
  }
  
  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      color TEXT DEFAULT '#8CB89A',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      reminded_at TEXT,
      repeat_reminder TEXT DEFAULT 'none',
      font_family TEXT DEFAULT 'Segoe UI Variable',
      is_popup INTEGER DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS window_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id TEXT UNIQUE,
      note_id INTEGER,
      x INTEGER DEFAULT 100,
      y INTEGER DEFAULT 100,
      width INTEGER DEFAULT 280,
      height INTEGER DEFAULT 200,
      size_level INTEGER DEFAULT 0,
      is_top INTEGER DEFAULT 0,
      is_collapsed INTEGER DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER,
      reminded_at TEXT,
      repeat_type TEXT DEFAULT 'none',
      is_active INTEGER DEFAULT 1
    )
  `);
  
  // 插入默认字体设置（如果不存在）
  const existing = dbOps.get('SELECT value FROM app_settings WHERE key = ?', ['fontFamily']);
  if (!existing) {
    dbOps.run("INSERT INTO app_settings (key, value) VALUES ('fontFamily', 'Segoe UI Variable')");
  }
  const privacyExist = dbOps.get('SELECT value FROM app_settings WHERE key = ?', ['privacyShown']);
  if (!privacyExist) {
    dbOps.run("INSERT INTO app_settings (key, value) VALUES ('privacyShown', 'false')");
  }
  const langExist = dbOps.get('SELECT value FROM app_settings WHERE key = ?', ['language']);
  if (!langExist) {
    dbOps.run("INSERT INTO app_settings (key, value) VALUES ('language', 'zh-CN')");
  }
  const lightColorExist = dbOps.get('SELECT value FROM app_settings WHERE key = ?', ['lightColor']);
  if (!lightColorExist) {
    dbOps.run("INSERT INTO app_settings (key, value) VALUES ('lightColor', '#0FBAB2')");
  }
  const darkColorExist = dbOps.get('SELECT value FROM app_settings WHERE key = ?', ['darkColor']);
  if (!darkColorExist) {
    dbOps.run("INSERT INTO app_settings (key, value) VALUES ('darkColor', '#8CB89A')");
  }
  
  // 确保用户字体目录存在
  const fontsDir = path.join(app.getPath('userData'), 'fonts');
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }
  
  // 迁移：添加 sort_order 列（如果不存在）
  try {
    db.run('ALTER TABLE notes ADD COLUMN sort_order REAL DEFAULT NULL');
    log.info('Migration: sort_order column added');
  } catch (e) {
    // 列已存在，忽略错误
  }
  
  // 为现有便签初始化 sort_order（NULL 的按创建时间赋值）
  const uncounted = dbOps.all("SELECT id FROM notes WHERE sort_order IS NULL ORDER BY created_at ASC");
  if (uncounted.length > 0) {
    uncounted.forEach((note, index) => {
      dbOps.run('UPDATE notes SET sort_order = ? WHERE id = ?', [(index + 1) * 1000, note.id]);
    });
    log.info('Migration: initialized sort_order for', uncounted.length, 'notes');
  }
  
  await saveDatabase();
  log.info('Database initialized');
}

// 密码哈希工具
function hashPassword(plaintext) {
  if (!plaintext || plaintext.length === 0) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plaintext, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(plaintext, stored) {
  if (!plaintext || !stored || !stored.startsWith('pbkdf2:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const oldHash = parts[2];
  const newHash = crypto.pbkdf2Sync(plaintext, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(newHash), Buffer.from(oldHash));
}

// 带事务保护的数据库写入
async function atomicDbWrite(writeFn) {
  try {
    db.run('BEGIN TRANSACTION');
    await writeFn();
    db.run('COMMIT');
    await saveDatabase();
    return true;
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (e2) { /* ignore */ }
    log.error('Atomic DB write failed:', e);
    return false;
  }
}
const dbOps = {
  run(sql, params = []) {
    try {
      db.run(sql, params);
      return true;
    } catch (e) {
      log.error('DB run error:', e);
      return false;
    }
  },
  
  get(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    } catch (e) {
      log.error('DB get error:', e);
      return null;
    }
  },
  
  all(sql, params = []) {
    try {
      const results = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (e) {
      log.error('DB all error:', e);
      return [];
    }
  },
  
  createNote({ title = '', content = '', color = '#8CB89A', is_popup = 0 }) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // 计算 sort_order：当前最大 + 1000，空表则从 1000 开始
    const maxRow = this.get('SELECT COALESCE(MAX(sort_order), 0) as max_s FROM notes');
    const sortOrder = (maxRow?.max_s || 0) + 1000;
    db.run('INSERT INTO notes (title, content, color, created_at, updated_at, is_popup, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, content, color, now, now, is_popup, sortOrder]);
    const result = this.get('SELECT last_insert_rowid() as id');
    return this.getNoteById(result.id);
  },
  
  getAllNotes() {
    return this.all('SELECT * FROM notes WHERE is_popup = 0 ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC');
  },
  
  getPopupNotes() {
    return this.all('SELECT * FROM notes WHERE is_popup = 1 ORDER BY updated_at DESC');
  },
  
  getNoteById(id) {
    return this.get('SELECT * FROM notes WHERE id = ?', [id]);
  },
  
  updateNote({ id, title, content, color }) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    db.run("UPDATE notes SET title=?, content=?, color=?, updated_at=? WHERE id=?",
      [title, content, color, now, id]);
    return this.getNoteById(id);
  },
  
  deleteNote(id) {
    db.run('DELETE FROM window_states WHERE note_id=?', [id]);
    db.run('DELETE FROM reminders WHERE note_id=?', [id]);
    db.run('DELETE FROM notes WHERE id=?', [id]);
    log.info('Note deleted:', id);
  },
  
  setReminder(noteId, remindedAt, repeatType) {
    db.run('DELETE FROM reminders WHERE note_id=?', [noteId]);
    if (remindedAt) {
      db.run('INSERT INTO reminders (note_id, reminded_at, repeat_type) VALUES (?, ?, ?)',
        [noteId, remindedAt, repeatType || 'none']);
      db.run("UPDATE notes SET reminded_at=?, repeat_reminder=? WHERE id=?",
        [remindedAt, repeatType || 'none', noteId]);
    } else {
      db.run("UPDATE notes SET reminded_at=NULL, repeat_reminder='none' WHERE id=?", [noteId]);
    }
  },
  
  getActiveReminders() {
    return this.all('SELECT r.*, n.title, n.color FROM reminders r JOIN notes n ON r.note_id = n.id WHERE r.is_active = 1');
  },
  
  advanceReminder(reminderId, repeatType) {
    const reminder = this.get('SELECT * FROM reminders WHERE id = ?', [reminderId]);
    if (!reminder || repeatType === 'none') return;
    
    const now = new Date();
    let nextDate;
    
    switch (repeatType) {
      case 'daily':
        nextDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        nextDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        nextDate = new Date(now);
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      default:
        return;
    }
    
    const nextDateStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');
    db.run('UPDATE reminders SET reminded_at = ? WHERE id = ?', [nextDateStr, reminderId]);
    db.run('UPDATE notes SET reminded_at=? WHERE id=?', [nextDateStr, reminder.note_id]);
  },
  
  getWindowState(windowId) {
    return this.get('SELECT * FROM window_states WHERE window_id = ?', [windowId]);
  },
  
  saveWindowState({ windowId, noteId, x, y, width, height, sizeLevel, isTop, isCollapsed }) {
    const existing = this.get('SELECT id FROM window_states WHERE window_id = ?', [windowId]);
    if (existing) {
      db.run(`UPDATE window_states SET x=?, y=?, width=?, height=?, size_level=?, is_top=?, is_collapsed=? WHERE window_id=?`,
        [x, y, width, height, sizeLevel || 0, isTop ? 1 : 0, isCollapsed ? 1 : 0, windowId]);
    } else {
      db.run(`INSERT INTO window_states (window_id, note_id, x, y, width, height, size_level, is_top, is_collapsed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [windowId, noteId, x, y, width, height, sizeLevel || 0, isTop ? 1 : 0, isCollapsed ? 1 : 0]);
    }
  }
};

// 加载应用设置
function loadAppSettings() {
  try {
    const rows = dbOps.all('SELECT key, value FROM app_settings');
    rows.forEach(row => {
      if (row.key === 'lightColor' || row.key === 'darkColor') {
        appSettings[row.key] = row.value;
      } else if (row.key === 'soundEnabled' || row.key === 'autoLaunch') {
        appSettings[row.key] = row.value === 'true';
      } else if (row.key === 'privacyShown') {
        appSettings[row.key] = row.value === 'true';
      } else {
        appSettings[row.key] = row.value;
      }
    });
    // 密码迁移：如果存在明文密码，自动哈希
    if (appSettings.mainPassword && typeof appSettings.mainPassword === 'string' && !appSettings.mainPassword.startsWith('pbkdf2:')) {
      const hashed = hashPassword(appSettings.mainPassword);
      dbOps.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['mainPassword', hashed]);
      appSettings.mainPassword = hashed;
      log.info('Migrated plaintext password to PBKDF2 hash');
    }
  } catch (e) {
    log.error('Failed to load settings:', e);
  }
}

// 保存应用设置
function saveAppSetting(key, value) {
  try {
    const valueStr = (key === 'mainPassword' && value && typeof value === 'string' && !value.startsWith('pbkdf2:'))
      ? hashPassword(value)
      : String(value);
    dbOps.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, valueStr]);
    appSettings[key] = valueStr;
    // 开机启动设置实时生效
    if (key === 'autoLaunch') {
      app.setLoginItemSettings({
        openAtLogin: value === true || value === 'true',
        path: process.execPath
      });
    }
  } catch (e) {
    log.error('Failed to save setting:', e);
  }
}

// 创建托盘图标 (16x16 马尔斯绿)

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'transition.ico');
  return nativeImage.createFromPath(iconPath);
}

// Tray label translations
function getTrayLabels() {
  const labels = {
    'zh-CN': { open: '打开 Transition', newNote: '新建桌面便签', timeline: '时间线', settings: '设置', exit: '退出', tooltip: 'Transition - 变迁' },
    'en-US': { open: 'Open Transition', newNote: 'New Desktop Note', timeline: 'Timeline', settings: 'Settings', exit: 'Exit', tooltip: 'Transition' },
    'ja-JP': { open: 'Transitionを開く', newNote: '新規デスクトップメモ', timeline: 'タイムライン', settings: '設定', exit: '終了', tooltip: 'Transition - 变迁' },
    'ko-KR': { open: 'Transition 열기', newNote: '새 데스크톱 메모', timeline: '타임라인', settings: '설정', exit: '종료', tooltip: 'Transition - 变迁' },
    'fr-FR': { open: 'Ouvrir Transition', newNote: 'Nouvelle note bureau', timeline: 'Chronologie', settings: 'Paramètres', exit: 'Quitter', tooltip: 'Transition' },
    'de-DE': { open: 'Transition öffnen', newNote: 'Neue Desktop-Notiz', timeline: 'Zeitleiste', settings: 'Einstellungen', exit: 'Beenden', tooltip: 'Transition' },
  };
  const lang = appSettings.language || 'zh-CN';
  return labels[lang] || labels['zh-CN'];
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const labels = getTrayLabels();
  const contextMenu = Menu.buildFromTemplate([
    { label: labels.open, click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: labels.newNote, click: () => createPopupWindow() },
    { type: 'separator' },
    { label: labels.timeline, click: () => createTimelineWindow() },
    { label: labels.settings, click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: labels.exit, click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip(labels.tooltip);
  tray.setContextMenu(contextMenu);
}

// 创建系统托盘
function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  rebuildTrayMenu();
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  log.info('Tray created');
}

function forceRoundedShape(win) {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'win32') {
    const b = win.getBounds();
    win.setBounds({ x: b.x + 1, y: b.y, width: b.width, height: b.height });
    win.setBounds(b);
  }
}

// Electron 42 DWM frameless window fix: prevent system title bar on restore/show
function applyDWMFix(win) {
  if (!win || process.platform !== 'win32') return;
  let _fixTimer = null;
  const fixFrame = () => {
    if (win.isDestroyed()) return;
    const op = win.getOpacity();
    try { win.setOpacity(0.99); } catch (e) { /* ignore */ }
    try { win.setBackgroundColor('#00000000'); } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (!win.isDestroyed()) {
        try { win.setOpacity(op); } catch (e) { /* ignore */ }
      }
    }, 16);
  };
  win.on('restore', () => {
    clearTimeout(_fixTimer);
    _fixTimer = setTimeout(fixFrame, 100);
  });
  win.on('show', () => {
    clearTimeout(_fixTimer);
    _fixTimer = setTimeout(fixFrame, 50);
  });
}


function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 520,
    minWidth: 600,
    minHeight: 400,
    icon: path.join(__dirname, 'assets', 'transition.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // // roundedCorners: true, // Windows 11 圆角裁剪
    maximizable: true,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'));
  
  
  mainWindow.once('ready-to-show', () => {
    // Password protection check
    const needsPassword = appSettings.privacyLevel && appSettings.privacyLevel !== 'none' && appSettings.mainPassword;
    if (needsPassword && appSettings.privacyLevel !== 'remember') {
      mainWindow.webContents.send('password-prompt', { level: appSettings.privacyLevel });
    } else {
      mainWindow.show();
    }
    setTimeout(() => forceRoundedShape(mainWindow), 100);
    mainWindow.webContents.send('theme-changed', appSettings.theme);
    const initAccentColor = appSettings.theme === 'dark' ? appSettings.darkColor : appSettings.lightColor;
    mainWindow.webContents.send('accent-color-changed', { theme: appSettings.theme, color: initAccentColor });
    mainWindow.webContents.send('font-changed', appSettings.fontFamily);
    mainWindow.webContents.send('language-changed', appSettings.language);
    // 首次启动显示隐私政策
    if (!appSettings.privacyShown) {
      mainWindow.webContents.send('show-privacy');
    }
    // 发送初始最大化状态
    mainWindow.webContents.send('window-maximized', false); // 初始非最大化
    // 保存初始正常尺寸（固定值 780x520，位置从当前窗口获取）
    const bounds = mainWindow.getBounds();
    mainNormalBounds = { width: 780, height: 520, x: bounds.x, y: bounds.y };
    log.info('Main window ready, normal bounds:', mainNormalBounds);
  });

  // 监听窗口大小变化，保存正常尺寸
  mainWindow.on('resize', () => {
    if (!_restoring && !mainWindow.isMaximized()) {
      mainNormalBounds = mainWindow.getBounds();
    }
  });

  // 监听最大化状态变化，同步到渲染进程
  // 最大化/还原由 IPC 手动 setBounds 处理，不使用原生 maximize/unmaximize

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// 创建设置窗口
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    icon: path.join(__dirname, 'assets', 'transition.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // // roundedCorners: true, // Windows 11 圆角裁剪
    modal: false,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    setTimeout(() => forceRoundedShape(settingsWindow), 100);
    settingsWindow.webContents.send('theme-changed', appSettings.theme);
    const sAccent = appSettings.theme === 'dark' ? appSettings.darkColor : appSettings.lightColor;
    settingsWindow.webContents.send('accent-color-changed', { theme: appSettings.theme, color: sAccent });
    settingsWindow.webContents.send('font-changed', appSettings.fontFamily);
    settingsWindow.webContents.send('language-changed', appSettings.language);
  });
  
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// 创建时间线窗口
function createTimelineWindow() {
  if (timelineWindow) {
    timelineWindow.show();
    timelineWindow.focus();
    return;
  }
  
  timelineWindow = new BrowserWindow({
    width: 700,
    height: 600,
    icon: path.join(__dirname, 'assets', 'transition.ico'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // // roundedCorners: true, // Windows 11 圆角裁剪
    maximizable: true,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  
  timelineWindow.loadFile(path.join(__dirname, 'renderer', 'timeline.html'));
  
  timelineWindow.once('ready-to-show', () => {
    timelineWindow.show();
    setTimeout(() => forceRoundedShape(timelineWindow), 100);
    timelineWindow.webContents.send('theme-changed', appSettings.theme);
    const tAccent = appSettings.theme === 'dark' ? appSettings.darkColor : appSettings.lightColor;
    timelineWindow.webContents.send('accent-color-changed', { theme: appSettings.theme, color: tAccent });
    timelineWindow.webContents.send('language-changed', appSettings.language);
  });
  
  timelineWindow.on('closed', () => {
    timelineWindow = null;
  });
}

// 创建桌面小窗
function createPopupWindow(noteData = null) {
  const windowId = `popup-${Date.now()}`;
  
  let note = noteData;
  if (!note) {
    note = dbOps.createNote({ title: '', content: '', color: '#0FBAB2', is_popup: 1 });
  }
  
  const savedState = dbOps.getWindowState(windowId);
  const defaultSize = popupSizes[0];
  
  const popupWindow = new BrowserWindow({
    width: savedState?.width || defaultSize.width,
    height: savedState?.height || defaultSize.height,
    x: savedState?.x,
    y: savedState?.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // // roundedCorners: true, // Windows 11 圆角裁剪
    useContentSize: true, // 窗口大小基于网页内容
    alwaysOnTop: savedState?.is_top === 1,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  
  popupWindows.set(windowId, { window: popupWindow, noteId: note.id });
  
  popupWindow.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
  
  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
    setTimeout(() => forceRoundedShape(popupWindow), 100);
    popupWindow.webContents.send('init-popup', {
      windowId,
      noteId: note.id,
      sizeLevel: savedState?.size_level || 0,
      isTop: savedState?.is_top === 1,
      isCollapsed: savedState?.is_collapsed === 1
    });
    popupWindow.webContents.send('font-changed', appSettings.fontFamily);
    const pAccent = appSettings.theme === 'dark' ? appSettings.darkColor : appSettings.lightColor;
    popupWindow.webContents.send('accent-color-changed', { theme: appSettings.theme, color: pAccent });
  });
  
  const saveState = () => {
    const bounds = popupWindow.getBounds();
    const sizeLevel = popupSizes.findIndex(s => s.width === bounds.width && s.height === bounds.height);
    dbOps.saveWindowState({
      windowId,
      noteId: note.id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: sizeLevel >= 0 ? sizeLevel : 0,
      isTop: popupWindow.isAlwaysOnTop(),
      isCollapsed: false
    });
    saveDatabase();
  };
  
  popupWindow.on('moved', saveState);
  popupWindow.on('resized', saveState);
  
  popupWindow.on('closed', () => {
    popupWindows.delete(windowId);
  });
}

// 提醒检查定时器
let reminderInterval = null;
let reminderTimeout = null;

function startReminderChecker() {
  if (reminderInterval) clearInterval(reminderInterval);
  if (reminderTimeout) clearTimeout(reminderTimeout);
  
  // 周期性检查（5秒间隔）
  reminderInterval = setInterval(() => {
    checkReminders();
  }, 5000);
  
  // 立即检查一次
  checkReminders();
}

function checkReminders() {
  const now = new Date();
  const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');
  const reminders = dbOps.getActiveReminders();
  
  let nearestNextTime = null;
  
  reminders.forEach(reminder => {
    if (reminder.reminded_at && reminder.reminded_at <= nowStr) {
      triggerReminder(reminder);
      
      if (reminder.repeat_type !== 'none') {
        dbOps.advanceReminder(reminder.id, reminder.repeat_type);
      } else {
        // 修复：不重复的提醒触发后，清除提醒时间
        dbOps.run('UPDATE reminders SET is_active = 0, reminded_at = NULL WHERE id = ?', [reminder.id]);
        dbOps.run("UPDATE notes SET reminded_at = NULL, repeat_reminder = 'none' WHERE id = ?", [reminder.note_id]);
      }
      saveDatabase();
    } else if (reminder.reminded_at) {
      // 记录下一个即将到期的提醒
      const reminderTime = new Date(reminder.reminded_at.replace(' ', 'T'));
      if (!nearestNextTime || reminderTime < nearestNextTime) {
        nearestNextTime = reminderTime;
      }
    }
  });
  
  // 设置精确的超时（如果距离下次提醒小于1分钟则设置精确触发）
  if (nearestNextTime) {
    const delay = nearestNextTime.getTime() - now.getTime();
    // 如果距离下次提醒在1秒到60秒之间，设置精确超时
    if (delay > 1000 && delay < 60000) {
      if (reminderTimeout) clearTimeout(reminderTimeout);
      reminderTimeout = setTimeout(() => {
        checkReminders();
        // 继续周期性检查后重新设置
        startReminderChecker();
      }, delay);
    }
  }
}

function triggerReminder(reminder) {
  if (Notification.isSupported()) {
    const titleText = reminder.title || 'Transition';
    const bodyText = reminder.content ? reminder.content.substring(0, 50) : '';
    const notification = new Notification({
      title: titleText,
      body: bodyText || 'Transition',
      silent: !appSettings.soundEnabled
    });
    notification.show();
  }
  
  popupWindows.forEach(({ noteId }, windowId) => {
    if (noteId === reminder.note_id) {
      const popup = popupWindows.get(windowId);
      if (popup) {
        popup.window.webContents.send('trigger-flash');
        // Notify popup to refresh reminder button
        popup.window.webContents.send('reminder-updated');
      }
    }
  });
  
  log.info('Reminder triggered:', reminder.note_id);
}

// IPC 处理
ipcMain.handle('create-note', async (e, data) => {
  let result;
  await atomicDbWrite(() => {
    result = dbOps.createNote(data);
  });
  return result;
});

ipcMain.handle('get-all-notes', async () => dbOps.getAllNotes());

ipcMain.handle('get-popup-notes', async () => dbOps.getPopupNotes());

ipcMain.handle('get-note-by-id', async (e, id) => dbOps.getNoteById(id));

ipcMain.handle('update-note', async (e, data) => {
  let result;
  await atomicDbWrite(() => {
    result = dbOps.updateNote(data);
  });
  // Broadcast to popup windows if the note is open in a popup
  if (data && data.id) {
    popupWindows.forEach(({ noteId: popupNoteId, window: popupWindow }) => {
      if (popupNoteId === data.id && popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('notes-changed', { noteId: data.id });
        if (data.color) {
          popupWindow.webContents.send('color-changed', { color: data.color });
        }
      }
    });
  }
  return result;
});

ipcMain.handle('delete-note', async (e, id) => {
  await atomicDbWrite(() => {
    dbOps.deleteNote(id);
  });
});

// 拖拽排序持久化
ipcMain.handle('reorder-notes', async (e, orderArray) => {
  const ok = await atomicDbWrite(() => {
    for (const item of orderArray) {
      db.run('UPDATE notes SET sort_order = ? WHERE id = ?', [item.sort_order, item.id]);
    }
  });
  if (ok) {
    log.info('reorder-notes: updated', orderArray.length, 'notes');
    return { success: true };
  }
  return { success: false, error: 'Transaction failed' };
});

ipcMain.handle('set-reminder', async (e, { noteId, remindedAt, repeatType }) => {
  await atomicDbWrite(() => {
    dbOps.setReminder(noteId, remindedAt, repeatType);
  });
  return true;
});

ipcMain.handle('get-active-reminders', async () => dbOps.getActiveReminders());

ipcMain.handle('get-app-settings', async () => appSettings);

ipcMain.handle('get-privacy-shown', async () => {
  return appSettings.privacyShown === true;
});

ipcMain.handle('set-privacy-shown', async (e, { value }) => {
  saveAppSetting('privacyShown', value);
  await saveDatabase();
  return true;
});

ipcMain.handle('get-translations', async (e, langCode) => {
  try {
    const localePath = path.join(__dirname, 'renderer', 'locales', langCode + '.json');
    if (fs.existsSync(localePath)) {
      const content = fs.readFileSync(localePath, 'utf-8');
      return JSON.parse(content);
    }
    // Fallback to zh-CN
    const fallbackPath = path.join(__dirname, 'renderer', 'locales', 'zh-CN.json');
    if (fs.existsSync(fallbackPath)) {
      const content = fs.readFileSync(fallbackPath, 'utf-8');
      return JSON.parse(content);
    }
    return {};
  } catch (err) {
    log.error('Failed to load translations:', err);
    return {};
  }
});

ipcMain.handle('save-app-setting', async (e, { key, value }) => {
  saveAppSetting(key, value);
  await saveDatabase();
  const allWindows = [mainWindow, settingsWindow, timelineWindow];
  for (const popup of popupWindows.values()) {
    allWindows.push(popup.window);
  }
  if (key === 'theme') {
    allWindows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('theme-changed', value);
        const accentColor = value === 'dark' ? appSettings.darkColor : appSettings.lightColor;
        win.webContents.send('accent-color-changed', { theme: value, color: accentColor });
      }
    });
  }
  if (key === 'language') {
    allWindows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('language-changed', value);
      }
    });
    rebuildTrayMenu();
  }
  if (key === 'lightColor' || key === 'darkColor') {
    const currentTheme = appSettings.theme || 'light';
    const colorKey = currentTheme === 'dark' ? 'darkColor' : 'lightColor';
    const accentColor = appSettings[colorKey] || value;
    allWindows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('accent-color-changed', { theme: currentTheme, color: accentColor });
      }
    });
  }
  return true;
});
ipcMain.handle('verify-main-password', async (e, password) => {
  if (!appSettings.mainPassword) return true; // no password set = pass
  const level = appSettings.privacyLevel || 'none';
  if (level === 'none') return true;
  // 'remember' 模式：首次验证后24小时免密
  if (level === 'remember' && appSettings._lastPasswordUnlock) {
    const elapsed = Date.now() - appSettings._lastPasswordUnlock;
    if (elapsed < 24 * 60 * 60 * 1000) return true;
  }
  const valid = verifyPassword(password, appSettings.mainPassword);
  if (valid) {
    appSettings._lastPasswordUnlock = Date.now();
    log.info('Password verified successfully');
  } else {
    log.warn('Password verification failed');
  }
  return valid;
});

ipcMain.handle('get-timeline-notes', async () => {
  return dbOps.all('SELECT * FROM notes ORDER BY updated_at DESC LIMIT 500');
});

ipcMain.handle('get-system-fonts', async () => {
  return [
    'Segoe UI Variable',
    'Segoe UI',
    'Microsoft YaHei',
    'PingFang SC',
    'SimSun',
    'SimHei',
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Georgia',
    'Verdana',
    'Courier New',
    'Consolas',
    'Cambria',
    'Calibri'
  ];
});

ipcMain.handle('get-available-fonts', async () => {
  const baseFonts = [
    'Segoe UI Variable', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
    'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana',
    'Courier New', 'Consolas', 'Calibri', 'Cambria'
  ];
  const importedFonts = [];
  const fontsDir = path.join(app.getPath('userData'), 'fonts');
  if (fs.existsSync(fontsDir)) {
    const files = fs.readdirSync(fontsDir);
    files.forEach(file => {
      if (file.endsWith('.ttf') || file.endsWith('.otf')) {
        importedFonts.push(path.basename(file, path.extname(file)));
      }
    });
  }
  return { system: baseFonts, imported: importedFonts };
});

ipcMain.handle('import-font', async (e, filePath) => {
  try {
    const fontsDir = path.join(app.getPath('userData'), 'fonts');
    if (!fs.existsSync(fontsDir)) {
      fs.mkdirSync(fontsDir, { recursive: true });
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.ttf' && ext !== '.otf') {
      return { success: false, error: 'Unsupported format: .ttf or .otf required' };
    }
    
    const fileName = path.basename(filePath);
    const destPath = path.join(fontsDir, fileName);
    
    // 如果文件已存在，添加数字后缀
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(fontsDir, path.basename(fileName, ext) + '_' + counter + ext);
      counter++;
    }
    
    fs.copyFileSync(filePath, finalPath);
    
    const importedName = path.basename(finalPath, path.extname(finalPath));
    log.info('Font imported:', importedName);
    
    return { success: true, fontName: importedName, fontPath: finalPath };
  } catch (e) {
    log.error('Failed to import font:', e);
    return { success: false, error: e.message };
  }
});

// 更新全局字体设置并通知所有窗口
ipcMain.handle('update-global-font', async (e, fontFamily) => {
  appSettings.fontFamily = fontFamily;
  dbOps.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('fontFamily', ?)", [fontFamily]);
  await saveDatabase();
  
  // 通知所有窗口刷新字体
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('font-changed', fontFamily);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('font-changed', fontFamily);
  }
  if (timelineWindow && !timelineWindow.isDestroyed()) {
    timelineWindow.webContents.send('font-changed', fontFamily);
  }
  popupWindows.forEach(({ window: popupWindow }) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('font-changed', fontFamily);
      // 双保险：透明 frameless 窗口的 IPC 事件可能失效，直接执行 JS
      const safeFont = fontFamily.replace(/'/g, "\\'");
      popupWindow.webContents.executeJavaScript(`
        window._popupFontFamily = '${safeFont}';
        if (typeof window.applyPopupFont === 'function') window.applyPopupFont();
      `).catch(() => {});
    }
  });
  
  return { success: true };
});

// 获取色板
ipcMain.handle('get-color-palette', async () => {
  return [
    { name: '松石青', color: '#0FBAB2', group: '主题色' },
    { name: '浅松石青', color: '#5DD5CD', group: '主题色' },
    { name: '深松石青', color: '#0A9E98', group: '主题色' },
    { name: '青瓷绿', color: '#8CB89A', group: '主题色' },
    { name: '浅马尔斯绿', color: '#9CCCB8', group: '马尔斯绿' },
    { name: '深马尔斯绿', color: '#669988', group: '马尔斯绿' },
    { name: '雾感马尔斯绿', color: '#91BEAC', group: '马尔斯绿' },
    { name: '莫兰迪灰粉', color: '#CEADAE', group: '莫兰迪' },
    { name: '莫兰迪豆绿', color: '#9BB79E', group: '莫兰迪' },
    { name: '莫兰迪燕麦米', color: '#D8D1C4', group: '莫兰迪' },
    { name: '莫兰迪雾霾紫', color: '#AAA7C1', group: '莫兰迪' },
    { name: '莫兰迪灰蓝', color: '#8D9BB2', group: '莫兰迪' },
    { name: '莫兰迪奶茶棕', color: '#C7B197', group: '莫兰迪' },
    { name: '莫兰迪浅灰', color: '#BEC2C8', group: '莫兰迪' },
    { name: '干枯玫瑰', color: '#BB9E9D', group: '莫兰迪' },
    { name: '敦煌石青', color: '#466E8C', group: '敦煌' },
    { name: '敦煌赭石', color: '#966446', group: '敦煌' },
    { name: '敦煌月白', color: '#E1E6EB', group: '敦煌' },
    { name: '敦煌藤黄', color: '#C8AF64', group: '敦煌' },
    { name: '敦煌胭脂粉', color: '#B4828C', group: '敦煌' },
    { name: '敦煌苍绿', color: '#5A7D6E', group: '敦煌' },
    { name: '敦煌烟褐', color: '#786455', group: '敦煌' },
    { name: '马卡龙奶蓝', color: '#A0C3E1', group: '马卡龙' },
    { name: '马卡龙奶粉', color: '#E6C3CD', group: '马卡龙' },
    { name: '薄荷奶绿', color: '#AFD7C3', group: '马卡龙' },
    { name: '香芋奶紫', color: '#C3B4D7', group: '马卡龙' },
    { name: '奶油黄', color: '#F5E1B4', group: '马卡龙' },
    { name: '马卡龙浅杏', color: '#EBD7C3', group: '马卡龙' },
    { name: '洛可可藕粉', color: '#D2B4B9', group: '洛可可' },
    { name: '洛可可雾蓝', color: '#8296B4', group: '洛可可' },
    { name: '鼠尾草绿', color: '#87A596', group: '洛可可' },
    { name: '洛可可奶咖', color: '#B9A591', group: '洛可可' },
    { name: '灰丁香紫', color: '#A59BB9', group: '洛可可' },
  ];
});

// 窗口控制
ipcMain.on('password-unlock', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Auto-updater IPC
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(err => {
    log.warn('Update check failed (network unavailable):', err.message || err);
  });
});
ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate();
});
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.on('window-minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.minimize();
});

// 最大化/还原切换
// 方案：nudge 技巧 + toggle backgroundColor 绕过 DWM 分层窗口的 SetWindowPos 拦截
ipcMain.on('window-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  
  const { screen } = require('electron');
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;
  
  const isMaximized = (
    Math.abs(bounds.width - wa.width) < 50 &&
    Math.abs(bounds.height - wa.height) < 50
  );
  
  if (isMaximized) {
    // === 还原 ===
    const target = mainNormalBounds || { x: bounds.x, y: bounds.y, width: 780, height: 520 };
    
    _restoring = true;
    
    // 步骤 1: nudge 打破 DWM 对齐
    win.setBounds({ x: bounds.x + 25, y: bounds.y + 25, width: bounds.width - 50, height: bounds.height - 50 });
    
    // 步骤 2: toggle 背景色重建分层表面
    win.setBackgroundColor('#01000000');
    
    // 步骤 3: 下一帧 setBounds 到目标
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height });
        win.setBackgroundColor('#01000000');
        _restoring = false;
        win.webContents.send('window-maximized', false);
        log.info('window-maximize: restored to', target);
      }
    }, 16);
  } else {
    // === 最大化 ===
    // 保存当前正常尺寸
    if (bounds.width > 200 && bounds.height > 200) {
      mainNormalBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      log.info('saved normal bounds:', mainNormalBounds);
    }
    // 设标志防止 resize 事件覆盖保存的 mainNormalBounds
    _restoring = true;
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
    setTimeout(() => { _restoring = false; }, 200);
    win.webContents.send('window-maximized', true);
    log.info('window-maximize: maximized to workArea', wa);
  }
});

ipcMain.on('window-close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.close();
});

ipcMain.on('window-hide', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.hide();
});

ipcMain.on('open-settings', () => createSettingsWindow());
ipcMain.on('open-timeline', () => createTimelineWindow());
ipcMain.on('open-privacy', (e) => {
  if (privacyWindow && !privacyWindow.isDestroyed()) {
    privacyWindow.focus();
    return;
  }
  const parentWin = BrowserWindow.fromWebContents(e.sender);
  const privacyWin = new BrowserWindow({
    width: 500,
    height: 450,
    parent: parentWin,
    modal: true,
    resizable: false,
    title: '隐私政策',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  privacyWin.loadFile(path.join(__dirname, 'renderer', 'privacy.html'));
  privacyWindow = privacyWin;
  privacyWin.on('closed', () => { privacyWindow = null; });
});

// 打开反馈链接
ipcMain.on('open-feedback', () => {
  const { shell } = require('electron');
  shell.openExternal('https://timeline.cab/feedback');
});

ipcMain.on('open-about', (e) => {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  const parentWin = BrowserWindow.fromWebContents(e.sender);
  const aboutWin = new BrowserWindow({
    width: 400,
    height: 300,
    parent: parentWin,
    modal: true,
    resizable: false,
    title: '关于 Transition',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWin.loadFile(path.join(__dirname, 'renderer', 'about.html'));
  aboutWindow = aboutWin;
  aboutWin.on('closed', () => { aboutWindow = null; });
});
ipcMain.on('create-popup', (e, noteId) => {
  const noteData = noteId ? dbOps.getNoteById(noteId) : null;
  createPopupWindow(noteData);
});

ipcMain.on('toggle-always-on-top', async (e, { windowId, isTop }) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    popup.window.setAlwaysOnTop(isTop);
    const bounds = popup.window.getBounds();
    dbOps.saveWindowState({
      windowId,
      noteId: popup.noteId,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: 0,
      isTop
    });
    await saveDatabase();
  }
});

ipcMain.on('cycle-window-size', async (e, windowId) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    const currentBounds = popup.window.getBounds();
    const currentIndex = popupSizes.findIndex(s => s.width === currentBounds.width && s.height === currentBounds.height);
    const nextIndex = (currentIndex + 1) % popupSizes.length;
    const nextSize = popupSizes[nextIndex];
    
    popup.window.setSize(nextSize.width, nextSize.height);
    const bounds = popup.window.getBounds();
    dbOps.saveWindowState({
      windowId,
      noteId: popup.noteId,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: nextIndex,
      isTop: popup.window.isAlwaysOnTop()
    });
    await saveDatabase();
    
    popup.window.webContents.send('size-changed', nextIndex);
  }
});

ipcMain.on('resize-popup', async (e, { windowId, width, height }) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    popup.window.setSize(width, height);
    const bounds = popup.window.getBounds();
    const sizeLevel = popupSizes.findIndex(s => s.width === width && s.height === height);
    dbOps.saveWindowState({
      windowId,
      noteId: popup.noteId,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: sizeLevel >= 0 ? sizeLevel : 0,
      isTop: popup.window.isAlwaysOnTop()
    });
    await saveDatabase();
    
    popup.window.webContents.send('size-changed', sizeLevel >= 0 ? sizeLevel : 0);
  }
});

ipcMain.on('delete-popup-note', async (e, { windowId, noteId }) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    popup.window.removeAllListeners('moved');
    popup.window.removeAllListeners('resized');
    popup.window.close();
  }
  if (noteId) {
    await atomicDbWrite(() => {
      dbOps.deleteNote(noteId);
    });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notes-changed', { noteId });
  }
});
ipcMain.on('update-popup-collapsed', async (e, { windowId, isCollapsed }) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    const bounds = popup.window.getBounds();
    dbOps.saveWindowState({
      windowId,
      noteId: popup.noteId,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: 0,
      isTop: popup.window.isAlwaysOnTop(),
      isCollapsed
    });
    await saveDatabase();
  }
});

ipcMain.on('fold-popup', async (e, { windowId, isCollapsed, collapsedHeight }) => {
  const popup = popupWindows.get(windowId);
  if (popup) {
    if (isCollapsed) {
      // 折叠：缩小窗口高度
      popup.window.setSize(popupSizes[popupSizes.length - 1].width, collapsedHeight);
    } else {
      // 展开：恢复原始尺寸
      const savedState = dbOps.getWindowState(windowId);
      const defaultSize = popupSizes[savedState?.size_level || 0] || popupSizes[0];
      popup.window.setSize(defaultSize.width, defaultSize.height);
    }
    const bounds = popup.window.getBounds();
    dbOps.saveWindowState({
      windowId,
      noteId: popup.noteId,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      sizeLevel: isCollapsed ? -1 : (savedState?.size_level || 0),
      isTop: popup.window.isAlwaysOnTop(),
      isCollapsed
    });
    await saveDatabase();
  }
});

// 小窗保存便签后通知主窗口刷新
ipcMain.on('popup-note-saved', async (e, { noteId }) => {
  // 向主窗口发送 notes-changed 事件
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notes-changed', { noteId });
  }
  // Also notify other popups of the same note
  popupWindows.forEach(({ noteId: popupNoteId, window: popupWindow }) => {
    if (popupNoteId === noteId && popupWindow && !popupWindow.isDestroyed() &&
        popupWindow.webContents !== e.sender) {
      popupWindow.webContents.send('notes-changed', { noteId });
    }
  });
  try { log.info('Popup note saved, notified main window:', noteId); } catch (e) {}
});

// 修复：主窗口更新便签颜色时通知小窗刷新
ipcMain.on('update-popup-color', async (e, { noteId, color }) => {
  popupWindows.forEach(({ noteId: popupNoteId, window: popupWindow }, windowId) => {
    if (popupNoteId === noteId && popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('color-changed', { color });
      log.info('Popup color updated:', windowId, color);
    }
  });
});

// 从时间线窗口打开便签到主窗口编辑
ipcMain.on('open-note-in-main', async (e, noteId) => {
  if (mainWindow) {
    // 确保主窗口可见
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    // 发送 select-note 事件让主窗口选中该便签
    mainWindow.webContents.send('select-note', noteId);
    log.info('Opening note in main window:', noteId);
  }
});

// 应用启动
app.whenReady().then(async () => {
  log.info('App starting...');
  try {
    await initDatabase();
  } catch (e) {
    log.error('Database initialization failed:', e);
    process.exit(1);
  }
  loadAppSettings();
  // 应用开机启动设置
  app.setLoginItemSettings({
    openAtLogin: appSettings.autoLaunch === true || appSettings.autoLaunch === 'true',
    path: process.execPath
  });
  createTray();
  createMainWindow();
  startReminderChecker();
  
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+T', () => {
    createPopupWindow();
  });
  if (!shortcutRegistered) {
    log.warn('Failed to register global shortcut: CommandOrControl+Shift+T (may be in use by another app)');
  }
  
  // Check for updates in production
  if (app.isPackaged) {
    try { autoUpdater.checkForUpdates(); } catch (e) { log.warn('Update check failed:', e.message); }
  }
  // Apply frameless window fix
  applyDWMFix(mainWindow);

  log.info('App ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (reminderInterval) clearInterval(reminderInterval);
  if (reminderTimeout) clearTimeout(reminderTimeout);
  globalShortcut.unregisterAll();
  // Silence console during shutdown
  log.transports.console.level = false;
  try {
    await saveDatabase();
  } catch (e) {
    // Ignore save errors during shutdown
  }
  try {
    log.info('App quitting');
  } catch (e) {
    // Ignore log errors during shutdown
  }
});
