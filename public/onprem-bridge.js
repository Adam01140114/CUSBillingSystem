/**
 * On-prem storage bridge — routes Firestore load/save calls to /api/system-data when enabled.
 */
(function () {
  'use strict';

  window.__ON_PREM_MODE = false;
  window.__ON_PREM_READY = false;
  window.__ON_PREM_SAVE_TIMER = null;
  window.__ON_PREM_SAVE_IN_FLIGHT = false;

  window.isOnPremStorage = function isOnPremStorage() {
    return window.__ON_PREM_MODE === true;
  };

  async function fetchMode() {
    try {
      const res = await fetch('/api/storage/mode', { cache: 'no-store' });
      if (!res.ok) return { onPremEnabled: false };
      return await res.json();
    } catch (e) {
      return { onPremEnabled: false };
    }
  }

  async function fetchFullState() {
    const res = await fetch('/api/system-data', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load system data (' + res.status + ')');
    return await res.json();
  }

  async function putFullState(snapshot) {
    const res = await fetch('/api/system-data', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-OnPrem-Skip-Disk': shouldSkipOnPremDiskPersist() ? '1' : '0'
      },
      body: JSON.stringify(snapshot)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save system data (' + res.status + ')');
    }
    return await res.json();
  }

  function buildSnapshotFromGlobals() {
    if (typeof window.onPremBuildSnapshot === 'function') {
      return window.onPremBuildSnapshot();
    }
    return { meta: { onPremEnabled: true } };
  }

  function shouldSkipOnPremDiskPersist() {
    return window.__ON_PREM_SKIP_DISK_PERSIST === true;
  }

  window.onPremScheduleSave = function onPremScheduleSave(delayMs) {
    if (!window.isOnPremStorage()) return;
    if (shouldSkipOnPremDiskPersist()) return;
    if (window.__MASTER_TEST_SKIP_FIRESTORE_PERSIST) return;
    clearTimeout(window.__ON_PREM_SAVE_TIMER);
    window.__ON_PREM_SAVE_TIMER = setTimeout(function () {
      window.onPremFlushSave().catch(function (e) {
        console.error('[onprem] save failed:', e);
      });
    }, delayMs != null ? delayMs : 400);
  };

  window.onPremFlushSave = async function onPremFlushSave() {
    if (!window.isOnPremStorage()) return;
    if (shouldSkipOnPremDiskPersist()) return;
    if (window.__ON_PREM_SAVE_IN_FLIGHT) {
      window.onPremScheduleSave(200);
      return;
    }
    window.__ON_PREM_SAVE_IN_FLIGHT = true;
    try {
      const snap = buildSnapshotFromGlobals();
      await putFullState(snap);
    } finally {
      window.__ON_PREM_SAVE_IN_FLIGHT = false;
    }
  };

  window.onPremApplyLoadedState = function onPremApplyLoadedState(state) {
    if (!state) return;
    if (typeof window.onPremApplyState === 'function') {
      window.onPremApplyState(state);
      return;
    }
    window.__billingCyclesCache = Array.isArray(state.billingCycles) ? state.billingCycles : [];
    if (state.meta && state.meta.onPremEnabled != null) {
      window.__ON_PREM_MODE = !!state.meta.onPremEnabled;
    }
  };

  window.onPremLoadAllFromServer = async function onPremLoadAllFromServer() {
    const state = await fetchFullState();
    window.onPremApplyLoadedState(state);
    window.__ON_PREM_READY = true;
    return state;
  };

  window.onPremSaveBillingCycle = async function onPremSaveBillingCycle(cycleSnapshot) {
    if (!window.isOnPremStorage()) return;
    if (shouldSkipOnPremDiskPersist()) return;
    if (!window.__billingCyclesCache) window.__billingCyclesCache = [];
    const id = 'cycle-' + Date.now().toString(36);
    window.__billingCyclesCache.push(Object.assign({ id: id }, cycleSnapshot));
    window.onPremScheduleSave(50);
  };

  window.onPremGetBillingCycles = function onPremGetBillingCycles() {
    return window.__billingCyclesCache || [];
  };

  window.onPremGetBillingCycleById = function onPremGetBillingCycleById(cycleId) {
    const list = window.onPremGetBillingCycles();
    return list.find(function (c) {
      return c && c.id === cycleId;
    });
  };

  window.initOnPremBridge = async function initOnPremBridge() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('onPrem') === '1' || params.get('onprem') === '1') {
      window.__ON_PREM_MODE = true;
    }
    const mode = await fetchMode();
    window.__ON_PREM_MODE = window.__ON_PREM_MODE || !!mode.onPremEnabled;
    if (window.__ON_PREM_MODE) {
      await window.onPremLoadAllFromServer();
    }
    window.__ON_PREM_READY = true;
    return mode;
  };

  window.__ON_PREM_MODE_PROMISE = window.initOnPremBridge();
})();
