"""
Command-line interface for devex-metrics.

Built with Typer for type-safe CLI with automatic help generation.
"""

import typer
from rich.console import Console

from devex_metrics.auth import check_authentication, verify_required_scopes
from devex_metrics.version import __version__

app = typer.Typer(
    name="devex-metrics",
    help="GitHub Organization DevOps Metrics Analyzer",
    add_completion=False,
)

console = Console()


@app.command()
def version() -> None:
    """Show version information."""
    import subprocess
    import sys

    console.print(f"[bold]devex-metrics[/bold] v{__version__}")
    console.print(f"Python {sys.version.split()[0]}")

    # Try to get gh version
    try:
        gh_version = subprocess.run(
            ["gh", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if gh_version.returncode == 0:
            gh_line = gh_version.stdout.split("\n")[0]
            console.print(f"GitHub CLI: {gh_line}")
    except FileNotFoundError:
        console.print("[yellow]GitHub CLI: not installed[/yellow]")


@app.command()
def analyze(
    organization: str = typer.Argument(..., help="GitHub organization or username to analyze"),
    format: str = typer.Option("text", help="Output format: text, json, or html"),
    output: str = typer.Option(None, help="Output file path"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging"),
    no_cache: bool = typer.Option(False, help="Skip cached data, force fresh API calls"),
) -> None:
    """Analyze GitHub organization DevOps metrics."""
    from devex_metrics.analyzers import Analyzer
    from devex_metrics.auth import AuthenticationError
    from devex_metrics.reporters import generate_html_report
    import json
    
    try:
        # Run analysis
        analyzer = Analyzer(organization)
        result = analyzer.analyze()
        
        # Display summary
        console.print("\n[bold green]Analysis Complete[/bold green]")
        console.print("─" * 50)
        console.print(f"[bold]Maturity Tier:[/bold] {result.maturity_tier} ({result.total_score}/14 points)")
        console.print(f"[bold]Repositories Analyzed:[/bold] {result.repository_count} ({result.inactive_repository_count} inactive)")
        console.print(f"[bold]Deployment Automation:[/bold] {result.metrics.deployment_automation_rate:.0%}")
        console.print(f"[bold]Code Scanning Coverage:[/bold] {result.metrics.security.code_scanning_enabled:.0%}")
        console.print(f"[bold]Branch Protection Coverage:[/bold] {result.metrics.branch_protection.full_coverage:.0%}")
        
        # Display top gaps
        if result.gaps:
            console.print("\n[bold yellow]Top Recommendations:[/bold yellow]")
            for gap in result.gaps[:3]:
                console.print(f"  • {gap.recommendation}")
        
        # Save output based on format
        if format == "html" or (format == "text" and output and output.endswith(".html")):
            # Generate HTML report
            output_path = output or f"{organization}-report-{result.analyzed_at.strftime('%Y-%m-%dT%H-%M-%S')}.html"
            generate_html_report(result, output_path)
            console.print(f"\n[green]✓[/green] HTML report saved to: {output_path}")
        elif format == "json" or (output and output.endswith(".json")):
            # Generate JSON report
            output_path = output or f"{organization}-analysis-{result.analyzed_at.strftime('%Y%m%d-%H%M%S')}.json"
            with open(output_path, "w") as f:
                json.dump(result.model_dump(mode="json"), f, indent=2, default=str)
            console.print(f"\n[green]✓[/green] JSON results saved to: {output_path}")
        
        console.print()
        
    except AuthenticationError as e:
        console.print(f"[red]Authentication Error:[/red] {str(e)}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {str(e)}")
        if verbose:
            import traceback
            console.print(traceback.format_exc())
        raise typer.Exit(2)


@app.command(name="auth")
def auth_group() -> None:
    """Authentication commands."""
    pass


@app.command()
def auth_check() -> None:
    """Check GitHub CLI authentication status."""
    try:
        auth_info = check_authentication()

        if not auth_info["authenticated"]:
            console.print("[red]✗ Not authenticated with GitHub CLI[/red]")
            console.print("\nTo authenticate, run:")
            console.print("  gh auth login --scopes repo,read:org,security_events")
            raise typer.Exit(1)

        console.print("[green]✓ GitHub CLI authenticated[/green]")

        # Check scopes
        has_scopes, missing = verify_required_scopes()
        if has_scopes:
            console.print("[green]✓ Token has required scopes: repo, read:org, security_events[/green]")
        else:
            console.print(f"[red]✗ Missing required scopes: {', '.join(missing)}[/red]")
            console.print("\nTo re-authenticate with correct scopes:")
            console.print("  gh auth logout")
            console.print("  gh auth login --scopes repo,read:org,security_events")
            raise typer.Exit(1)

        # Show user
        if auth_info.get("user"):
            console.print(f"[blue]User:[/blue] {auth_info['user']}")

        console.print("\n[green]Ready to analyze GitHub organizations.[/green]")

    except Exception as e:
        console.print(f"[red]Error checking authentication: {str(e)}[/red]")
        raise typer.Exit(1)


# History commands (stubs for now)
history_app = typer.Typer(help="Historical analysis commands")
app.add_typer(history_app, name="history")


@history_app.command("list")
def history_list(
    organization: str = typer.Argument(..., help="GitHub organization or username"),
    limit: int = typer.Option(10, help="Maximum number of analyses to show"),
) -> None:
    """List previous analyses for an organization."""
    console.print(f"[bold]Historical analyses for:[/bold] {organization}")
    console.print("[yellow]Implementation in progress...[/yellow]")


@history_app.command("compare")
def history_compare(
    organization: str = typer.Argument(..., help="GitHub organization or username"),
    date1: str = typer.Argument(..., help="Older analysis date (YYYY-MM-DD)"),
    date2: str = typer.Argument(..., help="Newer analysis date (YYYY-MM-DD)"),
) -> None:
    """Compare two analyses."""
    console.print(f"[bold]Comparing analyses for:[/bold] {organization}")
    console.print(f"[blue]{date1}[/blue] → [blue]{date2}[/blue]")
    console.print("[yellow]Implementation in progress...[/yellow]")


@history_app.command("clean")
def history_clean(
    before: str = typer.Argument(..., help="Delete analyses before this date (YYYY-MM-DD or '30d')"),
    org: str = typer.Option(None, help="Clean only specific organization"),
    dry_run: bool = typer.Option(False, help="Show what would be deleted without deleting"),
) -> None:
    """Delete old analyses."""
    console.print("[bold]Cleaning old analyses[/bold]")
    console.print("[yellow]Implementation in progress...[/yellow]")


if __name__ == "__main__":
    app()
