using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class JobRetryTrackerTests
{
    [Fact]
    public void Schedule_respects_max_retries()
    {
        var tracker = new JobRetryTracker();
        var delay = TimeSpan.Zero;

        tracker.Schedule("job-1", "fail 1", delay, maxRetries: 3);
        Assert.True(tracker.IsEligible("job-1"));
        Assert.Equal("Retry #1", tracker.BadgeFor("job-1"));

        tracker.Schedule("job-1", "fail 2", delay, maxRetries: 3);
        tracker.Schedule("job-1", "fail 3", delay, maxRetries: 3);
        Assert.False(tracker.IsExhausted("job-1"));

        tracker.Schedule("job-1", "fail 4", delay, maxRetries: 3);
        Assert.True(tracker.IsExhausted("job-1"));
        Assert.False(tracker.IsEligible("job-1"));
        Assert.Equal("Max retries (3)", tracker.BadgeFor("job-1"));
    }

    [Fact]
    public void Submitted_jobs_use_unlimited_retries_by_default()
    {
        var tracker = new JobRetryTracker();
        var delay = TimeSpan.FromMilliseconds(1);

        for (var i = 0; i < 10; i++)
        {
            tracker.Schedule("job-2", $"fail {i}", delay);
        }

        Assert.False(tracker.IsExhausted("job-2"));
    }

    [Fact]
    public void Clear_removes_retry_state()
    {
        var tracker = new JobRetryTracker();
        tracker.Schedule("job-3", "fail", TimeSpan.FromSeconds(5), maxRetries: 1);
        tracker.Clear("job-3");

        Assert.True(tracker.IsEligible("job-3"));
        Assert.Equal(string.Empty, tracker.BadgeFor("job-3"));
    }
}
