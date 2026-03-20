const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\LAUNCHER");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 25000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const taskbar = await harness.waitUntil(() => {
      const process = harness.processes.find((item) => item.displayPath === "/SYS/@TASKBAR" && !item.removed) || null;
      if (!process) {
        return null;
      }
      const menuText = process.textDraws.find((item) => item.text === "Меню" || item.text === "Menu") || null;
      return menuText ? { process, menuText } : null;
    }, "launcher taskbar menu", 12000);

    const screenX = ((taskbar.menuText.screenX | 0) + 8) | 0;
    const screenY = ((taskbar.menuText.screenY | 0) + 8) | 0;
    const localX = (screenX - (taskbar.process.actualX | 0)) | 0;
    const localY = (screenY - (taskbar.process.actualY | 0)) | 0;
    taskbar.process.emulator.setMouseState(localX, localY, 0, true, 0, 0, 0, 0, true, screenX, screenY);
    await new Promise((resolve) => setTimeout(resolve, 30));
    taskbar.process.emulator.setMouseState(localX, localY, 1, true, 1, 0, 0, 0, false, screenX, screenY);
    await new Promise((resolve) => setTimeout(resolve, 30));
    taskbar.process.emulator.setMouseState(localX, localY, 0, true, 0, 1, 0, 0, false, screenX, screenY);

    const result = await harness.waitUntil(() => {
      const noneLogs = harness.processes.flatMap((process) => (
        process.logs.filter((line) => line.includes("/SYS/NONE")).map((line) => `${process.displayPath || process.processPath}: ${line}`)
      ));
      if (noneLogs.length) {
        throw new Error(`Taskbar tried to launch NONE:\n${noneLogs.join("\n")}`);
      }
      const menuProcess = harness.processes.find((process) => {
        if (!process || process.removed) {
          return false;
        }
        const displayPath = String(process.displayPath || process.processPath || "");
        if (displayPath.toUpperCase() === "/SYS/@MENU") {
          return true;
        }
        return process.logs.some((line) => line.includes("Image loaded: @MENU"));
      }) || null;
      if (!menuProcess) {
        return null;
      }
      return {
        pid: menuProcess.pid >>> 0,
        width: menuProcess.surface ? (menuProcess.surface.width | 0) : 0,
        height: menuProcess.surface ? (menuProcess.surface.height | 0) : 0
      };
    }, "taskbar menu app", 8000);

    console.log(`Autotest OK: taskbar menu launched /SYS/@MENU pid=${result.pid} ${result.width}x${result.height}`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});
