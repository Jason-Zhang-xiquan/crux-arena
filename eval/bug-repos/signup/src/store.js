// 存储层：模拟远程数据库，每次读写都要等一次网络往返
const roundTrip = () => new Promise(resolve => setTimeout(resolve, 1 + Math.floor(Math.random() * 5)));

export function createStore() {
  const events = new Map();
  const signups = new Map();
  const points = new Map();
  return {
    async getEvent(id) { await roundTrip(); return events.get(id); },
    async putEvent(ev) { await roundTrip(); events.set(ev.id, ev); },
    async listSignups(id) { await roundTrip(); return [...(signups.get(id) ?? [])]; },
    async addSignup(id, user) {
      await roundTrip();
      if (!signups.has(id)) signups.set(id, []);
      signups.get(id).push(user);
    },
    async getPoints(user) { await roundTrip(); return points.get(user) ?? 0; },
    async addPoints(user, n) { await roundTrip(); points.set(user, (points.get(user) ?? 0) + n); },
    async allPoints() { await roundTrip(); return [...points].map(([user, total]) => ({ user, points: total })); },
  };
}
