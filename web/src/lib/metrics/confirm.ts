// «Llevas X de N» in Confirmar (mockup 04): N = saved in this visit + still waiting.
export function confirmProgress(saved: number, waiting: number) {
  const total = saved + Math.max(0, waiting);
  return { done: saved, total, ratio: total ? saved / total : 0 };
}
