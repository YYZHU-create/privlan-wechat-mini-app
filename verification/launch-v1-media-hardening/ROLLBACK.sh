#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.length < 2) throw new Error("usage: ROLLBACK.sh target backup");
fs.copyFileSync(args[1], args[0]);
console.log("ROLLBACK_OK target=" + args[0]);
