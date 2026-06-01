namespace Yesgatc.CertificateWorker.Services;

public sealed class JobRetryTracker
{
    private readonly Dictionary<string, JobRetryState> _states = new(StringComparer.Ordinal);

    public sealed record JobRetryState(int Attempt, DateTimeOffset RetryAt, string LastError);

    public void Schedule(string jobId, string error, TimeSpan delay)
    {
        var attempt = _states.TryGetValue(jobId, out var existing) ? existing.Attempt + 1 : 1;
        _states[jobId] = new JobRetryState(attempt, DateTimeOffset.Now.Add(delay), error);
    }

    public void Clear(string jobId) => _states.Remove(jobId);

    public bool IsEligible(string jobId) =>
        !_states.TryGetValue(jobId, out var state) || DateTimeOffset.Now >= state.RetryAt;

    public string BadgeFor(string jobId)
    {
        if (!_states.TryGetValue(jobId, out var state))
        {
            return string.Empty;
        }

        if (DateTimeOffset.Now >= state.RetryAt)
        {
            return $"Retry #{state.Attempt}";
        }

        var remaining = state.RetryAt - DateTimeOffset.Now;
        if (remaining.TotalMinutes >= 1)
        {
            return $"Retry in {Math.Ceiling(remaining.TotalMinutes):0}m";
        }

        return $"Retry in {Math.Max(1, (int)Math.Ceiling(remaining.TotalSeconds))}s";
    }

    public IReadOnlyDictionary<string, JobRetryState> Snapshot() =>
        new Dictionary<string, JobRetryState>(_states);
}
