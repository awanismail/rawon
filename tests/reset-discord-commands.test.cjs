const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Routes } = require("discord.js");
const { resetCommands } = require("../scripts/reset-discord-commands.cjs");
const output = { log() {} };
function fixture({ wrong = false, stuck = false } = {}) {
	const writes = [];
	const data = new Map([
		[Routes.applicationCommands("app"), [{ name: "old" }]],
		[Routes.applicationGuildCommands("app", "201"), [{ name: "legacy" }]],
	]);
	return {
		writes,
		rest: {
			async get(route, options) {
				if (route === Routes.oauth2CurrentApplication())
					return { id: wrong ? "wrong" : "app", name: "bot" };
				if (route === Routes.userGuilds())
					return options.query.get("after")
						? [{ id: "201" }]
						: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) }));
				return data.get(route) || [];
			},
			async put(route, { body }) {
				assert.deepEqual(body, []);
				writes.push(route);
				if (!stuck) data.set(route, []);
			},
		},
	};
}
test("reset clears global and guild commands across pages and can be rerun", async () => {
	const { rest, writes } = fixture();
	await resetCommands(rest, "app", output);
	assert.deepEqual(writes, [
		Routes.applicationCommands("app"),
		Routes.applicationGuildCommands("app", "201"),
	]);
	await resetCommands(rest, "app", output);
	assert.equal(writes.length, 2);
});
test("wrong app prevents all writes", async () => {
	const { rest, writes } = fixture({ wrong: true });
	await assert.rejects(resetCommands(rest, "app", output), /does not match/);
	assert.equal(writes.length, 0);
});
test("failed verification stops further deletes", async () => {
	const { rest, writes } = fixture({ stuck: true });
	await assert.rejects(
		resetCommands(rest, "app", output),
		/verification failed/,
	);
	assert.equal(writes.length, 1);
});
