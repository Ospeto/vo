const stripGypComments = (text: string): string => text.replace(/#.*$/gm, "");
const stripHeaderComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

export const countGypDeclarations = (text: string, key: string): number => {
  const pattern = new RegExp(`^\\s*['"]${key}['"]\\s*:`, "gm");
  return [...stripGypComments(text).matchAll(pattern)].length;
};

export const countDefineDeclarations = (text: string, key: string): number => {
  const pattern = new RegExp(`^\\s*#\\s*define\\s+${key}(?:\\s|$)`, "gm");
  return [...stripHeaderComments(text).matchAll(pattern)].length;
};

export const parseGypAssignment = (text: string, key: string): number | null => {
  if (countGypDeclarations(text, key) !== 1) return null;
  const pattern = new RegExp(`^\\s*['"]${key}['"]\\s*:\\s*(['"]?)([0-9]+)\\1\\s*,?\\s*(?:#.*)?$`, "gm");
  const matches = [...stripGypComments(text).matchAll(pattern)];
  return matches.length === 1 ? Number(matches[0]?.[2]) : null;
};

export const parseDefine = (text: string, key: string): number | null => {
  if (countDefineDeclarations(text, key) !== 1) return null;
  const pattern = new RegExp(`^\\s*#\\s*define\\s+${key}\\s+([0-9]+)\\s*(?:/\\*.*\\*/\\s*)?$`, "gm");
  const matches = [...stripHeaderComments(text).matchAll(pattern)];
  return matches.length === 1 ? Number(matches[0]?.[1]) : null;
};

export const validateElectronHeaderMetadata = (config: string, version: string): boolean =>
  parseGypAssignment(config, "built_with_electron") === 1 &&
  parseGypAssignment(config, "using_electron_config_gypi") === 1 &&
  parseGypAssignment(config, "node_module_version") === 143 &&
  parseDefine(version, "NODE_MAJOR_VERSION") === 24 &&
  parseDefine(version, "NODE_MINOR_VERSION") === 11 &&
  parseDefine(version, "NODE_PATCH_VERSION") === 1;
