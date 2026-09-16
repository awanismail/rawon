import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvValue } from "../../src/utils/functions/parseEnvValue.ts";

test("parseEnvValue parses empty string to empty array", () => {
    assert.deepEqual(parseEnvValue(""), []);
    assert.deepEqual(parseEnvValue("   "), []);
});

test("parseEnvValue parses single unquoted or quoted ID", () => {
    assert.deepEqual(parseEnvValue("123456789"), ["123456789"]);
    assert.deepEqual(parseEnvValue('"123456789"'), ["123456789"]);
    assert.deepEqual(parseEnvValue("'123456789'"), ["123456789"]);
});

test("parseEnvValue parses comma-separated IDs without spaces", () => {
    assert.deepEqual(parseEnvValue("111111111,222222222"), ["111111111", "222222222"]);
});

test("parseEnvValue parses comma-separated IDs with spaces", () => {
    assert.deepEqual(parseEnvValue("111111111, 222222222, 333333333"), ["111111111", "222222222", "333333333"]);
});

test("parseEnvValue parses quoted comma-separated string", () => {
    assert.deepEqual(parseEnvValue('"111111111,222222222"'), ["111111111", "222222222"]);
    assert.deepEqual(parseEnvValue('"111111111, 222222222"'), ["111111111", "222222222"]);
});

test("parseEnvValue parses multiple quoted elements", () => {
    assert.deepEqual(parseEnvValue('"111111111", "222222222"'), ["111111111", "222222222"]);
    assert.deepEqual(parseEnvValue('"111111111","222222222"'), ["111111111", "222222222"]);
});
