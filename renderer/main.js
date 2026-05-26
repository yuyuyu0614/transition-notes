let currentNoteId = null;
let allNotes = [];
let selectedColor = '#0FBAB2';
let selectedColorName = ''; // populated by getColorName or I18N
let isComposing = false;
let draggedNoteId = null;
let colorPalette = [];
let globalFontFamily = 'Segoe UI Variable';

const notesListEl = document.getElementById('notesList');
const noteTitleEl = document.getElementById('noteTitle');
const noteContentEl = document.getElementById('noteContent');
const newNoteBtn = document.getElementById('newNoteBtn');
const deleteBtn = document.getElementById('deleteBtn');
const saveBtn = document.getElementById('saveBtn');
const popupBtn = document.getElementById('popupBtn');

// 颜色选择器元素
const colorPickerTrigger = document.getElementById('colorPickerTrigger');
const currentColorDot = document.getElementById('currentColorDot');
const currentColorName = document.getElementById('currentColorName');
const colorPanel = document.getElementById('colorPanel');
const colorPanelClose = document.getElementById('colorPanelClose');
const colorGroups = document.getElementById('colorGroups');

// Top-level IPC listener (must be registered before any async init)
window.transitionAPI.onShowPrivacy(() => {
  window.transitionAPI.openPrivacy();
});


async function loadNotes() {
  try {
    allNotes = await window.transitionAPI.getAllNotes();
    renderNotesList();
    if (allNotes.length > 0 && !currentNoteId) {
      selectNote(allNotes[0].id);
    } else if (allNotes.length === 0) {
      clearEditor();
    }
  } catch (e) {
    console.error('Failed to load notes:', e);
  }
}

function renderNotesList() {
  notesListEl.innerHTML = '';
  
  if (allNotes.length === 0) {
    notesListEl.innerHTML = '<div class="empty-hint" data-i18n="no_notes">' + I18N.t('no_notes') + '</div>';
    toggleEditorControls(false);
    return;
  }
  toggleEditorControls(true);
  
  toggleEditorControls(true);
  allNotes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card' + (String(note.id) === String(currentNoteId) ? ' active' : '');
    card.style.borderLeftColor = note.color;
    card.dataset.noteId = note.id;
    card.draggable = true;
    card.innerHTML = '<div class="note-card-drag-handle" title="" data-i18n-title="drag_to_reorder"></div>' +
      '<div class="note-card-content">' +
      '<div class="note-card-title" style="font-family: \'' + globalFontFamily + '\', sans-serif">' + escapeHtml(note.title || I18N.t('app_name')) + '</div>' +
      '<div class="note-card-preview">' + escapeHtml(note.content ? note.content.substring(0, 30) : '') + '</div>' +
      '</div>';
    
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.note-card-drag-handle')) {
        selectNote(note.id);
      }
    });
    
    card.addEventListener('dragstart', (e) => {
      draggedNoteId = note.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', note.id);
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedNoteId = null;
      document.querySelectorAll('.note-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedNoteId !== note.id) card.classList.add('drag-over');
    });
    
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (draggedNoteId && draggedNoteId !== note.id) reorderNotes(draggedNoteId, note.id);
    });
    
    notesListEl.appendChild(card);
  });
}

async function reorderNotes(fromId, toId) {
  const fromIndex = allNotes.findIndex(n => String(n.id) === String(fromId));
  const toIndex = allNotes.findIndex(n => String(n.id) === String(toId));
  if (fromIndex === -1 || toIndex === -1) return;
  
  // 移动数组元素
  const [movedNote] = allNotes.splice(fromIndex, 1);
  allNotes.splice(toIndex, 0, movedNote);
  
  // 重新计算所有便签的 sort_order（索引 * 1000，留间隔）
  const orderArray = allNotes.map((note, index) => ({
    id: note.id,
    sort_order: (index + 1) * 1000
  }));
  
  // 持久化到数据库
  try {
    await window.transitionAPI.reorderNotes(orderArray);
  } catch (e) {
    console.error('Failed to persist reorder:', e);
  }
  
  // 刷新列表以获取数据库中的最新顺序
  const prevNoteId = currentNoteId;
  await loadNotes();
  if (prevNoteId) {
    currentNoteId = prevNoteId;
  }
  renderNotesList();
  const activeCard = notesListEl.querySelector('[data-note-id="' + currentNoteId + '"]');
  if (activeCard) activeCard.classList.add('active');
}

function selectNote(id) {
  if (currentNoteId && currentNoteId !== id) saveCurrentNote(true);
  currentNoteId = id;
  const note = allNotes.find(n => String(n.id) === String(id));
  if (note) {
    noteTitleEl.value = note.title;
    noteContentEl.value = note.content;
    selectedColor = note.color;
    selectedColorName = getColorName(note.color);
    updateColorPickerDisplay();
    deleteBtn.disabled = false;
    saveBtn.disabled = false;
  }
  renderNotesList();
}

