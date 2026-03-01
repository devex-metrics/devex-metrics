"""
Base collector class with rate limiting and retry logic.
"""

import time
from typing import Any, Optional

import requests

from devex_metrics.utils.rate_limiter import RateLimiter, RateLimitExceeded


class CollectorError(Exception):
    """Base exception for collector errors."""

    pass


class BaseCollector:
    """
    Base class for GitHub API data collectors.

    Provides rate limiting, retry logic, and common HTTP request patterns.
    """

    def __init__(self, token: str, base_url: str = "https://api.github.com"):
        """
        Initialize collector.

        Args:
            token: GitHub personal access token.
            base_url: GitHub API base URL (default: https://api.github.com).
        """
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )
        self.rate_limiter = RateLimiter(min_remaining=100)

    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
        json_data: Optional[dict[str, Any]] = None,
        max_retries: int = 3,
    ) -> requests.Response:
        """
        Make HTTP request with retry logic and rate limiting.

        Args:
            method: HTTP method (GET, POST, etc.).
            endpoint: API endpoint (e.g., '/repos/owner/repo').
            params: Query parameters.
            json_data: JSON request body.
            max_retries: Maximum number of retries on failure.

        Returns:
            HTTP response.

        Raises:
            CollectorError: If request fails after retries.
        """
        url = f"{self.base_url}{endpoint}"
        retries = 0

        while retries <= max_retries:
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_data,
                    timeout=30,
                )

                # Check rate limit before processing response
                self.rate_limiter.check_and_wait(response)

                # Raise for 4xx and 5xx errors
                if response.status_code >= 400:
                    if response.status_code == 404:
                        raise CollectorError(f"Resource not found: {endpoint}")
                    elif response.status_code == 403:
                        raise RateLimitExceeded("Rate limit exceeded (403 Forbidden)")
                    elif response.status_code >= 500:
                        # Retry on server errors
                        retries += 1
                        if retries <= max_retries:
                            time.sleep(2**retries)  # Exponential backoff
                            continue
                    response.raise_for_status()

                return response

            except requests.exceptions.Timeout:
                retries += 1
                if retries > max_retries:
                    raise CollectorError(f"Request timeout after {max_retries} retries: {endpoint}")
                time.sleep(2**retries)

            except requests.exceptions.RequestException as e:
                raise CollectorError(f"Request failed: {endpoint} - {str(e)}")

        raise CollectorError(f"Request failed after {max_retries} retries: {endpoint}")

    def get(self, endpoint: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """
        Make GET request and return JSON response.

        Args:
            endpoint: API endpoint.
            params: Query parameters.

        Returns:
            JSON response as dictionary.
        """
        response = self._request("GET", endpoint, params=params)
        return response.json()

    def get_paginated(
        self,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
        max_pages: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """
        Get all pages of a paginated endpoint.

        Args:
            endpoint: API endpoint.
            params: Query parameters.
            max_pages: Maximum number of pages to fetch (None = unlimited).

        Returns:
            List of all items from all pages.
        """
        if params is None:
            params = {}

        params.setdefault("per_page", 100)  # Max items per page
        items = []
        page = 1

        while True:
            params["page"] = page
            response = self._request("GET", endpoint, params=params)

            page_items = response.json()

            if not page_items or not isinstance(page_items, list):
                break

            items.extend(page_items)

            # Check if there are more pages
            if "Link" in response.headers:
                links = response.headers["Link"]
                if 'rel="next"' not in links:
                    break
            else:
                # No Link header means no more pages
                break

            page += 1

            if max_pages and page > max_pages:
                break

        return items

    def post(
        self, endpoint: str, json_data: dict[str, Any], params: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        """
        Make POST request and return JSON response.

        Args:
            endpoint: API endpoint.
            json_data: JSON request body.
            params: Query parameters.

        Returns:
            JSON response as dictionary.
        """
        response = self._request("POST", endpoint, params=params, json_data=json_data)
        return response.json()
