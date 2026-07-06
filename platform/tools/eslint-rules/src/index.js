import { noCrmVocab } from "./no-crm-vocab.js";
import { dummyPrefix } from "./dummy-prefix.js";

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: {
    name: "@bridge/eslint-rules",
  },
  rules: {
    "no-crm-vocab": noCrmVocab,
    "dummy-prefix": dummyPrefix,
  },
};

export default plugin;
