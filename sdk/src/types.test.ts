import {
  YieldRegime,
  YieldMatcherMode,
  UptimeMatcherMode,
  ResolutionOutcome,
  SignalSeverity,
} from "./types";

describe("Enum values", () => {
  test("YieldRegime values match Rust program", () => {
    expect(YieldRegime.VeryLow).toBe(0);
    expect(YieldRegime.Low).toBe(1);
    expect(YieldRegime.Normal).toBe(2);
    expect(YieldRegime.High).toBe(3);
    expect(YieldRegime.Extreme).toBe(4);
  });

  test("YieldMatcherMode values match Rust program", () => {
    expect(YieldMatcherMode.AllNCN).toBe(0);
    expect(YieldMatcherMode.SingleNCN).toBe(1);
  });

  test("UptimeMatcherMode values match Rust program", () => {
    expect(UptimeMatcherMode.Continuous).toBe(0);
    expect(UptimeMatcherMode.SlashingSettlement).toBe(1);
  });

  test("ResolutionOutcome values match Rust program", () => {
    expect(ResolutionOutcome.Slashed).toBe(0);
    expect(ResolutionOutcome.Safe).toBe(1);
  });

  test("SignalSeverity values match Rust program", () => {
    expect(SignalSeverity.None).toBe(0);
    expect(SignalSeverity.Low).toBe(1);
    expect(SignalSeverity.High).toBe(2);
    expect(SignalSeverity.Critical).toBe(3);
  });
});
