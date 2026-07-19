import { noCrmVocab } from "./no-crm-vocab.js";

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: "@bridge/eslint-rules",
  },
  rules: {
    "no-crm-vocab": noCrmVocab,
  },
};

export default plugin;
