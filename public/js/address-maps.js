(() => {
  'use strict';
  // No Maps JavaScript API, Places API, or browser key is used here.
  // The Google embed owns its map UI; we never access its cross-origin document.
  function init(addresses) {
    const panel = document.getElementById('sharedLocation');
    const frame = document.getElementById('sharedMapFrame');
    const empty = document.getElementById('sharedMapEmpty');
    const emptyText = document.getElementById('sharedMapEmptyText');
    const title = document.getElementById('sharedMapTitle');
    const state = document.getElementById('sharedMapState');
    const dot = document.getElementById('sharedMapDot');
    const status = document.getElementById('sharedMapStatus');
    const overview = document.getElementById('routeOverview');
    const loading = document.getElementById('sharedMapLoading');
    const retry = document.getElementById('reloadMap');
    const composing = new Set();
    let active = addresses[0];
    let typingTimer, overviewTimer, blurTimer, loadingTimer;
    let lastURL = '';
    const value = address => address.input.value.trim();
    const bothFilled = () => addresses.every(address => value(address));
    const isAddressFocused = () => addresses.some(address => document.activeElement === address.input);
    function cancelUpdates() {
      clearTimeout(typingTimer);
      clearTimeout(overviewTimer);
      clearTimeout(blurTimer);
    }
    function setMode(mode, heading) {
      panel.dataset.mode = mode;
      title.textContent = heading;
      dot.classList.toggle('destination', mode === 'to');
      overview.hidden = mode !== 'route';
      addresses.forEach(address => address.input.closest('.address-field').classList.toggle('is-active', address === active && mode === address.prefix));
    }
    function showEmpty(text, mode = 'empty', heading = 'Your move on the map') {
      setMode(mode, heading);
      frame.hidden = true;
      empty.hidden = false;
      emptyText.textContent = text;
      loading.hidden = true;
      retry.hidden = true;
      clearTimeout(loadingTimer);
      panel.removeAttribute('aria-busy');
      state.textContent = 'Add an address';
    }
    function mount(url, mode, heading, caption) {
      setMode(mode, heading);
      frame.title = mode === 'route' ? 'Google driving route from collection to destination' : `${heading} on Google Maps`;
      status.textContent = caption;
      frame.hidden = false;
      empty.hidden = true;
      if (lastURL === url.href) {
        if (loading.hidden) state.textContent = mode === 'route' ? 'Driving route' : 'Location preview';
        return;
      }
      lastURL = url.href;
      frame.dataset.mode = mode;
      state.textContent = 'Loading';
      loading.hidden = false;
      retry.hidden = true;
      panel.setAttribute('aria-busy', 'true');
      frame.src = lastURL;
      clearTimeout(loadingTimer);
      loadingTimer = setTimeout(() => {
        loading.hidden = true;
        retry.hidden = false;
        panel.removeAttribute('aria-busy');
        state.textContent = 'Taking longer';
        status.textContent = 'Google Maps is taking longer to load. Check your connection or reload the map. Your addresses are still saved in the form.';
      }, 15000);
    }
    function baseURL() {
      const url = new URL('https://maps.google.com/maps');
      url.searchParams.set('output', 'embed');
      url.searchParams.set('hl', 'en');
      return url;
    }
    function showPoint(address) {
      active = address;
      const query = value(address);
      if (!query) {
        showEmpty(`Enter the full ${address.label.toLowerCase()} address to see its location.`, address.prefix, `${address.label} location`);
        status.textContent = `Editing your ${address.label.toLowerCase()} address.`;
        return;
      }
      const url = baseURL();
      url.searchParams.set('q', query);
      url.searchParams.set('z', '16');
      mount(url, address.prefix, `${address.label} location`, `${address.label}: ${query}. Please check the map location.`);
    }
    function showOverview() {
      if (composing.size) return;
      if (bothFilled()) {
        const origin = value(addresses[0]);
        const destination = value(addresses[1]);
        const url = baseURL();
        url.searchParams.set('saddr', origin);
        url.searchParams.set('daddr', destination);
        url.searchParams.set('dirflg', 'd');
        document.getElementById('routeOrigin').textContent = origin;
        document.getElementById('routeDestination').textContent = destination;
        mount(url, 'route', 'Your moving route', 'Driving route from collection to destination. Please check both locations.');
      } else {
        const filled = addresses.find(address => value(address));
        if (filled) showPoint(filled);
        else {
          showEmpty('Add your addresses to preview your journey.');
          status.textContent = 'Check your addresses on the map.';
        }
      }
    }
    function changed(address) {
      cancelUpdates();
      active = address;
      address.input.setCustomValidity('');
      document.getElementById(`${address.prefix}AddressStatus`).textContent = value(address) ? 'Check the street, town and postcode' : `Enter the full ${address.label.toLowerCase()} address`;
      // Remove the previous route immediately so it cannot represent an edited address.
      showEmpty(`Editing your ${address.label.toLowerCase()} address…`, address.prefix, `${address.label} location`);
      status.textContent = `The map will update to your ${address.label.toLowerCase()} location.`;
      if (composing.has(address)) return;
      if (!value(address)) { showPoint(address); return; }
      typingTimer = setTimeout(() => showPoint(address), 550);
      // Once both fields settle, replace the location preview with a single driving route.
      if (bothFilled()) overviewTimer = setTimeout(showOverview, 1500);
    }
    addresses.forEach(address => {
      address.input.addEventListener('focus', () => { cancelUpdates(); showPoint(address); });
      address.input.addEventListener('input', () => changed(address));
      address.input.addEventListener('compositionstart', () => { composing.add(address); cancelUpdates(); });
      address.input.addEventListener('compositionend', () => { composing.delete(address); changed(address); });
      address.input.addEventListener('change', () => {
        cancelUpdates();
        if (isAddressFocused()) changed(address);
        else showOverview();
      });
      address.input.addEventListener('blur', () => {
        cancelUpdates();
        // A focus switch to the other address must keep that address's location in view.
        blurTimer = setTimeout(() => { if (!isAddressFocused()) showOverview(); }, 0);
      });
      address.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && !composing.has(address)) {
          event.preventDefault();
          cancelUpdates();
          showOverview();
        }
      });
    });
    frame.addEventListener('load', () => {
      clearTimeout(loadingTimer);
      loading.hidden = true;
      retry.hidden = true;
      panel.removeAttribute('aria-busy');
      if (!frame.hidden) state.textContent = panel.dataset.mode === 'route' ? 'Driving route' : 'Location preview';
    });
    frame.addEventListener('error', () => {
      clearTimeout(loadingTimer);
      loading.hidden = true;
      retry.hidden = false;
      panel.removeAttribute('aria-busy');
      state.textContent = 'Unable to load';
      status.textContent = 'The map could not load. Check your connection. You can still submit your addresses.';
    });
    retry.addEventListener('click', () => { lastURL = ''; showOverview(); });
    return { refresh: () => { cancelUpdates(); showOverview(); } };
  }
  window.WarmMovingAddresses = Object.freeze({ init });
})();
