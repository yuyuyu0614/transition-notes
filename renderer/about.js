// About window logic
async function init() {
  try {
    const settings = await window.transitionAPI.getAppSettings();
    const lang = settings.language || 'zh-CN';
    await I18N.init(lang);
    if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
    const accent = document.documentElement.getAttribute('data-theme') === 'dark' ?
      (settings.darkColor || '#8CB89A') : (settings.lightColor || '#0FBAB2');
    document.documentElement.style.setProperty('--mars-green', accent);
  } catch (e) {
    console.error('About i18n init failed:', e);
  }
}

init();
window.transitionAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
});
window.transitionAPI.onAccentColorChanged((data) => {
  if (data && data.color) {
    document.documentElement.style.setProperty('--mars-green', data.color);
  }
});

window.transitionAPI.onFontChanged((fontFamily) => {
  document.body.style.fontFamily = fontFamily + ', sans-serif';
  document.querySelectorAll('*').forEach(function(el) {
    el.style.fontFamily = fontFamily + ', sans-serif';
  });
});
