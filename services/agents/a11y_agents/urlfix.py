"""URL helpers for running the browser inside a container."""
from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"}


def rewrite_localhost(url: str, host: str | None) -> str:
    """In Docker, `localhost` is the agent container, not the user's machine.

    With LOCALHOST_REWRITE=host.docker.internal, an address typed as http://localhost:3000 is opened
    at the host's port 3000, which is what the user means.
    """
    if not host:
        return url
    parts = urlsplit(url)
    if (parts.hostname or "").lower() not in LOCAL_HOSTS:
        return url
    netloc = host + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def friendly_nav_error(url: str, e: Exception) -> str:
    """Explain a failure to open the site in words a user can act on."""
    text = str(e)
    host = (urlsplit(url).hostname or "").lower()
    if "ERR_CONNECTION_REFUSED" in text or "ERR_NAME_NOT_RESOLVED" in text or "ERR_ADDRESS_UNREACHABLE" in text:
        if host in LOCAL_HOSTS:
            return (
                f"The agent could not open {url}. 'localhost' points at the agent's own container, not your computer. "
                "Use http://host.docker.internal:<port> for a site running on your machine, a Docker Compose service name "
                "(e.g. http://broken-shop:8000), or a public URL."
            )
        return f"The agent could not reach {url} (connection refused or the name does not resolve). Check the address and that the site is online."
    if "ERR_CERT" in text or "SSL" in text:
        return f"The agent could not open {url} because of a certificate (HTTPS) problem."
    if "Timeout" in text or "ERR_TIMED_OUT" in text or "ERR_CONNECTION_TIMED_OUT" in text:
        return f"{url} took too long to load (over 45 seconds), so the scan was stopped."
    return f"The agent could not open {url}: {text.splitlines()[0][:160]}"
