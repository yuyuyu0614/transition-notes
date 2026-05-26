let windowId = null;
let noteId = null;
let currentColor = '#0FBAB2';

// Update bottom toolbar and all UI elements to match the note's own color
function applyNoteColor(colorHex) {
  const r = parseInt(colorHex.slice(1,3), 16);
  const g = parseInt(colorHex.slice(3,5), 16);
  const b = parseInt(colorHex.slice(5,7), 16);
  const root = document.documentElement;
  // Update popup-specific color variables for bottom toolbar
  root.style.setProperty('--note-r', r);
  root.style.setProperty('--note-g', g);
  root.style.setProperty('--note-b', b);
  root.style.setProperty('--note-color', colorHex);
  // Toolbar background: tinted version of the note color
  root.style.setProperty('--popup-toolbar-bg', 'rgba(' + Math.floor(r*0.35+165) + ',' + Math.floor(g*0.35+165) + ',' + Math.floor(b*0.35+165) + ', 0.88)');
  // Button background: note color at low alpha
  root.style.setProperty('--popup-btn-bg', 'rgba(' + r + ',' + g + ',' + b + ', 0.18)');
  root.style.setProperty('--popup-btn-hover', 'rgba(' + r + ',' + g + ',' + b + ', 0.28)');
}
let isTop = false;
let isCollapsed = false;
let isFlashing = false;
let sizeLevel = 0;
let fullHeight = 200; // 记录展开时的高度，用于展开恢复
let isComposing = false; // 中文输入法组合状态
let currentRemindedAt = null; // 当前便签的提醒时间
let currentRepeatReminder = 'none';

const popupSizes = [
  { width: 280, height: 200 },
  { width: 560, height: 400 },
  { width: 840, height: 600 }
];

const popupPane = document.getElementById('popupPane');
const colorBar = document.getElementById('colorBar');
const popupTitle = document.getElementById('popupTitle');
const popupTextarea = document.getElementById('popupTextarea');
const popupContent = document.getElementById('popupContent');
const popupCollapsed = document.getElementById('popupCollapsed');
const collapsedTitle = document.getElementById('collapsedTitle');
const sizeBtn = document.getElementById('sizeBtn');
const pinBtn = document.getElementById('pinBtn');
const deleteBtn = document.getElementById('deleteBtn');
const closeBtn = document.getElementById('closeBtn');
const charCount = document.getElementById('charCount');
const colorBtn = document.getElementById('colorBtn');
const colorDotIcon = document.getElementById('colorDotIcon');
const popupColorPanel = document.getElementById('popupColorPanel');
const popupColorPanelClose = document.getElementById('popupColorPanelClose');
const popupColorGroups = document.getElementById('popupColorGroups');
let popupColorPalette = [];

