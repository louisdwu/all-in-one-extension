let modifierKey = 'ctrlKey';
let ezEnabled = true;

chrome.storage.sync.get(['modifierKey', 'ezEnabled'], (result) => {
  if (result.modifierKey) modifierKey = result.modifierKey;
  if (result.ezEnabled !== undefined) ezEnabled = result.ezEnabled;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.modifierKey) modifierKey = changes.modifierKey.newValue;
    if (changes.ezEnabled !== undefined) ezEnabled = changes.ezEnabled.newValue;
  }
});

document.addEventListener('click', (e) => {
  if (!ezEnabled || !e[modifierKey]) {
    return;
  }

  const link = e.target.closest('a');
  if (!link || !link.href) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  chrome.runtime.sendMessage({
    action: 'openIncognito',
    url: link.href
  });

  return false;
}, true);
