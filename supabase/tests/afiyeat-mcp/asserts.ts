// Small assertion helpers on Deno's built-in node:assert, so the tests need
// no extra registry.
import nodeAssert from "node:assert/strict";

export function assert(condition: unknown, message?: string): asserts condition {
  nodeAssert.ok(condition, message);
}

export function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  nodeAssert.deepStrictEqual(actual, expected, message);
}

export function assertNotEquals(actual: unknown, expected: unknown, message?: string): void {
  nodeAssert.notDeepStrictEqual(actual, expected, message);
}

export function assertMatch(actual: string, pattern: RegExp, message?: string): void {
  nodeAssert.match(actual, pattern, message);
}

export function assertExists<T>(value: T, message?: string): asserts value is NonNullable<T> {
  nodeAssert.ok(value !== null && value !== undefined, message ?? "expected a value");
}

export function assertThrows(fn: () => unknown, message?: string): void {
  nodeAssert.throws(fn, message);
}