// 初始化
window.transitionAPI.onInitPopup(async (data) => {
  windowId = data.windowId;
  noteId = data.noteId;
  isTop = data.isTop;
  isCollapsed = data.isCollapsed;
  sizeLevel = data.sizeLevel || 0;
  
  // 根据 sizeLevel 设置完整高度
  if (data.sizeLevel >= 0 && data.sizeLevel < popupSizes.length) {
    fullHeight = popupSizes[data.sizeLevel].height;
  }
  
  pinBtn.classList.toggle('active', isTop);
  
  if (data.isCollapsed) {
    collapseWindow();
  }
  
  // Initialize i18n
  try {
    const settings = await window.transitionAPI.getAppSettings();
    if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
    const accentInit = settings.theme === 'dark' ? (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2');
    applyThemeColors(settings.theme || 'light', accentInit);
  // After loadNote sets currentColor, re-apply note color to toolbar
  setTimeout(() => { if (currentColor) applyNoteColor(currentColor); }, 200);
    const lang = settings.language || 'zh-CN';
    await I18N.init(lang);
    if (settings.fontFamily) {
      globalFontFamily = settings.fontFamily;
      window._popupFontFamily = settings.fontFamily;
      applyPopupFont();
    }
  } catch (e) { console.error('Popup i18n failed:', e); }
  await loadPopupColorPalette();
  await loadNote();

  // Listen for language changes
  window.transitionAPI.onLanguageChanged(async (newLang) => {
    await I18N.init(newLang);
  });

  // Listen for notes-changed from main window to sync content
  window.transitionAPI.onNotesChanged(async () => {
    if (noteId) await loadNote();
  });

  // Listen for color-changed from main window
  window.transitionAPI.onColorChanged((data) => {
    if (data && data.color) {
      currentColor = data.color;
      colorBar.style.background = currentColor;
      applyNoteColor(currentColor);
      updateColorDotIcon();
    }
  });

  // Re-apply i18n when language changes
  window.addEventListener('i18n-applied', () => {
    updateCharCount();
    if (currentRemindedAt) { updateReminderBtn(currentRemindedAt); } else { updateReminderBtn(null); }
  });
});

// 监听尺寸变化
window.transitionAPI.onSizeChanged((newSizeLevel) => {
  sizeLevel = newSizeLevel;
});

// 加载便签内容
async function loadNote() {
  try {
    const note = await window.transitionAPI.getNoteById(noteId);
    if (note) {
      popupTitle.value = note.title;
      popupTextarea.value = note.content;
      currentColor = note.color;
      colorBar.style.background = currentColor;
      applyNoteColor(currentColor);
      popupPane.style.setProperty('--mars-green', currentColor);
      updateColorDotIcon();
      updateCharCount();
      // 修复：保存提醒时间用于状态判断
      currentRemindedAt = note.reminded_at;
      currentRepeatReminder = note.repeat_reminder || 'none';
      updateReminderBtn(note.reminded_at);
      collapsedTitle.textContent = note.title || '';
    }
  } catch (e) {
    console.error('Failed to load note:', e);
  }
}

// 保存便签
let saveTimer;
async function saveNote() {
  if (!noteId || isComposing) return; // 拼音输入组合中跳过保存
  try {
    await window.transitionAPI.updateNote({
      id: noteId,
      title: popupTitle.value,
      content: popupTextarea.value,
      color: currentColor
    });
    collapsedTitle.textContent = popupTitle.value || '';
    // 通知主窗口刷新列表
    window.transitionAPI.notifyNoteSaved({ noteId });
  } catch (e) {
    console.error('Failed to save note:', e);
  }
}

// 更新字符计数
function updateCharCount() {
  const lines = popupTextarea.value.split('\n').length;
  charCount.textContent = `${Math.min(lines, 6)}/6 ${I18N.t('char_count')}`;
}

// 尺寸切换（等比例三档：280×200 → 560×400 → 840×600 → 循环）
sizeBtn.addEventListener('click', () => {
  if (windowId) {
    const nextLevel = (sizeLevel + 1) % popupSizes.length;
    const nextSize = popupSizes[nextLevel];
    window.transitionAPI.resizePopup({ windowId, width: nextSize.width, height: nextSize.height });
  }
});

// 置顶切换
pinBtn.addEventListener('click', () => {
  isTop = !isTop;
  pinBtn.classList.toggle('active', isTop);
  if (windowId) {
    window.transitionAPI.toggleAlwaysOnTop({ windowId, isTop });
  }
});

// 删除便签
deleteBtn.addEventListener('click', () => {
  if (confirm(I18N.t('confirm_delete'))) {
    if (windowId && noteId) {
      window.transitionAPI.deletePopupNote({ windowId, noteId });
    }
  }
});

// 关闭窗口
closeBtn.addEventListener('click', () => {
  window.transitionAPI.closeWindow();
});

// 折叠/展开
document.getElementById('popupHeader').addEventListener('dblclick', toggleCollapse);

function toggleCollapse() {
  if (isCollapsed) {
    expandWindow();
  } else {
    collapseWindow();
  }
}

function collapseWindow() {
  isCollapsed = true;
  popupPane.classList.add('collapsed');
  popupContent.style.display = 'none';
  popupCollapsed.style.display = 'flex';
  if (windowId) {
    window.transitionAPI.updatePopupCollapsed({ windowId, isCollapsed: true });
    // 通过 IPC 调整窗口高度（折叠高度约 40px：顶部栏36px + padding）
    window.transitionAPI.foldPopup({ windowId, isCollapsed: true, collapsedHeight: 40 });
  }
}

function expandWindow() {
  isCollapsed = false;
  popupPane.classList.remove('collapsed');
  popupContent.style.display = 'flex';
  popupCollapsed.style.display = 'none';
  if (windowId) {
    window.transitionAPI.updatePopupCollapsed({ windowId, isCollapsed: false });
    // 通过 IPC 恢复窗口原始高度
    window.transitionAPI.foldPopup({ windowId, isCollapsed: false });
  }
}

popupCollapsed.addEventListener('dblclick', expandWindow);

// 闪烁动画
window.transitionAPI.onTriggerFlash(() => {
  if (!isFlashing) {
    isFlashing = true;
    popupPane.classList.add('flashing');
    setTimeout(() => {
      popupPane.classList.remove('flashing');
      isFlashing = false;
    }, 5000);
  }
});

// 主题变化监听
window.transitionAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  const acc = document.documentElement.style.getPropertyValue('--mars-green').trim() || (theme === 'dark' ? '#8CB89A' : '#0FBAB2');
  applyThemeColors(theme, acc);
});
window.transitionAPI.onAccentColorChanged((data) => {
  if (data && data.color) {
    // Apply theme colors for glass/panel backgrounds, but do NOT override
    // the popup color bar - it follows the note's own color (currentColor)
    applyThemeColors(data.theme || document.documentElement.getAttribute('data-theme') || 'light', data.color);
  }
});



