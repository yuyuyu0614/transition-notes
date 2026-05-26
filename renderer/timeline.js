let allNotes = [];
let filterColor = '';
let searchKeyword = '';
let timelineColorPalette = [];

const timelineContent = document.getElementById('timelineContent');
const searchInput = document.getElementById('searchInput');

async function loadNotes() {
  try {
    allNotes = await window.transitionAPI.getTimelineNotes();
    renderTimeline();
  } catch (e) { console.error('Failed to load notes:', e); }
}

function renderTimeline() {
  let filtered = allNotes;
  if (filterColor) filtered = filtered.filter(n => n.color === filterColor);
  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase();
    filtered = filtered.filter(n =>
      (n.title && n.title.toLowerCase().includes(kw)) ||
      (n.content && n.content.toLowerCase().includes(kw))
    );
  }

  if (filtered.length === 0) {
    timelineContent.innerHTML = '<div class="empty-state"><div class="icon">📑</div><p>' + I18N.t('no_notes') + '</p></div>';
    return;
  }

  const groups = groupByDate(filtered);
  let html = '';
  if (groups.today.length > 0) html += renderGroup(I18N.t('today'), groups.today);
  if (groups.yesterday.length > 0) html += renderGroup(I18N.t('yesterday'), groups.yesterday);
  if (groups.thisWeek.length > 0) html += renderGroup(I18N.t('this_week'), groups.thisWeek);
  if (groups.older.length > 0) html += renderGroup(I18N.t('earlier'), groups.older);
  timelineContent.innerHTML = html;

  document.querySelectorAll('.timeline-card').forEach(card => {
    card.addEventListener('click', () => {
      const noteId = card.dataset.id;
      window.transitionAPI.openNoteInMain(noteId);
    });
  });
}

function groupByDate(notes) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24*60*60*1000);
  const weekAgo = new Date(today.getTime() - 7*24*60*60*1000);
  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
  notes.forEach(note => {
    const date = new Date(note.updated_at.replace(' ', 'T'));
    if (date >= today) groups.today.push(note);
    else if (date >= yesterday) groups.yesterday.push(note);
    else if (date >= weekAgo) groups.thisWeek.push(note);
    else groups.older.push(note);
  });
  return groups;
}

function renderGroup(title, notes) {
  let html = '<div class="time-group"><div class="time-group-title">' + title + '</div><div class="time-cards">';
  notes.forEach(note => {
    const preview = note.content ? note.content.substring(0, 100) : '';
    const time = formatTime(note.updated_at);
    html += '<div class="timeline-card" data-id="' + note.id + '" style="border-left-color:' + note.color + '">' +
      '<div class="timeline-card-title">' +
      '<span class="color-dot" style="background:' + note.color + '"></span>' +
      escapeHtml(note.title || '') + '</div>' +
      '<div class="timeline-card-preview">' + escapeHtml(preview) + '</div>' +
      '<div class="timeline-card-meta"><span>' + time + '</span></div></div>';
  });
  html += '</div></div>';
  return html;
}

function formatTime(datetime) {
  const date = new Date(datetime.replace(' ', 'T'));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return month + '/' + day + ' ' + hours + ':' + minutes;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ====== Color Filter Panel ======
const filterMoreBtn = document.getElementById('filterMoreBtn');
const filterColorPanel = document.getElementById('filterColorPanel');
const filterColorPanelClose = document.getElementById('filterColorPanelClose');
const filterColorGroups = document.getElementById('filterColorGroups');
const filterColorsDynamic = document.getElementById('filterColorsDynamic');

async function loadTimelineColorPalette() {
  try {
    timelineColorPalette = await window.transitionAPI.getColorPalette();
    renderDynamicFilterDots();
  } catch (e) {
    console.error('Failed to load timeline palette:', e);
  }
}

function renderDynamicFilterDots() {
  if (!filterColorsDynamic) return;
  // Show first 8 unique colors inline
  const seen = new Set();
  const unique = [];
  timelineColorPalette.forEach(c => {
    if (!seen.has(c.color)) { seen.add(c.color); unique.push(c); }
  });
  const show = unique.slice(0, 8);
  filterColorsDynamic.innerHTML = show.map(c =>
    '<div class="filter-option' + (c.color === filterColor ? ' active' : '') + '" data-color="' + c.color + '" style="background:' + c.color + '" title="' + c.name + '"></div>'
  ).join('');

  filterColorsDynamic.querySelectorAll('.filter-option').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.filter-option').forEach(o => o.classList.remove('active'));
      dot.classList.add('active');
      filterColor = dot.dataset.color;
      renderTimeline();
    });
  });
}

