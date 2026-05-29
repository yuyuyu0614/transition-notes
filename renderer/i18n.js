// I18N - Internationalization engine for Transition
// Uses data-i18n attributes on DOM elements
const I18N = {
  currentLang: 'zh-CN',
  translations: {},

  async init(lang) {
    this.currentLang = lang || 'zh-CN';
    try {
      if (window.transitionAPI && window.transitionAPI.getTranslations) {
        this.translations = await window.transitionAPI.getTranslations(this.currentLang);
      } else {
        // Fallback: try fetching the JSON file directly
        const resp = await fetch(`locales/${this.currentLang}.json`);
        this.translations = await resp.json();
      }
    } catch (e) {
      console.error('Failed to load translations for', this.currentLang, e);
      this.translations = {};
    }
    if (typeof applyTranslations === 'function') {
      applyTranslations();
    }
  },

  t(key) {
    // Return translation if available, fallback to key itself
    if (this.translations && this.translations[key]) return this.translations[key];
    console.warn('I18N missing key:', key);
    return key;
  }
};

function applyTranslations() {
  // Skip if no translations loaded yet
  if (!I18N.translations || Object.keys(I18N.translations).length === 0) return;
  // Update document title if it has data-i18n
  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) {
    const key = titleEl.getAttribute('data-i18n');
    const translation = I18N.t(key);
    if (translation !== key) {
      document.title = translation;
    }
  }

  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.tagName === 'TITLE') return; // Already handled above
    const key = el.getAttribute('data-i18n');
    if (key) {
      const translation = I18N.t(key);
      if (translation !== key) {
        if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search')) {
          el.placeholder = translation;
        } else if (el.tagName === 'TEXTAREA') {
          el.placeholder = translation;
        } else if (el.tagName === 'OPTION') {
          el.textContent = translation;
        } else if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
          el.value = translation;
        } else {
          el.textContent = translation;
        }
      }
    }
  });

  // Also handle data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const translation = I18N.t(key);
      if (translation !== key) {
        el.placeholder = translation;
      }
    }
  });

  // Handle data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const translation = I18N.t(key);
      if (translation !== key) {
        el.title = translation;
      }
    }
  });

  // Handle data-i18n-html for elements that need innerHTML (like color descriptions)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) {
      const translation = I18N.t(key);
      if (translation !== key) {
        el.innerHTML = translation;
      }
    }
  });

  // Dispatch a custom event so that page-specific JS can re-render dynamic content
  window.dispatchEvent(new CustomEvent('i18n-applied', { detail: { lang: I18N.currentLang } }));
}