// ???
window.transitionAPI.onReminderUpdated(async () => {
  await loadPopupColorPalette();
  await loadNote();
});

// 提醒功能
const reminderBtn = document.getElementById('reminderBtn');
const reminderModal = document.getElementById('reminderModal');
const reminderDateInput = document.getElementById('reminderDate');
const reminderTimeInput = document.getElementById('reminderTime');
const saveReminderBtn = document.getElementById('saveReminder');
const cancelReminderBtn = document.getElementById('cancelReminder');
const clearReminderBtn = document.getElementById('clearReminder');
const reminderActiveInfo = document.getElementById('reminderActiveInfo');
const activeReminderTime = document.getElementById('activeReminderTime');
const activeReminderRepeat = document.getElementById('activeReminderRepeat');

let selectedRepeatType = 'none';

// 初始化日期输入为今天
function initReminderDate() {
  const now = new Date();
  reminderDateInput.value = now.toISOString().slice(0, 10);
  reminderTimeInput.value = '09:00';
}

// 填充已设置的提醒信息
function fillActiveReminderInfo(remindedAt) {
  if (remindedAt) {
    reminderActiveInfo.style.display = 'block';
    const dt = new Date(remindedAt.replace(' ', 'T'));
    activeReminderTime.textContent = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    activeReminderRepeat.textContent = currentRepeatReminder === 'none' ? '' :
      currentRepeatReminder === 'daily' ? I18N.t('daily') :
      currentRepeatReminder === 'weekly' ? I18N.t('weekly') :
      currentRepeatReminder === 'monthly' ? I18N.t('monthly') : '';
    if (activeReminderRepeat.textContent) {
      activeReminderRepeat.style.display = 'inline';
    } else {
      activeReminderRepeat.style.display = 'none';
    }
  } else {
    reminderActiveInfo.style.display = 'none';
  }
}

