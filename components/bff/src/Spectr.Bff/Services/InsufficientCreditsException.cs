namespace Spectr.Bff.Services;

// Thrown by CreditLedgerService.ChargeAsync when balance < the amount charged.
// Caller maps to a 409 `insufficient_credits` envelope. Carries both numbers so
// callers can say "you have 40, this costs 100" without a second DB roundtrip.

public sealed class InsufficientCreditsException(int currentBalance, int required = 1)
    : Exception($"Insufficient credits: balance {currentBalance}, required {required}.")
{
    public int CurrentBalance { get; } = currentBalance;
    public int Required { get; } = required;
}
