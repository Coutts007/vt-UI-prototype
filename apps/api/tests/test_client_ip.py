"""X-Forwarded-For counts only from the configured proxy, or callers could dodge the limits."""

from types import SimpleNamespace
from typing import Any

import pytest
from app.security.ip_hash import client_ip, ip_hash


def request(peer: str, forwarded: str | None, trusted: str) -> Any:
    settings = SimpleNamespace(trusted_proxies=trusted, ip_pepper="pepper")
    return SimpleNamespace(
        client=SimpleNamespace(host=peer),
        headers={"x-forwarded-for": forwarded} if forwarded else {},
        app=SimpleNamespace(state=SimpleNamespace(settings=settings)),
    )


@pytest.mark.parametrize(
    ("peer", "forwarded", "trusted", "expected"),
    [
        ("203.0.113.9", "198.51.100.1", "", "203.0.113.9"),
        ("203.0.113.9", "198.51.100.1", "172.16.0.0/12", "203.0.113.9"),
        ("172.18.0.5", None, "172.16.0.0/12", "172.18.0.5"),
        ("172.18.0.5", "198.51.100.1", "172.16.0.0/12", "198.51.100.1"),
        ("172.18.0.5", "6.6.6.6, 198.51.100.1", "172.16.0.0/12", "198.51.100.1"),
        ("192.168.1.2", "198.51.100.1", "172.16.0.0/12,192.168.0.0/16", "198.51.100.1"),
        ("not-an-ip", "198.51.100.1", "172.16.0.0/12", "not-an-ip"),
    ],
)
def test_client_ip(peer: str, forwarded: str | None, trusted: str, expected: str) -> None:
    assert client_ip(request(peer, forwarded, trusted)) == expected


def test_a_spoofed_header_does_not_change_the_hash_for_a_direct_caller() -> None:
    plain = ip_hash(request("203.0.113.9", None, "172.16.0.0/12"))
    assert ip_hash(request("203.0.113.9", "1.2.3.4", "172.16.0.0/12")) == plain
    assert "203.0.113.9" not in plain
