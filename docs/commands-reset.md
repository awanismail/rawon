# Reset Discord commands during redeploy

Run `npm run commands:reset` in the deployment environment, then start the new bot version normally. Or use `npm run start:reset` to reset and start in sequence; a failed reset prevents startup.

This explicitly removes **all global and server-specific commands for the configured bot**, then verifies each emptied list. Commands are temporarily unavailable until the bot registers them again. Stop the old bot instance first so it cannot register old definitions concurrently. Normal `npm start` is unchanged; do not use this command as a recurring health check.

Settings, schedules, and playback data are not modified. The script does not log tokens. If a request fails midway, earlier changes may have succeeded: fix the error and rerun the reset.

Nara uses `DISCORD_TOKEN` (including comma-separated multi-bot tokens), with `.env` and `dev.env` fallback. All configured bots are reset. Build the latest source before starting, and enable slash commands; startup registers commands using the normal production/development scope.
