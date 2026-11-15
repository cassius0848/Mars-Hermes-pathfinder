// Bound reuse and merge bursts of visual updates without changing planning data.
export function frameTask(callback, request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let frame = null, args;
  const schedule = (...next) => {
    args = next;
    if (frame !== null) return;
    frame = request(() => { frame = null; callback(...args); });
  };
  schedule.cancel = () => { if (frame !== null) cancel(frame); frame = null; };
  return schedule;
}

export class BudgetCache {
  constructor(maxBytes, maxEntries = 4) { this.maxBytes=maxBytes; this.maxEntries=maxEntries; this.bytes=0; this.entries=new Map(); }
  get(key) {
    const entry=this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key,entry);
    return entry.value;
  }
  set(key,value,bytes) {
    const prior=this.entries.get(key);
    if (prior) { this.bytes-=prior.bytes; this.entries.delete(key); }
    if (!Number.isFinite(bytes) || bytes<0 || bytes>this.maxBytes) return value;
    this.entries.set(key,{value,bytes}); this.bytes+=bytes;
    while (this.bytes>this.maxBytes || this.entries.size>this.maxEntries) {
      const key=this.entries.keys().next().value,old=this.entries.get(key);
      this.bytes-=old.bytes; this.entries.delete(key);
    }
    return value;
  }
}
