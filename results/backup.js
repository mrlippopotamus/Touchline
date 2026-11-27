import { importMatches, readMatches, readSyncStatus } from "./browser-store.js";
import { hasMatchAnalysis } from "./matches.js";

const message = document.querySelector("#backup-status");
const fileInput = document.querySelector("#backup-file");
const choose = document.querySelector("#choose-backup");
const download = document.querySelector("#download-backup");

download.addEventListener("click", async () => {
  try {
    const matches = (await readMatches()).filter(hasMatchAnalysis)
      .map(({ importKey, hidden, retryStatsAt, ...match }) => match);
    if (!matches.length) {
      message.textContent = "No matches with complete stats to back up yet.";
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ matches }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "Touchline-Matches.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = `${matches.length} ${matches.length === 1 ? "match" : "matches"} exported.`;
  } catch (error) {
    message.textContent = error.message;
  }
});

choose.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  choose.disabled = true;
  message.textContent = "Reading match backup…";
  try {
    const { resetAt } = await readSyncStatus();
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose a match backup smaller than 20 MB.");
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("This file could not be read as a JSON match backup.");
    }
    if (!Array.isArray(backup?.matches) || !backup.matches.length) throw new Error("This backup does not contain any matches.");
    const { inserted, skipped } = await importMatches(backup.matches, "backup", resetAt);
    message.textContent = `${inserted} ${inserted === 1 ? "match" : "matches"} restored.${skipped ? ` ${skipped} already saved.` : ""}`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    fileInput.value = "";
    choose.disabled = false;
  }
});
