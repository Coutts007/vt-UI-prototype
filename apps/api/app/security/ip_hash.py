import hashlib
import hmac
from ipaddress import IPv6Address, ip_address, ip_network

from fastapi import Request


def client_ip(request: Request) -> str:
    """Trusts X-Forwarded-For only from the configured proxy (backend-spec 14.2)."""
    peer = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    settings = request.app.state.settings
    if not forwarded or not settings.trusted_proxies:
        return peer
    try:
        address = ip_address(peer)
        trusted = any(
            address in ip_network(item.strip()) for item in settings.trusted_proxies.split(",")
        )
    except ValueError:
        return peer
    return forwarded.split(",")[-1].strip() if trusted else peer


def keyed_hash(request: Request, value: str) -> str:
    pepper = request.app.state.settings.ip_pepper.encode()
    return hmac.new(pepper, value.encode(), hashlib.sha256).hexdigest()[:16]


def ip_hash(request: Request) -> str:
    return keyed_hash(request, client_ip(request))


def network_key(address: str) -> str:
    """One IPv6 subscriber usually holds a whole /64, so it counts as one. IPv4 stays as it is."""
    try:
        parsed = ip_address(address)
    except ValueError:
        return address
    if not isinstance(parsed, IPv6Address):
        return address
    # A mapped address is IPv4: taking its /64 would put every IPv4 client in one bucket.
    if parsed.ipv4_mapped:
        return str(parsed.ipv4_mapped)
    return str(ip_network(f"{parsed}/64", strict=False))


def network_hash(request: Request) -> str:
    return keyed_hash(request, network_key(client_ip(request)))
