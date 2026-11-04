// 内存存储：短码 → 短链记录
export function createStore() {
  const links = new Map();
  return {
    get: code => links.get(code),
    put: (code, link) => { links.set(code, link); },
    delete: code => links.delete(code),
    all: () => [...links.values()],
  };
}
