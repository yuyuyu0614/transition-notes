let currentSettings = {};
let currentFontFamily = 'Segoe UI Variable';
let systemFonts = [];
let importedFonts = [];
let colorPalette = [];
let currentEditingColorKey = 'lightColor';

// Suppress errors for missing elements during initial parse
function $(id) { return document.getElementById(id); }

// ====== Load Settings ======
async function loadSettings() {
  try {
    currentSettings = await window.transitionAPI.getAppSettings();
    currentFontFamily = currentSettings.fontFamily || 'Segoe UI Variable';

    const fontsData = await window.transitionAPI.getAvailableFonts();
    systemFonts = fontsData.system || [];
    importedFonts = fontsData.imported || [];

    $('currentFontName').textContent = currentFontFamily;
    $('privacyLevel').value = currentSettings.privacyLevel || 'none';
    $('autoLaunch').checked = currentSettings.autoLaunch || false;
    $('soundEnabled').checked = currentSettings.soundEnabled !== false;

    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentSettings.theme);
    });

    const passwordSection = $('passwordSection');
    if (currentSettings.privacyLevel !== 'none') {
      passwordSection.style.display = 'flex';
    }

    await loadColorPalette();
    renderFontGrids();
    updateSwatchDisplay();
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// ====== Save Setting ======
async function saveSetting(key, value) {
  try {
    await window.transitionAPI.saveAppSetting({ key, value });
    currentSettings[key] = value;
  } catch (e) {
    console.error('Failed to save setting:', e);
  }
}

// ====== Font Rendering ======
function renderFontGrids() {
  const systemGrid = $('systemFontGrid');
  systemGrid.innerHTML = systemFonts.map(font => {
    const isActive = font === currentFontFamily;
    return '<div class="font-card' + (isActive ? ' active' : '') + '" data-font="' + font + '" style="font-family:' + String.fromCharCode(39) + font + String.fromCharCode(39) + ', sans-serif">' + font + '</div>';
  }).join('');

  const importedGrid = $('importedFontGrid');
  if (importedFonts.length === 0) {
    importedGrid.innerHTML = '<div class="font-empty-hint" id="importedEmptyHint" data-i18n="no_imported_fonts">暂无导入字体</div>';
  } else {
    importedGrid.innerHTML = importedFonts.map(font => {
      const isActive = font === currentFontFamily;
      return '<div class="font-card' + (isActive ? ' active' : '') + '" data-font="' + font + '" data-imported="true" style="font-family:' + String.fromCharCode(39) + font + String.fromCharCode(39) + ', sans-serif">' + font + '</div>';
    }).join('');
  }

  document.querySelectorAll('.font-card').forEach(card => {
    card.addEventListener('click', async () => {
      await selectFont(card.dataset.font);
    });
  });
}

async function selectFont(fontFamily) {
  try {
    await window.transitionAPI.updateGlobalFont(fontFamily);
    currentFontFamily = fontFamily;
    $('currentFontName').textContent = fontFamily;
    document.querySelectorAll('.font-card').forEach(card => {
      card.classList.toggle('active', card.dataset.font === fontFamily);
    });
  } catch (e) {
    console.error('Failed to select font:', e);
  }
}

// ====== Accent Color Helpers ======
function getColorName(hex) {
  const found = colorPalette.find(c => c.color.toLowerCase() === hex.toLowerCase());
  return found ? found.name : hex;
}

function updateSwatchDisplay() {
  const lc = currentSettings.lightColor || '#0FBAB2';
  const dc = currentSettings.darkColor || '#8CB89A';
  const ld = $('lightColorDot');
  const dd = $('darkColorDot');
  const ln = $('lightColorName');
  const dn = $('darkColorName');
  if (ld) ld.style.backgroundColor = lc;
  if (dd) dd.style.backgroundColor = dc;
  if (ln) ln.textContent = getColorName(lc);
  if (dn) dn.textContent = getColorName(dc);
}

