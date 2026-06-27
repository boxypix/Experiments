// Генерирует JS-снимки из JSON, чтобы приложение работало при открытии
// через file:// (двойным кликом), где браузер блокирует загрузку локальных
// JSON-файлов. Запуск: `npm run snapshot` (или `node make-snapshot.mjs`).
import { readFileSync, writeFileSync } from "fs";

function snapshot(jsonPath, jsPath, globalName) {
    const data = JSON.parse(readFileSync(jsonPath, "utf8"));
    const banner = "// АВТОГЕНЕРАЦИЯ из " + jsonPath + " (npm run snapshot). Не редактировать вручную.\n";
    writeFileSync(jsPath, banner + "window." + globalName + " = " + JSON.stringify(data) + ";\n");
    console.log("✓", jsPath, "←", jsonPath);
}

snapshot("settings.json", "settings.js", "GEOWALK_SETTINGS");

// Стиль карты по умолчанию берём из settings.styleUrl
const settings = JSON.parse(readFileSync("settings.json", "utf8"));
const styleFile = settings.styleUrl || "maps/map1.json";
snapshot(styleFile, "maps/map1.js", "GEOWALK_STYLE");
snapshot("maps/map2.json", "maps/map2.js", "GEOWALK_STYLE_MAP2");
snapshot("maps/map3.json", "maps/map3.js", "GEOWALK_STYLE_MAP3");
snapshot("maps/mini1.json", "maps/mini1.js", "GEOWALK_MINI_STYLE");
