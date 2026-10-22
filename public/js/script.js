(() => {
  'use strict';
  const services = {
    family: { name: 'Home Removals', description: 'A careful move for every home' },
    office: { name: 'Office Moves', description: 'Less downtime. A smoother move.' },
    packing: { name: 'Packing', description: 'Thoughtfully packed and protected' }
  };
  const assetBase = document.querySelector('meta[name="asset-base-url"]')?.content || '';
  const nav = document.getElementById('mainNav');
  const menu = document.getElementById('menuToggle');
  const dialog = document.getElementById('contactModal');
  const closeMenu = () => {
    nav?.classList.remove('open');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation menu');
    if (menu) menu.textContent = '☰';
  };
  menu?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    menu.textContent = open ? '×' : '☰';
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  document.addEventListener('click', event => { if (!event.target.closest('.topbar')) closeMenu(); });
  document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', () => dialog?.showModal()));
  document.getElementById('closeModal')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const service = document.getElementById('serviceType');
  const date = document.getElementById('moveDate');
  const from = document.getElementById('fromCity');
  const to = document.getElementById('toCity');
  const phone = document.getElementById('contactPhone');
  const error = document.getElementById('formError');
  const submit = form.querySelector('[type="submit"]');
  const storageKey = 'warm-moving-live-booking-v1';
  let submitting = false;
  let submissionId;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  date.min = today();
  date.addEventListener('focus', () => { date.min = today(); });
  const chosen = new URLSearchParams(location.search).get('service');
  service.value = Object.hasOwn(services, chosen) ? chosen : 'family';
  function updateService() {
    document.getElementById('chosenName').textContent = services[service.value].name;
    document.getElementById('chosenDescription').textContent = services[service.value].description;
    const image = document.createElement('img');
    image.src = `${assetBase}/images/${service.value}.svg`;
    image.alt = '';
    image.className = 'service-visual';
    document.getElementById('chosenArt').replaceChildren(image);
    document.querySelectorAll('.nav-link').forEach(link => {
      const active = link.getAttribute('href') === `/booking.html?service=${service.value}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }
  updateService();
  service.addEventListener('change', () => { updateService(); history.replaceState(null, '', `/booking.html?service=${service.value}`); });
  const addresses = window.WarmMovingAddresses.init([
    { prefix: 'from', input: from, label: 'Collection' },
    { prefix: 'to', input: to, label: 'Destination' }
  ]);
  const saveDraft = () => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...Object.fromEntries(new FormData(form)), submissionId })); } catch {}
  };
  try {
    const draft = JSON.parse(sessionStorage.getItem(storageKey));
    if (draft?.service === service.value) {
      for (const input of [from, to, date, phone]) if (typeof draft[input.name] === 'string') input.value = draft[input.name];
      if (typeof draft.submissionId === 'string') submissionId = draft.submissionId;
      addresses.refresh();
    }
  } catch {}
  form.addEventListener('input', event => { event.target.setCustomValidity?.(''); submissionId = undefined; error.hidden = true; saveDraft(); });
  form.addEventListener('change', () => { submissionId = undefined; saveDraft(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    error.hidden = true;
    for (const input of [from, to]) {
      input.value = input.value.trim();
      input.setCustomValidity(input.value.length >= 3 ? '' : 'Please enter your full address.');
    }
    phone.value = phone.value.trim();
    const digits = phone.value.replace(/\D/g, '');
    phone.setCustomValidity(/^[+\d\s().-]+$/.test(phone.value) && digits.length >= 7 && digits.length <= 15 ? '' : 'Enter a valid phone number, including your country code.');
    date.min = today();
    date.setCustomValidity(date.value && date.value < date.min ? 'Choose today or a future date (UK time).' : '');
    if (!form.reportValidity()) return;
    const booking = Object.fromEntries(new FormData(form));
    if (!submissionId || Date.now() - Number(submissionId.split('-')[0]) > 6 * 86400000) submissionId = `${Date.now()}-${crypto.randomUUID()}`;
    saveDraft();
    submitting = true;
    submit.disabled = true;
    submit.textContent = 'Sending your request…';
    form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...booking, submissionId }), signal: AbortSignal.timeout(20000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not save your booking. Please try again.');
      if (!data.id) throw new Error('We could not confirm your booking. Please contact us.');
      const summary = document.getElementById('bookingSummary');
      summary.replaceChildren();
      const formattedDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(`${booking.moveDate}T12:00:00`));
      for (const [label, text] of [['Reference', data.id], ['Service', services[booking.service].name], ['Moving from', booking.fromAddress], ['Moving to', booking.toAddress], ['Moving date', formattedDate], ['Phone', booking.phone]]) {
        const row = document.createElement('div'); row.className = 'summary-row';
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = text;
        row.append(term, detail); summary.append(row);
      }
      document.getElementById('successDescription').textContent = 'Your request has been saved. We will be in touch to confirm your move.';
      document.getElementById('bookingFields').hidden = true;
      document.getElementById('bookingSuccess').hidden = false;
      document.getElementById('successTitle').focus();
      document.querySelector('.booking-panel').scrollIntoView({ behavior: 'instant', block: 'start' });
      try { sessionStorage.removeItem(storageKey); } catch {}
    } catch (failure) {
      error.textContent = failure.name === 'TimeoutError' || failure.name === 'AbortError' ? 'We could not confirm the response. Please try again; the same request will not be saved twice.' : failure.message || 'Please check your connection and try again.';
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
    } finally {
      submitting = false; submit.disabled = false; submit.textContent = 'Request a booking'; form.removeAttribute('aria-busy');
    }
  });
  document.getElementById('bookAgain').addEventListener('click', () => {
    form.reset(); submissionId = undefined; updateService(); addresses.refresh();
    document.getElementById('bookingSuccess').hidden = true;
    document.getElementById('bookingFields').hidden = false;
    from.focus();
  });
})();
