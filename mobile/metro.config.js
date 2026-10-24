// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle the prebuilt SQLite database (quran.db) as an asset so expo-asset /
// expo-sqlite can copy it on first launch. `.db` is not a default asset extension.
config.resolver.assetExts.push("db");

module.exports = config;