async function loadColorPalette() {
  try {
    colorPalette = await window.transitionAPI.getColorPalette();
  } catch (e) {
    console.error('Failed to load color palette:', e);
  }
}

function openColorPanel(colorKey) {
  if (!colorPalette || colorPalette.length === 0) return;
  currentEditingColorKey = colorKey;
  renderAccentColorPanel();
  const panel = $('accentColorPanel');
  if (panel) panel.style.display = 'flex';
}

function closeColorPanel() {
  const panel = $('accentColorPanel');
  if (panel) panel.style.display = 'none';
}

function renderAccentColorPanel() {
  const groups = {};
  colorPalette.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const currentColor = currentSettings[currentEditingColorKey] ||
    (currentEditingColorKey === 'lightColor' ? '#0FBAB2' : '#8CB89A');

  let html = '';
  for (const [groupName, colors] of Object.entries(groups)) {
    html += '<div class="color-group"><div class="color-group-title">' + escHtml(groupName) + '</div><div class="color-group-row">';
    colors.forEach(c => {
      const activeClass = c.color.toLowerCase() === currentColor.toLowerCase() ? ' active' : '';
      html += '<div class="color-dot' + activeClass + '" data-color="' + c.color + '" data-name="' + escHtml(c.name) + '" style="background-color:' + c.color + ';" title="' + escHtml(c.name) + '"></div>';
    });
    html += '</div></div>';
  }
  const groupsEl = $('accentColorGroups');
  if (!groupsEl) return;
  groupsEl.innerHTML = html;

  groupsEl.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => selectAccentColor(dot.dataset.color, dot.dataset.name));
  });
}

async function selectAccentColor(color, name) {
  await saveSetting(currentEditingColorKey, color);
  currentSettings[currentEditingColorKey] = color;
  updateSwatchDisplay();
  closeColorPanel();
}

function escHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ====== Language ======
function highlightActiveLang(lang) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