function openFilterColorPanel() {
  renderFilterColorPanel();
  filterColorPanel.style.display = 'flex';
}

function closeFilterColorPanel() {
  filterColorPanel.style.display = 'none';
}

function renderFilterColorPanel() {
  const groups = {};
  timelineColorPalette.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  filterColorGroups.innerHTML = Object.entries(groups).map(([groupName, colors]) =>
    '<div class="color-group"><div class="color-group-title">' + groupName + '</div><div class="color-group-row">' +
    colors.map(c =>
      '<div class="color-dot' + (c.color === filterColor ? ' active' : '') + '" data-color="' + c.color + '" style="background:' + c.color + '" title="' + c.name + '"></div>'
    ).join('') +
    '</div></div>'
  ).join('');

  filterColorGroups.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      filterColor = dot.dataset.color;
      renderDynamicFilterDots();
      renderTimeline();
      closeFilterColorPanel();
    });
  });
}

filterMoreBtn.addEventListener('click', openFilterColorPanel);
filterColorPanelClose.addEventListener('click', closeFilterColorPanel);
filterColorPanel.addEventListener('click', (e) => {
  if (e.target === filterColorPanel) closeFilterColorPanel();
});

// Search
searchInput.addEventListener('input', () => {
  searchKeyword = searchInput.value.trim();
  renderTimeline();
});

// "All" filter option
document.querySelector('.filter-option[data-color=""]').addEventListener('click', function() {
  document.querySelectorAll('.filter-option').forEach(o => o.classList.remove('active'));
  this.classList.add('active');
  filterColor = '';
  renderTimeline();
});

// Window close
document.getElementById('closeBtn').addEventListener('click', () => {
  window.transitionAPI.closeWindow();
});

// Theme
window.transitionAPI.onFontChanged((fontFamily) => {
  document.body.style.fontFamily = fontFamily + ', sans-serif';
  document.querySelectorAll('.timeline-card-title').forEach(function(el) {
    el.style.fontFamily = fontFamily + ', sans-serif';
  });
});

window.transitionAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  const acc = document.documentElement.style.getPropertyValue('--mars-green').trim() || (theme === 'dark' ? '#8CB89A' : '#0FBAB2');
  applyThemeColors(theme, acc);
});
window.transitionAPI.onAccentColorChanged((data) => {
  if (data && data.color) {
    document.documentElement.style.setProperty('--mars-green', data.color);
    applyThemeColors(data.theme || document.documentElement.getAttribute('data-theme') || 'light', data.color);
  }
});

window.transitionAPI.onNotesChanged(async () => {
  await loadNotes();
});

async function init() {
  const settings = await window.transitionAPI.getAppSettings();
  if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
  if (settings.fontFamily) {
    document.body.style.fontFamily = settings.fontFamily + ', sans-serif';
    document.querySelectorAll('.timeline-card-title').forEach(function(el) {
      el.style.fontFamily = settings.fontFamily + ', sans-serif';
    });
  }
  const accInit = settings.theme === 'dark' ? (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2');
  applyThemeColors(settings.theme || 'light', accInit);
  const lang = settings.language || 'zh-CN';
  await I18N.init(lang);
  await loadTimelineColorPalette();
  loadNotes();

  window.transitionAPI.onLanguageChanged(async (newLang) => {
    await I18N.init(newLang);
  });

  window.addEventListener('i18n-applied', () => { loadNotes(); });
}

init();