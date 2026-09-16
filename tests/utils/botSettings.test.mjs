import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDataManager } from "../../dist/utils/structures/SQLiteDataManager.js";

test("setBotSetting updates always_on and reflects in botSettings", async () => {
    const manager = new SQLiteDataManager(":memory:");
    assert.equal(manager.botSettings.alwaysOn, false);

    await manager.setBotSetting("always_on", 1);
    assert.equal(manager.botSettings.alwaysOn, true);

    await manager.setBotSetting("always_on", 0);
    assert.equal(manager.botSettings.alwaysOn, false);

    await manager.setBotSetting("always_on", null);
    assert.equal(manager.botSettings.alwaysOn, false);
});

test("setBotSetting rejects invalid keys", async () => {
    const manager = new SQLiteDataManager(":memory:");
    await assert.rejects(
        async () => manager.setBotSetting("non_existent_key", "value"),
        { message: "Invalid setting key: non_existent_key" },
    );
});