// 打开提醒弹窗
reminderBtn.addEventListener('click', () => {
  initReminderDate();
  selectedRepeatType = currentRepeatReminder;
  fillActiveReminderInfo(currentRemindedAt);
  updateRepeatBtns(selectedRepeatType);
  reminderModal.style.display = 'flex';
});

// 关闭弹窗
cancelReminderBtn.addEventListener('click', () => {
  reminderModal.style.display = 'none';
});

// 点击遮罩关闭
reminderModal.addEventListener('click', (e) => {
  if (e.target === reminderModal) {
    reminderModal.style.display = 'none';
  }
});

// 清除提醒
clearReminderBtn.addEventListener('click', async () => {
  if (noteId) {
    await window.transitionAPI.setReminder({ noteId, remindedAt: null, repeatType: 'none' });
    currentRemindedAt = null;
    currentRepeatReminder = 'none';
    updateReminderBtn(null);
    reminderActiveInfo.style.display = 'none';
    reminderModal.style.display = 'none';
  }
});

// 快捷选项点击
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const minutes = btn.dataset.minutes;
    const timePreset = btn.dataset.time;
    
    let targetDate = new Date();
    
    if (minutes) {
      // 相对时间：N分钟后
      targetDate = new Date(targetDate.getTime() + parseInt(minutes) * 60000);
    } else if (timePreset) {
      // 预设时间
      if (timePreset === 'today-18') {
        targetDate.setHours(18, 0, 0, 0);
      } else if (timePreset === 'tomorrow-9') {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(9, 0, 0, 0);
      } else if (timePreset === 'dayafter-9') {
        targetDate.setDate(targetDate.getDate() + 2);
        targetDate.setHours(9, 0, 0, 0);
      } else if (timePreset === 'next-monday-9') {
        const dayOfWeek = targetDate.getDay();
        const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilMonday);
        targetDate.setHours(9, 0, 0, 0);
      }
    }
    
    // 更新日期和时间输入
    reminderDateInput.value = targetDate.toISOString().slice(0, 10);
    reminderTimeInput.value = `${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}`;
  });
});

// 重复选项切换
document.querySelectorAll('.repeat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedRepeatType = btn.dataset.repeat;
    updateRepeatBtns(selectedRepeatType);
  });
});

function updateRepeatBtns(type) {
  document.querySelectorAll('.repeat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.repeat === type);
  });
}

// 保存提醒
saveReminderBtn.addEventListener('click', async () => {
  if (!noteId) return;
  
  const dateVal = reminderDateInput.value;
  const timeVal = reminderTimeInput.value;
  
  if (!dateVal || !timeVal) return;
  
  const dt = new Date(`${dateVal}T${timeVal}:00`);
  const isoStr = dt.toISOString().slice(0, 19).replace('T', ' ');
  
  await window.transitionAPI.setReminder({
    noteId,
    remindedAt: isoStr,
    repeatType: selectedRepeatType
  });
  
  currentRemindedAt = isoStr;
  currentRepeatReminder = selectedRepeatType;
  updateReminderBtn(isoStr);
  reminderModal.style.display = 'none';
});

function updateReminderBtn(remindedAt) {
  if (remindedAt) {
    reminderBtn.classList.add('has-reminder');
    const dt = new Date(remindedAt.replace(' ', 'T'));
    const dateStr = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    reminderBtn.textContent = `🔔 ${dateStr}`;
  } else {
    reminderBtn.classList.remove('has-reminder');
    reminderBtn.textContent = I18N.t('reminder_btn');
  }
}
// 颜色按钮与面板 ---
function updateColorDotIcon() {
  if (colorDotIcon) colorDotIcon.style.backgroundColor = currentColor;
}

async function loadPopupColorPalette() {
  try {
    popupColorPalette = await window.transitionAPI.getColorPalette();
  } catch (e) {
    console.error('Failed to load popup color palette:', e);
  }
}

