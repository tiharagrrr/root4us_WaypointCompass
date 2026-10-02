import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDateOf,
  cutoffFor,
  dowOf,
  instantAt,
  isOperatingDay,
  minuteLabel,
  nextOperatingDay,
  nextWeekdayAfter,
  previousOperatingDay,
  weekdayOf,
  weekdayOnOrAfter,
} from "./business-time";

/** The demo calendar of specs/ordering/spec.md: 2026-09-30 to 2026-10-03 operate. */
const DEMO: Record<string, boolean> = {
  "2026-09-30": true,
  "2026-10-01": true,
  "2026-10-02": true,
  "2026-10-03": true,
  "2026-10-04": false,
};
const demo = (date: string) => DEMO[date];

describe("business dates", () => {
  it("reads the Asia/Colombo date of an instant, not UTC's", () => {
    // 20:00 UTC is already the next day in Colombo.
    expect(businessDateOf(new Date("2026-10-01T20:00:00Z"))).toBe("2026-10-02");
    expect(businessDateOf(new Date("2026-10-01T16:00:00+05:30"))).toBe("2026-10-01");
  });

  it("turns a date and a minute of the day into an instant", () => {
    expect(instantAt("2026-10-01", 960).toISOString()).toBe("2026-10-01T10:30:00.000Z");
    expect(instantAt("2026-10-01", 960).getTime()).toBe(
      new Date("2026-10-01T16:00:00+05:30").getTime(),
    );
  });

  it("counts days and weekdays with Monday as 0", () => {
    expect(addDays("2026-10-01", 2)).toBe("2026-10-03");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(dowOf("2026-10-01")).toBe(3);
    expect(weekdayOf("2026-10-01")).toBe("Thursday");
    expect(weekdayOf("2026-10-02")).toBe("Friday");
  });

  it("labels minutes of the day", () => {
    expect(minuteLabel(420)).toBe("07:00");
    expect(minuteLabel(960)).toBe("16:00");
    expect(minuteLabel(0)).toBe("00:00");
  });

  it("refuses anything that is not a business date", () => {
    expect(() => addDays("01-10-2026", 1)).toThrow(/business date/);
    expect(() => instantAt("2026-13-45", 0)).toThrow(/business date/);
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    expect(() => dowOf("2026-02-30")).toThrow(/business date/);
    expect(() => addDays("2026-04-31", 1)).toThrow(/business date/);
    expect(() => dowOf("2025-02-29")).toThrow(/business date/);
    expect(dowOf("2024-02-29")).toBe(3);
  });
});

describe("operating days", () => {
  it("follows the calendar when it has a row", () => {
    expect(isOperatingDay("2026-10-04", demo)).toBe(false);
    expect(isOperatingDay("2026-10-02", demo)).toBe(true);
  });

  it("falls back to Monday to Saturday when it has none (AC-MD-10)", () => {
    expect(isOperatingDay("2026-10-05", demo)).toBe(true); // Monday, no row
    expect(isOperatingDay("2026-10-11", demo)).toBe(false); // Sunday, no row
  });

  it("skips non-operating days in both directions (AC-MD-10)", () => {
    expect(nextOperatingDay("2026-10-02", demo)).toBe("2026-10-03");
    expect(nextOperatingDay("2026-10-03", demo)).toBe("2026-10-05");
    expect(nextOperatingDay("2026-10-10", demo)).toBe("2026-10-12");
    expect(previousOperatingDay("2026-10-02", demo)).toBe("2026-10-01");
    expect(previousOperatingDay("2026-10-05", demo)).toBe("2026-10-03");
  });
});

describe("the cutoff", () => {
  it("falls on the operating day before delivery, at cutoffMin", () => {
    expect(cutoffFor("2026-10-02", 960, demo).toISOString()).toBe("2026-10-01T10:30:00.000Z");
    expect(cutoffFor("2026-10-02", 900, demo).getTime()).toBe(
      new Date("2026-10-01T15:00:00+05:30").getTime(),
    );
  });

  it("skips a closed day, so Monday's orders close on Saturday (AC-ORD-24)", () => {
    expect(cutoffFor("2026-10-05", 960, demo).getTime()).toBe(
      new Date("2026-10-03T16:00:00+05:30").getTime(),
    );
  });
});

describe("the Style weekly delivery day", () => {
  it("moves a Friday order to the next Friday (AC-ORD-37)", () => {
    expect(nextWeekdayAfter("2026-10-02", 4)).toBe("2026-10-09");
    expect(nextWeekdayAfter("2026-10-01", 4)).toBe("2026-10-02");
  });

  it("leaves a date already on the delivery day where it is (AC-ORD-08)", () => {
    expect(weekdayOnOrAfter("2026-10-02", 4)).toBe("2026-10-02");
    expect(weekdayOnOrAfter("2026-10-01", 4)).toBe("2026-10-02");
  });
});
