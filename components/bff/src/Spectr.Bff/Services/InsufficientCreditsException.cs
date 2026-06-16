namespace Spectr.Bff.Services;

// Story 2.3 — thrown by CreditLedgerService.SpendAsync when the
// user's balance is < 1 at spend time. Caller maps to a 409
// `insufficient_credits` envelope via Endpoints/ErrorEnvelope.cs.
//
// The exception carries the current balance so callers / logs can
// surface "you have 0 credits — buy a pack to continue" copy without
// a second DB roundtrip.

public sealed class InsufficientCreditsException(int currentBalance)
    : Exception($"Insufficient credits: current balance is {currentBalance}.")
{
    public int CurrentBalance { get; } = currentBalance;
}
