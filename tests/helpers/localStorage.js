const mem = new Map();

globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    mem.set(k, String(v));
  },
  removeItem: (k) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

globalThis.window = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
  CustomEvent: globalThis.CustomEvent,
};

globalThis.BroadcastChannel = class BroadcastChannel {
  postMessage() {}
  close() {}
};

export function resetJobStorage() {
  mem.clear();
}
