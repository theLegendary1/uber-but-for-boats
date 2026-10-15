// The little bit of DockWash that runs in the browser. Every page works without it.

// Availability calendar: tapping a day toggles it; the quick buttons pick many at once.
for (const day of document.querySelectorAll('.day input')) {
  day.addEventListener('change', () => day.parentElement.classList.toggle('on', day.checked));
}
for (const btn of document.querySelectorAll('[data-pick]')) {
  btn.addEventListener('click', () => {
    for (const day of document.querySelectorAll('.day input')) {
      const dow = new Date(`${day.value}T00:00:00Z`).getUTCDay();
      day.checked = { all: true, none: false, weekdays: dow > 0 && dow < 6, weekends: dow === 0 || dow === 6 }[btn.dataset.pick];
      day.parentElement.classList.toggle('on', day.checked);
    }
  });
}

// Ask before anything that can't be undone.
for (const btn of document.querySelectorAll('button.danger')) {
  btn.form.addEventListener('submit', (e) => { if (!confirm('Cancel this service? Everyone booked or asked will see it called off.')) e.preventDefault(); });
}

// Invite text: copy to the clipboard (or select it where the browser won't allow that, e.g. plain http).
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const box = document.getElementById(btn.dataset.copy);
    try { await navigator.clipboard.writeText(box.value); } catch { box.select(); document.execCommand('copy'); }
    btn.textContent = 'Copied ✓';
  });
}

// Native phone sharing preserves the same referral link in every selected app.
for (const btn of document.querySelectorAll('[data-share-url]')) {
  btn.addEventListener('click', async () => {
    const url = btn.dataset.shareUrl;
    const text = btn.dataset.shareText;
    const status = document.getElementById('share-status');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DockWash', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        status.textContent = 'Referral link copied. Paste it into your favorite app.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Use the Copy buttons above or Share by text to send your referral link.';
    }
  });
}
