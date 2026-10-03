/** 游戏过程解锁的公开资料；只计算视图，不修改旧存档。 */
export function knownRelations(save, mod) {
  const player =
    (mod.characters || []).find((card) => card.name === save.character?.name) ||
    mod.player_card;
  const initial = new Set(
    (player?.relations || []).map((relation) => relation.npc),
  );
  return (save.relations || []).filter((relation) => {
    // 旧版本预置了所有 NPC 的态度；未在开局关系或剧情出现的默认记录不是解锁。
    const card = (mod.characters || []).find(
      (entry) => entry.name === relation.npc,
    );
    if (!card || initial.has(relation.npc) || relation.note !== "对主角态度")
      return true;
    if (Number(relation.value) !== Number(card.attitude ?? 0)) return true;
    return (save.log || []).some((entry) =>
      String(entry.text || "").includes(relation.npc),
    );
  });
}

export function knownNpcNames(save, mod) {
  return new Set(knownRelations(save, mod).map((relation) => relation.npc));
}

export function unlockedEvents(save, mod) {
  const entries = [
    ...(save.events_fired || []),
    save.pending_event,
    ...(save.pending_events || []),
  ].filter(Boolean);
  const codes = new Set(
    entries.map((event) => String(event.code || "")).filter(Boolean),
  );
  return (mod.events || []).filter((event) => codes.has(String(event.code)));
}