function renderPopupColorPanel() {
  if (!popupColorGroups) return;
  if (!popupColorPalette || popupColorPalette.length === 0) {
    popupColorGroups.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">' + I18N.t('loading') + '</div>';
    return;
  }
  const groups = {};
  popupColorPalette.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });
  
  popupColorGroups.innerHTML = Object.entries(groups).map(([groupName, colors]) =>
    '<div class="popup-color-group">' +
    '<div class="popup-color-group-title">' + groupName + '</div>' +
    '<div class="popup-color-group-row">' +
    colors.map(c =>
      '<div class="popup-color-dot' + (c.color.toUpperCase() === currentColor.toUpperCase() ? ' active' : '') + '"' +
      ' data-color="' + c.color + '"' +
      ' style="background:' + c.color + '"' +
      ' title="' + c.name + '"' +
      '></div>'
    ).join('') +
    '</div></div>'
  ).join('');
  
  popupColorGroups.querySelectorAll('.popup-color-dot').forEach(dot => {
    dot.addEventListener('click', async () => {
      currentColor = dot.dataset.color;
      colorBar.style.background = currentColor;
      applyNoteColor(currentColor);
      updateColorDotIcon();
      renderPopupColorPanel();
      popupColorPanel.style.display = 'none';
      saveNote();
    });
  });
}

// ====== Color Button and Panel ======
colorBtn.addEventListener('click', () => {
  if (!popupColorPalette || popupColorPalette.length === 0) {
    // Palette not loaded yet, load it now
    window.transitionAPI.getColorPalette().then(function(p) {
      popupColorPalette = p;
      renderPopupColorPanel();
      popupColorPanel.style.display = 'flex';
    }).catch(function(e) {
      console.error('Failed to load palette:', e);
    });
  } else {
    renderPopupColorPanel();
    popupColorPanel.style.display = 'flex';
  }
});

popupColorPanelClose.addEventListener('click', () => {
  popupColorPanel.style.display = 'none';
});

popupColorPanel.addEventListener('click', (e) => {
  if (e.target === popupColorPanel) popupColorPanel.style.display = 'none';
});

// 字体同步 — 对齐 timeline.js，先设 body 靠继承驱动，再补 inline 强制覆盖
let globalFontFamily = 'Microsoft YaHei';

function applyPopupFont() {
  // 1. 设 body/html 让 font-family: inherit 的元素自动继承
  document.body.style.fontFamily = globalFontFamily + ', sans-serif';
  document.documentElement.style.fontFamily = globalFontFamily + ', sans-serif';
  // 2. 设 inline 确保 input/textarea 不受浏览器默认字体影响
  if (popupTitle) popupTitle.style.fontFamily = globalFontFamily + ', sans-serif';
  if (popupTextarea) popupTextarea.style.fontFamily = globalFontFamily + ', sans-serif';
  // 3. 强制触发布局重绘，解决透明 frameless 窗口样式变更不渲染的问题
  if (popupPane) {
    void popupPane.offsetHeight;
  }
}

// 暴露到 window 上，让主进程 executeJavaScript 也能调用
window.applyPopupFont = applyPopupFont;
window._popupFontFamily = globalFontFamily;

window.transitionAPI.onFontChanged((fontFamily) => {
  globalFontFamily = fontFamily;
  window._popupFontFamily = fontFamily;
  applyPopupFont();
});

// 事件监听
popupTitle.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 500);
});

popupTextarea.addEventListener('input', () => {
  updateCharCount();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 500);
});

// 中文输入法组合事件处理
popupTitle.addEventListener('compositionstart', () => {
  isComposing = true;
  clearTimeout(saveTimer);
});

popupTitle.addEventListener('compositionend', () => {
  isComposing = false;
  // 组合结束后手动触发一次保存
  saveNote();
});

popupTextarea.addEventListener('compositionstart', () => {
  isComposing = true;
  clearTimeout(saveTimer);
});

popupTextarea.addEventListener('compositionend', () => {
  isComposing = false;
  // 组合结束后手动触发一次保存
  saveNote();
});
