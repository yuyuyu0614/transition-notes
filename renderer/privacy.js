// Privacy window logic
const closeBtn = document.getElementById("closePrivacyBtn") || document.querySelector("#closePrivacyBtn");
const dontShowCheckbox = document.getElementById("dontShowAgain");

closeBtn.addEventListener("click", async () => {
  if (dontShowCheckbox.checked) {
    try { await window.transitionAPI.setPrivacyShown(true); } catch (e) { console.error('Failed to save privacy preference:', e); }
  }
  window.close();
});

async function init() {
  try {
    const settings = await window.transitionAPI.getAppSettings();
    const lang = settings.language || "zh-CN";
    await I18N.init(lang);
    if (settings.theme) document.documentElement.setAttribute("data-theme", settings.theme);
    const accent = settings.theme === "dark" ? (settings.darkColor || "#8CB89A") : (settings.lightColor || "#0FBAB2");
    document.documentElement.style.setProperty("--mars-green", accent);
    applyThemeColors(settings.theme || "light", accent);
    if (settings.fontFamily) {
      document.body.style.fontFamily = settings.fontFamily + ", sans-serif";
    }
  } catch (e) { console.error("Privacy init failed:", e); }
}

init();
window.transitionAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  const acc = document.documentElement.style.getPropertyValue("--mars-green").trim() || (theme === "dark" ? "#8CB89A" : "#0FBAB2");
  applyThemeColors(theme, acc);
});
window.transitionAPI.onAccentColorChanged((data) => {
  if (data && data.color) {
    document.documentElement.style.setProperty("--mars-green", data.color);
    applyThemeColors(data.theme || document.documentElement.getAttribute("data-theme") || "light", data.color);
  }
});
window.transitionAPI.onFontChanged((fontFamily) => {
  document.body.style.fontFamily = fontFamily + ", sans-serif";
});
