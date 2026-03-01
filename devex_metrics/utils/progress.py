"""
Progress bar utilities using rich.
"""

from typing import Any, Iterable

from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)


def create_progress_bar() -> Progress:
    """
    Create a rich progress bar for tracking long operations.

    Returns:
        Configured Progress instance.
    """
    return Progress(
        SpinnerColumn(),
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TextColumn("•"),
        TimeElapsedColumn(),
    )


def track_progress(
    items: Iterable[Any],
    description: str = "Processing...",
    total: int = None,
) -> Iterable[Any]:
    """
    Track progress of an iterable with a progress bar.

    Args:
        items: Iterable to track.
        description: Progress bar description.
        total: Total number of items (if known).

    Yields:
        Items from the iterable.
    """
    with create_progress_bar() as progress:
        task = progress.add_task(description, total=total)

        for item in items:
            yield item
            progress.update(task, advance=1)
