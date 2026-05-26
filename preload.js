const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('transitionAPI', {
  // 便签 CRUD
  createNote: (data) => ipcRenderer.invoke('create-note', data),
  getAllNotes: () => ipcRenderer.invoke('get-all-notes'),
  getPopupNotes: () => ipcRenderer.invoke('get-popup-notes'),
  getNoteById: (id) => ipcRenderer.invoke('get-note-by-id', id),
  updateNote: (data) => ipcRenderer.invoke('update-note', data),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),
  reorderNotes: (orderArray) => ipcRenderer.invoke('reorder-notes', orderArray),
  
  // 提醒
  setReminder: (data) => ipcRenderer.invoke('set-reminder', data),
  getActiveReminders: () => ipcRenderer.invoke('get-active-reminders'),
  
  // 设置
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  saveAppSetting: (data) => ipcRenderer.invoke('save-app-setting', data),
  
  // 时间线
  getTimelineNotes: () => ipcRenderer.invoke('get-timeline-notes'),
  
  // 系统字体
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  
  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  hideWindow: () => ipcRenderer.send('window-hide'),
  
  // 特殊窗口
  openSettings: () => ipcRenderer.send('open-settings'),
  openTimeline: () => ipcRenderer.send('open-timeline'),
  createPopup: (noteId) => ipcRenderer.send('create-popup', noteId),
  openNoteInMain: (noteId) => ipcRenderer.send('open-note-in-main', noteId),
  openPrivacy: () => ipcRenderer.send('open-privacy'),
  openAbout: () => ipcRenderer.send('open-about'),
  openFeedback: () => ipcRenderer.send('open-feedback'),
  
  // 小窗控制
  toggleAlwaysOnTop: (data) => ipcRenderer.send('toggle-always-on-top', data),
  cycleWindowSize: (windowId) => ipcRenderer.send('cycle-window-size', windowId),
  resizePopup: (data) => ipcRenderer.send('resize-popup', data),
  deletePopupNote: (data) => ipcRenderer.send('delete-popup-note', data),
  updatePopupCollapsed: (data) => ipcRenderer.send('update-popup-collapsed', data),
  foldPopup: (data) => ipcRenderer.send('fold-popup', data),
  notifyNoteSaved: (data) => ipcRenderer.send('popup-note-saved', data),
  
  // 颜色同步
  updatePopupColor: (data) => ipcRenderer.send('update-popup-color', data),
  
  // 事件监听
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (e, theme) => callback(theme));
  },
  onInitPopup: (callback) => {
    ipcRenderer.on('init-popup', (e, data) => callback(data));
  },
  onTriggerFlash: (callback) => {
    ipcRenderer.on('trigger-flash', () => callback());
  },
  onSizeChanged: (callback) => {
    ipcRenderer.on('size-changed', (e, sizeLevel) => callback(sizeLevel));
  },
  onNotesChanged: (callback) => {
    ipcRenderer.on('notes-changed', () => callback());
  },
  onSelectNote: (callback) => {
    ipcRenderer.on('select-note', (e, noteId) => callback(noteId));
  },
  onColorChanged: (callback) => {
    ipcRenderer.on('color-changed', (event, data) => callback(data));
  },

  // 密码验证
  onPasswordPrompt: (callback) => {
    ipcRenderer.on('password-prompt', (e, data) => callback(data));
  },
  verifyMainPassword: (password) => ipcRenderer.invoke('verify-main-password', password),
  notifyPasswordUnlock: () => ipcRenderer.send('password-unlock'),
  // 自动更新
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (callback) => { ipcRenderer.on('update-available', () => callback()); },
  onUpdateDownloaded: (callback) => { ipcRenderer.on('update-downloaded', () => callback()); },

    onReminderUpdated: (callback) => {
    ipcRenderer.on('reminder-updated', () => callback());
  },
  onWindowMaximized: (callback) => {
    ipcRenderer.on('window-maximized', (e, isMaximized) => callback(isMaximized));
  },
  onFontChanged: (callback) => {
    ipcRenderer.on('font-changed', (e, fontFamily) => callback(fontFamily));
  },
  // 隐私政策
  getPrivacyShown: () => ipcRenderer.invoke('get-privacy-shown'),
  setPrivacyShown: (value) => ipcRenderer.invoke('set-privacy-shown', { value }),
  onShowPrivacy: (callback) => {
    ipcRenderer.on('show-privacy', () => callback());
  },
  // 多语言
  getTranslations: (langCode) => ipcRenderer.invoke('get-translations', langCode),
    onAccentColorChanged: (callback) => {
    ipcRenderer.on('accent-color-changed', (event, data) => callback(data));
  },
  onLanguageChanged: (callback) => {
    ipcRenderer.on('language-changed', (event, langCode) => callback(langCode));
  },
  
  // 字体管理
  importFont: (filePath) => ipcRenderer.invoke('import-font', filePath),
  getAvailableFonts: () => ipcRenderer.invoke('get-available-fonts'),
  updateGlobalFont: (fontFamily) => ipcRenderer.invoke('update-global-font', fontFamily),
  
  // 色板
  getColorPalette: () => ipcRenderer.invoke('get-color-palette')
});
