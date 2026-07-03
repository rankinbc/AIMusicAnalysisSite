namespace Spectr.Bff.Services;

// Story 3.4 seam → story 4.2 (AR27) — transactional email boundary. The
// implementation is QueueEmailSender: render (template registry) → check
// suppression → enqueue the send_email actor on `maintenance`. Every
// producer (retention warnings, verification/reset/dunning later) goes
// through THIS interface; nobody calls a provider directly.
public interface IEmailSender
{
    Task SendAsync(
        string toEmail,
        string template,
        IReadOnlyDictionary<string, string> data,
        CancellationToken ct = default);
}