function clearEditor() {
  currentNoteId = null;
  noteTitleEl.value = '';
  noteContentEl.value = '';
  selectedColor = '#0FBAB2';
  selectedColorName = I18N.t('mars_green');
  updateColorPickerDisplay();
  deleteBtn.disabled = true;
  saveBtn.disabled = true;
  renderNotesList();
}

function toggleEditorControls(visible) {
  var els = document.querySelectorAll('.editor-only');
  for (var i = 0; i < els.length; i++) els[i].style.display = visible ? '' : 'none';
  noteContentEl.disabled = !visible;
  noteContentEl.placeholder = visible ? '' : I18N.t('empty_hint');
  var hint = document.getElementById('emptyStateHint');
  if (hint) hint.style.display = visible ? 'none' : 'flex';
  if (visible) { noteTitleEl.disabled = false; } else { noteTitleEl.value = ''; noteTitleEl.disabled = true; }
}

async function createNewNote() {
  try {
    const newNote = await window.transitionAPI.createNote({
      title: '', content: '', color: selectedColor
    });
    await loadNotes();
    if (newNote && newNote.id) selectNote(newNote.id);
  } catch (e) {
    console.error('Failed to create note:', e);
  }
}

let saveTimer;
let isSaving = false;
async function saveCurrentNote(silent = false) {
  if (!currentNoteId || isSaving || isComposing) return;
  isSaving = true;
  try {
    await window.transitionAPI.updateNote({
      id: currentNoteId, title: noteTitleEl.value,
      content: noteContentEl.value, color: selectedColor
    });
    if (!silent) await loadNotes();
  } catch (e) {
    console.error('Failed to save note:', e);
  } finally {
    isSaving = false;
  }
}

async function deleteCurrentNote() {
  if (!currentNoteId) return;
  if (!confirm(I18N.t('confirm_delete'))) return;
  try {
    await window.transitionAPI.deleteNote(currentNoteId);
    await loadNotes();
    clearEditor();
  } catch (e) {
    console.error('Failed to delete note:', e);
  }
}

// --- 颜色选择器 ---
function getColorName(hex) {
  const found = colorPalette.find(c => c.color.toUpperCase() === hex.toUpperCase());
  return found ? found.name : hex;
}

function updateColorPickerDisplay() {
  currentColorDot.style.backgroundColor = selectedColor;
  currentColorName.textContent = selectedColorName;
  // Update active state in panel
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color.toUpperCase() === selectedColor.toUpperCase());
  });
}

async function loadColorPalette() {
  try {
    colorPalette = await window.transitionAPI.getColorPalette();
    renderColorPanel();
  } catch (e) {
    console.error('Failed to load color palette:', e);
  }
}

function renderColorPanel() {
  // Group colors
  const groups = {};
  colorPalette.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });
  
  colorGroups.innerHTML = Object.entries(groups).map(([groupName, colors]) => 
    '<div class="color-group">' +
    '<div class="color-group-title">' + groupName + '</div>' +
    '<div class="color-group-row">' +
    colors.map(c => '<div class="color-dot' + (c.color.toUpperCase() === selectedColor.toUpperCase() ? ' active' : '') + '"' +
      ' data-color="' + c.color + '"' +
      ' data-name="' + c.name + '"' +
      ' style="background:' + c.color + '"' +
      ' title="' + c.name + '"' +
      '></div>').join('') +
    '</div></div>'
  ).join('');
  
  // Bind click events
  colorGroups.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', async () => {
      selectedColor = dot.dataset.color;
      selectedColorName = dot.dataset.name;
      updateColorPickerDisplay();
      colorPanel.style.display = 'none';
      if (currentNoteId) {
        await saveCurrentNote();
        await loadNotes();
        window.transitionAPI.updatePopupColor({ noteId: currentNoteId, color: selectedColor });
      }
    });
  });
}

// 打开颜色面板
colorPickerTrigger.addEventListener('click', () => {
  colorPanel.style.display = 'flex';
  renderColorPanel();
});

// 关闭颜色面板
colorPanelClose.addEventListener('click', () => {
  colorPanel.style.display = 'none';
});

colorPanel.addEventListener('click', (e) => {
  if (e.target === colorPanel) colorPanel.style.display = 'none';
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 事件绑定
newNoteBtn.addEventListener('click', createNewNote);
deleteBtn.addEventListener('click', deleteCurrentNote);
saveBtn.addEventListener('click', async () => { await saveCurrentNote(false); });
popupBtn.addEventListener('click', () => { window.transitionAPI.createPopup(currentNoteId); });

// 自动保存
noteTitleEl.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 500); });
noteContentEl.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentNote, 500); });

noteTitleEl.addEventListener('compositionstart', () => { isComposing = true; clearTimeout(saveTimer); });
noteTitleEl.addEventListener('compositionend', () => { isComposing = false; saveCurrentNote(); });
noteContentEl.addEventListener('compositionstart', () => { isComposing = true; clearTimeout(saveTimer); });
noteContentEl.addEventListener('compositionend', () => { isComposing = false; saveCurrentNote(); });