// ====== Init (run after DOM ready) ======
async function init() {

  try {

    const settings = await window.transitionAPI.getAppSettings();

    if (settings.theme) {

      document.documentElement.setAttribute('data-theme', settings.theme);

    }

    // Apply accent color

    const isDark = settings.theme === 'dark';

    document.documentElement.style.setProperty('--mars-green', isDark ? (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2'));



    const accent = settings.theme === 'dark' ? (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2');

    applyThemeColors(settings.theme || 'light', accent);

    const lang = settings.language || 'zh-CN';

    await I18N.init(lang);

    highlightActiveLang(lang);



    await loadColorPalette();

    await loadSettings();



    // ====== EVENT LISTENERS (safe: DOM is ready) ======



    // Close button

    const closeBtn = document.getElementById('closeBtn');

    if (closeBtn) closeBtn.addEventListener('click', () => { window.transitionAPI.closeWindow(); });



    // Theme buttons

    document.querySelectorAll('.theme-btn').forEach(btn => {

      btn.addEventListener('click', async () => {

        const theme = btn.dataset.theme;

        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));

        btn.classList.add('active');

        await saveSetting('theme', theme);

      });

    });



    // Language buttons

    document.querySelectorAll('.lang-btn').forEach(btn => {

      btn.addEventListener('click', async () => {

        const lang = btn.dataset.lang;

        await saveSetting('language', lang);

        await I18N.init(lang);

        highlightActiveLang(lang);

      });

    });



    // Privacy level

    const privacyLevel = document.getElementById('privacyLevel');

    if (privacyLevel) {

      privacyLevel.addEventListener('change', async (e) => {

        const level = e.target.value;

        const pwSection = document.getElementById('passwordSection');

        if (pwSection) pwSection.style.display = level !== 'none' ? 'flex' : 'none';

        await saveSetting('privacyLevel', level);

      });

    }



    // Save password

    const savePwBtn = document.getElementById('savePasswordBtn');

    if (savePwBtn) {

      savePwBtn.addEventListener('click', async () => {

        const pw = document.getElementById('mainPassword').value;

        const confirm = document.getElementById('confirmPassword').value;

        if (pw !== confirm) { alert(I18N.t('password_mismatch')); return; }

        if (pw.length < 4) { alert(I18N.t('password_too_short')); return; }

        await saveSetting('mainPassword', pw);

        document.getElementById('mainPassword').value = '';

        document.getElementById('confirmPassword').value = '';

      });

    }



    // Auto launch

    const autoLaunch = document.getElementById('autoLaunch');

    if (autoLaunch) autoLaunch.addEventListener('change', async (e) => { await saveSetting('autoLaunch', e.target.checked); });



    // Sound enabled

    const sound = document.getElementById('soundEnabled');

    if (sound) sound.addEventListener('change', async (e) => { await saveSetting('soundEnabled', e.target.checked); });



    // Import font

    const importBtn = document.getElementById('importFontBtn');

    if (importBtn) {

      importBtn.addEventListener('click', async () => {

        const input = document.createElement('input');

        input.type = 'file';

        input.accept = '.ttf,.otf';

        input.style.display = 'none';

        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {

          const file = e.target.files[0];

          if (!file) { document.body.removeChild(input); return; }

          try {

            const result = await window.transitionAPI.importFont(file.path);

            if (result.success) {

              const fontsData = await window.transitionAPI.getAvailableFonts();

              systemFonts = fontsData.system || [];

              importedFonts = fontsData.imported || [];

              renderFontGrids();

              await selectFont(result.fontName);

            }

          } catch (err) { console.error('Import error:', err); }

          document.body.removeChild(input);

        });

        input.click();

      });

    }



    // Accent color swatches

    const lcs = lightColorSwatch;

    const dcs = darkColorSwatch;

    if (lcs) lcs.addEventListener('click', () => openColorPanel('lightColor'));

    if (dcs) dcs.addEventListener('click', () => openColorPanel('darkColor'));



    // Color panel close

    const accClose = accentColorPanelClose;

    const accPanel = accentColorPanel;

    if (accClose) accClose.addEventListener('click', closeColorPanel);

    if (accPanel) accPanel.addEventListener('click', (e) => { if (e.target === accPanel) closeColorPanel(); });



    // Feedback button

    const fbBtn = document.getElementById('feedbackBtn');

    if (fbBtn) fbBtn.addEventListener('click', () => { window.transitionAPI.openFeedback(); });

  } catch (err) {

    console.error('[Settings] init failed:', err);

  }



  // ---- Listeners that must bind even if init partially fails ----



  // Theme changed listener

  window.transitionAPI.onThemeChanged((theme) => {

    document.documentElement.setAttribute('data-theme', theme);

    const accent = theme === 'dark' ? (currentSettings.darkColor || '#8CB89A') : (currentSettings.lightColor || '#0FBAB2');

    document.documentElement.style.setProperty('--mars-green', accent);

    applyThemeColors(theme, accent);

    updateSwatchDisplay();

  });



  // Accent color changed listener

  window.transitionAPI.onAccentColorChanged((data) => {

    if (data && data.color) {

      document.documentElement.style.setProperty('--mars-green', data.color);

      applyThemeColors(data.theme || document.documentElement.getAttribute('data-theme') || 'light', data.color);

      currentSettings = currentSettings || {};

      if (data.theme === 'dark') currentSettings.darkColor = data.color;

      else currentSettings.lightColor = data.color;

      updateSwatchDisplay();

    }

  });



  // Font changed listener

  window.transitionAPI.onFontChanged((fontFamily) => {

    currentFontFamily = fontFamily;

    const cfn = currentFontName;

    if (cfn) cfn.textContent = fontFamily;

    document.querySelectorAll('.font-card').forEach(card => {

      card.classList.toggle('active', card.dataset.font === fontFamily);

    });

  });



  // Language changed listener

    window.addEventListener('i18n-applied', () => {
    renderFontGrids();
    highlightActiveLang(I18N.currentLang);
  });

  window.transitionAPI.onLanguageChanged(async (newLang) => {

    await I18N.init(newLang);

    highlightActiveLang(newLang);

  });

}



init();

