// Metro config: lets the app import the backend's pure, shared modules from ../lib
// (schema, intent interpreter, magic-edit preview, share links) so client and server
// agree on every contract. Packages imported by those shared files resolve from the
// app's node_modules, so there is one copy of zod/luxon in the bundle.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "..", "lib");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromShared = context.originModulePath.startsWith(sharedRoot + path.sep);
  const bare = !moduleName.startsWith(".") && !path.isAbsolute(moduleName);
  const ctx = fromShared && bare
    ? { ...context, originModulePath: path.join(projectRoot, "package.json") }
    : context;
  return (upstream ?? ctx.resolveRequest)(ctx, moduleName, platform);
};
module.exports = config;
