export { DEFAULT_CONFIG, DEFAULT_NAMING_TAGS, type DeepPartial } from "./config/defaults.js";
export {
  mergeConfigDocuments,
  normalizeConfigDocumentInput,
  redactConfigDocument,
  serializeConfigDocument,
} from "./config/document.js";
export {
  buildConfigForTests,
  loadConfigView,
  loadEffectiveConfig,
  resolveConfigPaths,
  writeUserConfig,
} from "./config/files.js";
