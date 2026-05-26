// Shared theme utilities for all renderer windows
// Replaces duplicated applyThemeColors across popup.js, main.js, settings.js, timeline.js, privacy.js

function applyThemeColors(theme, hex) {
  const root = document.documentElement;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  root.style.setProperty('--mars-r', r);
  root.style.setProperty('--mars-g', g);
  root.style.setProperty('--mars-b', b);

  if (theme === 'dark') {
    root.style.setProperty('--glass-bg', 'rgba(' + Math.floor(r*0.25) + ',' + Math.floor(g*0.25) + ',' + Math.floor(b*0.25) + ', 0.72)');
    root.style.setProperty('--panel-bg', 'rgba(' + Math.floor(r*0.30 + 10) + ',' + Math.floor(g*0.30 + 10) + ',' + Math.floor(b*0.30 + 10) + ', 0.82)');
    root.style.setProperty('--text-primary', '#F0F0F0'); root.style.setProperty('--text-shadow', '0 1px 2px rgba(0,0,0,0.4)');
    root.style.setProperty('--text-secondary', '#B0B0B0');
  } else {
    root.style.setProperty('--glass-bg', 'rgba(' + r + ',' + g + ',' + b + ', 0.68)');
    root.style.setProperty('--panel-bg', 'rgba(' + Math.floor(r*0.35 + 165) + ',' + Math.floor(g*0.35 + 165) + ',' + Math.floor(b*0.35 + 165) + ', 0.78)');
    root.style.setProperty('--text-primary', '#1a2a38'); root.style.setProperty('--text-shadow', '0 1px 2px rgba(255,255,255,0.35)');
    root.style.setProperty('--text-secondary', '#4a5c6e');
  }
  // Update all window control button backgrounds
  const alpha03 = 'rgba(' + r + ',' + g + ',' + b + ', 0.3)';
  const alpha05 = 'rgba(' + r + ',' + g + ',' + b + ', 0.5)';
  const alpha02 = 'rgba(' + r + ',' + g + ',' + b + ', 0.2)';
  document.querySelectorAll('.win-btn, .title-btn').forEach(function(btn) {
    btn.style.backgroundColor = alpha03;
  });
  root.style.setProperty('--btn-bg', alpha03);
  root.style.setProperty('--btn-hover', alpha05);
  root.style.setProperty('--btn-active', alpha02);
}
