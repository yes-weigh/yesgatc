namespace Yesgatc.CertificateWorker.Services;

public sealed class JobRetryTracker
{
    private readonly Dictionary<string, JobRetryState> _states = new(StringComparer.Ordinal);

    public sealed record JobRetryState(
        int Attempt,
        DateTimeOffset RetryAt,
        string LastError,
        bool Exhausted,
        int MaxRetries);

    public void Schedule(string jobId, string error, TimeSpan delay, int maxRetries = int.MaxValue)
    {
        var attempt = _states.TryGetValue(jobId, out var existing) ? existing.Attempt + 1 : 1;
        var effectiveMax = maxRetries < 1 ? int.MaxValue : maxRetries;

        // Exhaust on the last allowed attempt (attempt >= max), not one past it.
        if (attempt >= effectiveMax)
        {
            _states[jobId] = new JobRetryState(
                attempt,
                DateTimeOffset.MaxValue,
                error,
                Exhausted: true,
                effectiveMax);
            return;
        }

        _states[jobId] = new JobRetryState(
            attempt,
            DateTimeOffset.Now.Add(delay),
            error,
            Exhausted: false,
            effectiveMax);
    }

    public void MarkExhausted(string jobId, string error, int maxRetries = 0)
    {
        var effectiveMax = maxRetries < 1 ? 0 : maxRetries;
        var attempt = _states.TryGetValue(jobId, out var existing)
            ? Math.Max(existing.Attempt, effectiveMax)
            : effectiveMax;
        _states[jobId] = new JobRetryState(
            attempt,
            DateTimeOffset.MaxValue,
            error,
            Exhausted: true,
            effectiveMax);
    }

    public void Clear(string jobId) => _states.Remove(jobId);

    public bool IsEligible(string jobId) =>
        !_states.TryGetValue(jobId, out var state)
        || (!state.Exhausted && DateTimeOffset.Now >= state.RetryAt);

    public bool IsExhausted(string jobId) =>
        _states.TryGetValue(jobId, out var state) && state.Exhausted;

    public string BadgeFor(string jobId)
    {
        if (!_states.TryGetValue(jobId, out var state))
        {
            return string.Empty;
        }

        if (state.Exhausted)
        {
            return state.MaxRetries < int.MaxValue
                ? $"Max retries ({state.MaxRetries})"
                : "Max retries";
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
