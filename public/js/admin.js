(() => {
  'use strict';
  const login = document.getElementById('loginForm');
  if (login) {
    login.addEventListener('submit', async event => {
      event.preventDefault();
      const button = login.querySelector('button');
      const error = document.getElementById('loginError');
      if (button.disabled) return;
      button.disabled = true; button.textContent = 'Signing in…'; error.hidden = true;
      try {
        const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('password').value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
        location.replace('/admin');
      } catch (failure) { error.textContent = failure.message || 'Check your connection and try again.'; error.hidden = false; }
      finally { button.disabled = false; button.textContent = 'Sign in'; }
    });
    return;
  }
  const list = document.getElementById('bookingList');
  if (!list) return;
  const serviceNames = { family: 'Home Removals', office: 'Office Moves', packing: 'Packing' };
  const refresh = document.getElementById('refresh');
  const loadMore = document.getElementById('loadMore');
  const error = document.getElementById('adminError');
  const loading = document.getElementById('loading');
  let cursor = null;
  let pending = false;
  const formatTime = date => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
  function item(label, text, phone = false) {
    const element = document.createElement('div'); element.className = 'record-item';
    const caption = document.createElement('small'); caption.textContent = label;
    const content = document.createElement(phone ? 'a' : 'p'); content.textContent = text || '—';
    if (phone) content.href = `tel:${String(text || '').replace(/[^+\d]/g, '')}`;
    if (label === 'Reference') content.className = 'record-reference';
    element.append(caption, content); return element;
  }
  function recordCard(record) {
    const article = document.createElement('article'); article.className = 'booking-record';
    const top = document.createElement('div'); top.className = 'record-top';
    const heading = document.createElement('h2'); heading.textContent = serviceNames[record.service] || 'Moving request';
    const time = document.createElement('time'); time.dateTime = record.createdAt; time.textContent = formatTime(record.createdAt);
    top.append(heading, time);
    const grid = document.createElement('div'); grid.className = 'record-grid';
    grid.append(item('Moving from', record.fromAddress), item('Moving date', new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(`${record.moveDate}T12:00:00`))), item('Moving to', record.toAddress), item('Contact number', record.phone, true), item('Reference', record.id));
    article.append(top, grid); return article;
  }
  async function load(reset) {
    if (pending) return;
    pending = true; refresh.disabled = true; loadMore.disabled = true; error.hidden = true; loading.hidden = false;
    try {
      const response = await fetch(`/api/admin/bookings${!reset && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
      if (response.status === 401) { location.replace('/admin'); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load bookings.');
      const cards = data.bookings.map(recordCard);
      if (reset) list.replaceChildren(...cards); else list.append(...cards);
      cursor = data.cursor;
      loadMore.hidden = !cursor;
      document.getElementById('empty').hidden = list.children.length > 0;
    } catch (failure) { error.textContent = failure.message || 'Check your connection and try again.'; error.hidden = false; }
    finally { pending = false; refresh.disabled = false; loadMore.disabled = false; loading.hidden = true; }
  }
  refresh.addEventListener('click', () => { void load(true); });
  loadMore.addEventListener('click', () => { void load(false); });
  document.getElementById('logout').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Unable to sign out. Please try again.');
      location.replace('/admin');
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  void load(true);
})();
