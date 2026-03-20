const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

function hasNetworkFailureLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => (
    /debug: Contacting DNS server failed/i.test(line) ||
    /debug: HTTP (GET|POST|HEAD) error/i.test(line)
  ));
}

function findText(snapshot, predicate) {
  const items = Array.isArray(snapshot && snapshot.texts) ? snapshot.texts : [];
  return items.find((item) => item && typeof item.text === "string" && predicate(item.text));
}

function hasNotFoundPage(snapshot) {
  return !!findText(snapshot, (text) => /Страница не найдена/i.test(text));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "NETWORK", "WEBVIEW");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 20000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(3500);

    const before = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!before.running || !before.window || !before.window.defined) {
      throw new Error("WEBVIEW did not keep a running window before link navigation.");
    }

    await harness.clickScreen(310, 140, { settleMs: 5000 });

    let snapshot = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(250);
      snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
      if (!snapshot.running) {
        break;
      }
      const statusText = findText(snapshot, (text) => text.startsWith("Готово:"));
      const urlText = findText(snapshot, (text) => text === "http://kolibrios.org");
      if (statusText && urlText && !hasNetworkFailureLogs(snapshot) && !hasNotFoundPage(snapshot)) {
        break;
      }
    }

    snapshot = snapshot || harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!snapshot.running) {
      throw new Error("WEBVIEW stopped after clicking an in-page link.");
    }
    if (snapshot.unknownOpcodes.length) {
      throw new Error(`WEBVIEW hit unknown opcodes after link click: ${JSON.stringify(snapshot.unknownOpcodes)}`);
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("WEBVIEW link navigation hit an unhandled emulator path.");
    }
    if (hasNetworkFailureLogs(snapshot)) {
      throw new Error("WEBVIEW link navigation hit a native network failure path.");
    }
    if (!findText(snapshot, (text) => text === "http://kolibrios.org")) {
      throw new Error("WEBVIEW did not keep the navigated URL in the address bar.");
    }
    if (!findText(snapshot, (text) => text.startsWith("Готово:"))) {
      throw new Error("WEBVIEW did not finish loading the clicked page.");
    }
    if (hasNotFoundPage(snapshot)) {
      throw new Error("WEBVIEW rendered a not-found page instead of the linked site.");
    }
    if (snapshot.title === before.title) {
      throw new Error(`WEBVIEW title did not change after link click: '${snapshot.title}'.`);
    }
    if (snapshot.surface.hash === before.surface.hash) {
      throw new Error("WEBVIEW surface hash did not change after link click.");
    }

    console.log(
      `Autotest OK: WEBVIEW opened a link, title='${snapshot.title}', ` +
      `status='${findText(snapshot, (text) => text.startsWith("Готово:")).text}', hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});
