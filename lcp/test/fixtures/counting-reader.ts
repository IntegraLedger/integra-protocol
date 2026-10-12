/** The same reader, recording the name of each method called on it, in order. */
export function counting<R extends object>(reader: R): { reader: R; calls: string[] } {
  const calls: string[] = [];
  const wrapped = new Proxy(reader, {
    get(target, key, receiver) {
      const v: unknown = Reflect.get(target, key, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        calls.push(String(key));
        return Reflect.apply(v, target, args);
      };
    },
  });
  return { reader: wrapped, calls };
}
