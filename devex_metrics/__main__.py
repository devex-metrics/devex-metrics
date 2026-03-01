"""
Entry point for running devex-metrics as a module.

Usage:
    python -m devex_metrics analyze my-org
"""

from devex_metrics.cli import app

if __name__ == "__main__":
    app()
