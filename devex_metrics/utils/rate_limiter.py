"""
GitHub API rate limiter.

Tracks GitHub API rate limits and prevents exhaustion by pausing requests
when limits are low.
"""

import time
from datetime import datetime
from typing import Optional

import requests


class RateLimitExceeded(Exception):
    """Raised when GitHub API rate limit is exceeded."""

    pass


class RateLimiter:
    """
    GitHub API rate limit tracker.

    Monitors rate limit headers from API responses and automatically pauses
    execution when remaining requests are low to prevent hitting the limit.
    """

    def __init__(self, min_remaining: int = 100):
        """
        Initialize rate limiter.

        Args:
            min_remaining: Minimum remaining requests before pausing (default: 100).
        """
        self.min_remaining = min_remaining
        self.remaining: Optional[int] = None
        self.limit: Optional[int] = None
        self.reset_time: Optional[datetime] = None
        self.used: int = 0

    def check_and_wait(self, response: requests.Response) -> None:
        """
        Check rate limit from response headers and wait if necessary.

        Args:
            response: HTTP response from GitHub API.

        Raises:
            RateLimitExceeded: If rate limit is exceeded and reset time is far in the future.
        """
        # Extract rate limit headers
        self.remaining = int(response.headers.get("X-RateLimit-Remaining", 5000))
        self.limit = int(response.headers.get("X-RateLimit-Limit", 5000))
        reset_timestamp = int(response.headers.get("X-RateLimit-Reset", 0))

        if reset_timestamp:
            self.reset_time = datetime.fromtimestamp(reset_timestamp)

        self.used = self.limit - self.remaining if self.limit else 0

        # If remaining requests are low, wait until reset
        if self.remaining < self.min_remaining:
            if not self.reset_time:
                raise RateLimitExceeded("Rate limit low but no reset time available")

            wait_seconds = (self.reset_time - datetime.now()).total_seconds()

            if wait_seconds > 0:
                print(
                    f"\n⚠️  Rate limit low ({self.remaining}/{self.limit} remaining). "
                    f"Pausing for {int(wait_seconds)} seconds until {self.reset_time.strftime('%H:%M:%S')}..."
                )
                time.sleep(wait_seconds + 5)  # Add 5 second buffer
                print("✓ Rate limit reset. Resuming...")

    def get_status(self) -> dict[str, any]:
        """
        Get current rate limit status.

        Returns:
            Dictionary with rate limit information.
        """
        return {
            "remaining": self.remaining,
            "limit": self.limit,
            "used": self.used,
            "reset_time": self.reset_time.isoformat() if self.reset_time else None,
        }

    def __str__(self) -> str:
        """String representation of rate limit status."""
        if self.remaining is not None and self.limit is not None:
            reset_str = (
                self.reset_time.strftime("%H:%M:%S") if self.reset_time else "unknown"
            )
            return f"{self.remaining}/{self.limit} requests remaining (resets at {reset_str})"
        return "Rate limit status unknown"