// 窗口控制
document.getElementById('minimizeBtn').addEventListener('click', () => window.transitionAPI.minimizeWindow());
document.getElementById('maximizeBtn').addEventListener('click', () => window.transitionAPI.maximizeWindow());
document.getElementById('closeBtn').addEventListener('click', () => window.transitionAPI.hideWindow());
document.getElementById('settingsBtn').addEventListener('click', () => window.transitionAPI.openSettings());
document.getElementById('avatarBtn').addEventListener('click', () => window.transitionAPI.openSettings());
document.getElementById('privacyBtn').addEventListener('click', () => window.transitionAPI.openPrivacy());
document.getElementById('aboutBtn').addEventListener('click', () => window.transitionAPI.openAbout());

window.transitionAPI.onWindowMaximized((isMaximized) => {
  document.getElementById('maximizeBtn').classList.toggle('is-maximized', isMaximized);
});

window.transitionAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  const acc = document.documentElement.style.getPropertyValue('--mars-green').trim() || (theme === 'dark' ? '#8CB89A' : '#0FBAB2');
  applyThemeColors(theme, acc);
})
window.transitionAPI.onAccentColorChanged((data) => {
  if (data && data.color) {
    document.documentElement.style.setProperty('--mars-green', data.color);
    applyThemeColors(data.theme || document.documentElement.getAttribute('data-theme') || 'light', data.color);
  }
});

// 字体变化监听
window.transitionAPI.onFontChanged((fontFamily) => {
  globalFontFamily = fontFamily;
  applyGlobalFont();
});

function applyGlobalFont() {
  noteTitleEl.style.fontFamily = globalFontFamily + ', sans-serif';
  noteContentEl.style.fontFamily = globalFontFamily + ', sans-serif';
  // Also update card titles
  document.querySelectorAll('.note-card-title').forEach(el => {
    el.style.fontFamily = globalFontFamily + ', sans-serif';
  });
}

// 小窗保存便签后刷新列表
window.transitionAPI.onNotesChanged(async () => {
  const prevNoteId = currentNoteId;
  await loadNotes();
  if (prevNoteId) {
    const stillExists = allNotes.some(n => String(n.id) === String(prevNoteId));
    if (stillExists) {
      currentNoteId = prevNoteId;
      const note = allNotes.find(n => String(n.id) === String(prevNoteId));
      if (note) {
        noteTitleEl.value = note.title;
        noteContentEl.value = note.content;
        selectedColor = note.color;
        selectedColorName = getColorName(note.color);
        updateColorPickerDisplay();
        deleteBtn.disabled = false;
        saveBtn.disabled = false;
      }
    } else {
      clearEditor();
    }
  }
  renderNotesList();
});

window.transitionAPI.onSelectNote(async (noteId) => {
  await loadNotes();
  if (noteId) selectNote(noteId);
});

async function init() {
  // Register IPC listeners SYNCHRONOUSLY before any async ops,
  // Listeners registered synchronously before async init
  // onShowPrivacy already registered at module top level (line 27)

  window.transitionAPI.onLanguageChanged(async (newLang) => {
    await I18N.init(newLang);
  });

  // Re-render dynamic content when i18n is applied
  window.addEventListener('i18n-applied', () => {
    renderNotesList();
    if (currentNoteId) {
      const note = allNotes.find(n => String(n.id) === String(currentNoteId));
      if (note) {
        selectNote(note.id);
        noteTitleEl.value = note.title;
        noteContentEl.value = note.content;
      }
    }
  });

const settings = await window.transitionAPI.getAppSettings();
  // Apply accent color from saved settings
  const initTheme = settings.theme || 'light';
  const initAccent = initTheme === 'dark' ? (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2');
  document.documentElement.style.setProperty('--mars-green', initAccent);
  applyThemeColors(initTheme, initAccent);
  if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
  if (settings.fontFamily) {
    globalFontFamily = settings.fontFamily;
    applyGlobalFont();
  }
  // Initialize i18n
  const lang = settings.language || 'zh-CN';
  await I18N.init(lang);
  updateColorPickerDisplay();
  await loadColorPalette();
  loadNotes();

  // Re-render dynamic content when i18n is applied
  window.addEventListener('i18n-applied', () => {
    renderNotesList();
    if (currentNoteId) {
      const note = allNotes.find(n => String(n.id) === String(currentNoteId));
      if (note) {
        selectNote(note.id);
        noteTitleEl.value = note.title;
        noteContentEl.value = note.content;
      }
    }
  });
}


// ====== Password Protection ======
window.transitionAPI.onPasswordPrompt(async (data) => {
  const overlay = document.getElementById('passwordOverlay');
  const input = document.getElementById('passwordInput');
  const errorEl = document.getElementById('passwordError');
  const unlockBtn = document.getElementById('passwordUnlockBtn');

  if (!overlay) return;
  overlay.style.display = 'flex';
  input.focus();

  const tryUnlock = async () => {
    const pw = input.value;
    if (!pw) return;
    const ok = await window.transitionAPI.verifyMainPassword(pw);
    if (ok) {
      overlay.style.display = 'none';
      window.transitionAPI.notifyPasswordUnlock();
    } else {
      errorEl.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };

  unlockBtn.addEventListener('click', tryUnlock);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
});

init();