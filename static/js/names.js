// Names of stages and algorithms in the reader's language.
//
// The server describes them with language-neutral keys (a stage's `key`, an
// algorithm's `key` and `args`), so that switching language never needs the
// cube solved again. Both the step card and the graphs name things through
// here, so they always agree.

import { t } from "./i18n.js";

export function stageTitle(stage) {
  return t(`stage.${stage.key}.title`);
}

export function stageGoal(stage) {
  return t(`stage.${stage.key}.goal`);
}

export function stageGraph(stage) {
  return t(`stage.${stage.key}.graph`);
}

// "Corner to the front-right slot", "U'", "Sune"...
export function macroName(m) {
  if (!m.key || m.key === "move") return m.label;
  const args = { ...(m.args || {}) };
  if (args.slot) args.slotName = t(`slot.${args.slot}`);
  if (args.side) args.sideName = t(`side.${args.side}`);
  return t(`macro.${m.key}`, args);
}

// The few letters used where there is little room (the neighbour graph).
export function macroShort(m) {
  const key = `macro.short.${m.key}`;
  const word = t(key);
  return word !== key ? word : (m.short || m.label);
}
