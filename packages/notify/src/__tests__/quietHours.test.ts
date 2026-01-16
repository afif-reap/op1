/**
 * Unit tests for notify plugin functions
 * Tests quiet hours logic and configuration
 */

import { describe, test, expect } from "bun:test";
import { isQuietHours } from "../index";

describe("isQuietHours", () => {
	test("returns false when quiet hours are disabled", () => {
		const config = {
			enabled: false,
			start: "22:00",
			end: "08:00",
		};

		// Should return false regardless of time
		const result = isQuietHours(config);
		expect(result).toBe(false);
	});

	test("returns true during overnight quiet hours", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Mock current time to 23:00 (11 PM)
		const now = new Date();
		now.setHours(23, 0, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(true);
	});

	test("returns true during early morning quiet hours", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Mock current time to 05:00 (5 AM)
		const now = new Date();
		now.setHours(5, 0, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(true);
	});

	test("returns false outside quiet hours", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Mock current time to 12:00 (noon)
		const now = new Date();
		now.setHours(12, 0, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(false);
	});

	test("handles same-day quiet hours", () => {
		const config = {
			enabled: true,
			start: "13:00",
			end: "14:00",
		};

		// During quiet hours (13:30)
		const duringNow = new Date();
		duringNow.setHours(13, 30, 0, 0);
		expect(isQuietHours(config, duringNow)).toBe(true);

		// Before quiet hours (12:30)
		const beforeNow = new Date();
		beforeNow.setHours(12, 30, 0, 0);
		expect(isQuietHours(config, beforeNow)).toBe(false);

		// After quiet hours (14:30)
		const afterNow = new Date();
		afterNow.setHours(14, 30, 0, 0);
		expect(isQuietHours(config, afterNow)).toBe(false);
	});

	test("handles edge case at start time", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Exactly at start time (22:00)
		const now = new Date();
		now.setHours(22, 0, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(true);
	});

	test("handles edge case just before end time", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Just before end time (07:59)
		const now = new Date();
		now.setHours(7, 59, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(true);
	});

	test("handles edge case at end time", () => {
		const config = {
			enabled: true,
			start: "22:00",
			end: "08:00",
		};

		// Exactly at end time (08:00)
		const now = new Date();
		now.setHours(8, 0, 0, 0);

		const result = isQuietHours(config, now);
		expect(result).toBe(false);
	});
});

// Note: detectTerminal is not tested here as it reads from process.env
// which is global state that would interfere with other tests.
// The function is covered by manual testing and integration tests.
