import assert from "node:assert/strict";
import test from "node:test";
import { Message, CommandInteraction } from "discord.js";
import { CommandContext } from "../../dist/structures/CommandContext.js";

function createMockMessage() {
    const obj = Object.create(Message.prototype);
    Object.defineProperty(obj, "channel", { value: null });
    Object.defineProperty(obj, "guild", { value: null });
    return obj;
}

function createMockInteraction() {
    const obj = Object.create(CommandInteraction.prototype);
    Object.defineProperty(obj, "channel", { value: null });
    Object.defineProperty(obj, "guild", { value: null });
    obj.isChatInputCommand = () => true;
    return obj;
}

test("CommandContext correctly detects Message context", () => {
    const mockMessage = createMockMessage();
    const ctx = new CommandContext(mockMessage);
    assert.equal(ctx.isMessage(), true);
    assert.equal(ctx.isMessageContext(), true);
    assert.equal(ctx.isCommandInteraction(), false);
    assert.equal(ctx.isChatInputInteractionContext(), false);
});

test("CommandContext correctly detects CommandInteraction context", () => {
    const mockInteraction = createMockInteraction();
    const ctx = new CommandContext(mockInteraction);
    assert.equal(ctx.isMessage(), false);
    assert.equal(ctx.isMessageContext(), false);
    assert.equal(ctx.isCommandInteraction(), true);
    assert.equal(ctx.isChatInputInteractionContext(), true);
});
