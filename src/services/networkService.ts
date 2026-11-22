import { AppState } from 'react-native';
import { API_BASE_URL } from '../constants/config';

let lastKnownOnline = true;
let consecutiveFailures = 0;
let probeInFlight: Promise<boolean> | null = null;
const statusListeners = new Set<(online: boolean) => void>();
const offlineRequestListeners = new Set<() => void>();

export function isNetworkError(err: unknown): boolean {
  const msg = String(
    err instanceof Error ? `${err.name} ${err.message}` : err ?? ''
  ).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('fetch failed') ||
    msg.includes('network request failed') ||
    msg.includes('internet connection') ||
    msg.includes('appears to be offline') ||
    msg.includes('offline') ||
    msg.includes('timed out') ||
    msg.includes('aborterror') ||
    msg.includes('failed to fetch') ||
    msg.includes('could not connect') ||
    msg.includes('cannot find host') ||
    msg.includes('networkerror') ||
    msg.includes('dns') ||
    msg.includes('socket')
  );
}

export function getLastKnownOnline(): boolean {
  return lastKnownOnline;
}

export function subscribeNetworkStatus(cb: (online: boolean) => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export function subscribeAutoOfflineRequest(cb: () => void): () => void {
  offlineRequestListeners.add(cb);
  return () => {
    offlineRequestListeners.delete(cb);
  };
}

export function requestEnterOfflineMode(): void {
  offlineRequestListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

function setOnlineState(nextOnline: boolean) {
  if (lastKnownOnline !== nextOnline) {
    lastKnownOnline = nextOnline;
    statusListeners.forEach((cb) => {
      try {
        cb(nextOnline);
      } catch {}
    });
  }
}

export async function probeConnectivity(timeoutMs = 3000): Promise<boolean> {
  if (probeInFlight) {
    return probeInFlight;
  }

  probeInFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${API_BASE_URL}/auth.php?action=status&_net=${Date.now()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });
      if (res.status > 0) {
        consecutiveFailures = 0;
        setOnlineState(true);
        return true;
      }
      consecutiveFailures += 1;
      setOnlineState(false);
      return false;
    } catch {
      consecutiveFailures += 1;
      return false;
    } finally {
      clearTimeout(timer);
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}

export async function reportNetworkFailure(): Promise<boolean> {
  const reachable = await probeConnectivity(2400);
  if (!reachable) {
    consecutiveFailures = 2;
    setOnlineState(false);
    requestEnterOfflineMode();
    return false;
  }
  return true;
}

let activeMonitorRefs = 0;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let monitorAppStateSub: { remove: () => void } | null = null;
let monitorIntervalMs = 4500;

async function runMonitorTick() {
  if (AppState.currentState !== 'active') return;
  const ok = await probeConnectivity(2800);
  if (ok) {
    consecutiveFailures = 0;
    setOnlineState(true);
  } else if (consecutiveFailures >= 2) {
    setOnlineState(false);
  }
}

export function startNetworkMonitor(intervalMs = 4500): () => void {
  activeMonitorRefs += 1;
  monitorIntervalMs = Math.min(monitorIntervalMs, intervalMs);

  if (activeMonitorRefs === 1) {
    void runMonitorTick();
    monitorTimer = setInterval(() => {
      void runMonitorTick();
    }, monitorIntervalMs);
    monitorAppStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void runMonitorTick();
      }
    });
  }

  return () => {
    activeMonitorRefs = Math.max(0, activeMonitorRefs - 1);
    if (activeMonitorRefs === 0) {
      if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
      }
      if (monitorAppStateSub) {
        monitorAppStateSub.remove();
        monitorAppStateSub = null;
      }
      monitorIntervalMs = 4500;
    }
  };
}
