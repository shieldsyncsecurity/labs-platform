// Copies the CANONICAL lab settings (app/lab-settings.json) to the marketing
// repo mirror (../shieldsync-website/lib/lab-settings.json). Run from
// labs-platform/ after hand-editing the canonical file, then commit BOTH repos.
// (The /admin/labs panel does this automatically via GitHub commits.)
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const src = resolve("app/lab-settings.json");
const dst = resolve("../shieldsync-website/lib/lab-settings.json");

const content = readFileSync(src, "utf8");
JSON.parse(content); // fail loudly on invalid JSON before copying
writeFileSync(dst, content);
console.log(`synced ${src}\n    -> ${dst}\nRemember to commit BOTH repos.`);
