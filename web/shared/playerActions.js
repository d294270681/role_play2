/** 玩家可主动执行的结构化操作；世界状态由 GM 回合和规则引擎结算。 */
export const PLAYER_EDIT_OPERATIONS = Object.freeze(["spend_xp"]);

export function isPlayerEdit(op) {
  return Boolean(
    op &&
      typeof op === "object" &&
      !Array.isArray(op) &&
      PLAYER_EDIT_OPERATIONS.includes(op.op),
  );
}

export const WORLD_EDIT_MESSAGE =
  "这些数据会随探索、对话和事件结算更新，玩家不能直接修改。";
