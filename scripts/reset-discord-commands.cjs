const { REST, Routes } = require("discord.js");

async function resetCommands(rest, expectedId, output = console) {
	const application = await rest.get(Routes.oauth2CurrentApplication());
	if (expectedId && application.id !== expectedId) {
		throw new Error("CLIENT_ID does not match the bot token.");
	}
	const guilds = [];
	let after;
	while (true) {
		const query = new URLSearchParams({ limit: "200" });
		if (after) query.set("after", after);
		const page = await rest.get(Routes.userGuilds(), { query });
		guilds.push(...page);
		if (page.length < 200) break;
		const next = page[page.length - 1].id;
		if (next === after) throw new Error("Guild pagination did not advance.");
		after = next;
	}
	const routes = [
		Routes.applicationCommands(application.id),
		...guilds.map((guild) =>
			Routes.applicationGuildCommands(application.id, guild.id),
		),
	];
	let removed = 0;
	output.log(`Resetting commands for ${application.name} (${application.id}).`);
	for (const route of routes) {
		const commands = await rest.get(route);
		if (!commands.length) continue;
		await rest.put(route, { body: [] });
		const remaining = await rest.get(route);
		if (remaining.length)
			throw new Error(`Reset verification failed: ${route}`);
		removed += commands.length;
	}
	output.log(
		`Removed ${removed} commands. Start the new bot version to register current commands.`,
	);
}

async function main() {
	require("dotenv").config();
	require("dotenv").config({ path: "dev.env" });
	const tokens = [
		...new Set(
			(process.env.DISCORD_TOKEN || "")
				.split(",")
				.map((token) => token.trim())
				.filter(Boolean),
		),
	];
	if (process.env.ENABLE_SLASH_COMMAND === "no")
		throw new Error("Enable slash commands before resetting for redeploy.");
	if (!tokens.length) throw new Error("DISCORD_TOKEN is required.");
	for (const token of tokens) {
		await resetCommands(new REST({ version: "10" }).setToken(token), undefined);
	}
}

if (require.main === module) {
	main().catch((error) => {
		console.error(
			`Command reset failed: ${error.message}. Earlier changes may have succeeded; retry after fixing the error.`,
		);
		process.exitCode = 1;
	});
}

module.exports = { resetCommands };
