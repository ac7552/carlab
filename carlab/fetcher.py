"""Fetches one listing page (or one of its photos) that someone pasted. Because the link comes from outside, it only
talks to public addresses (no localhost, private networks or cloud metadata), connects to the address it checked,
checks every redirect again, and stops at a size and time limit. Nothing is written anywhere.

Adapted from the fetcher in my renderer project."""

from __future__ import annotations

import http.client
import ipaddress
import os
import re
import socket
import ssl
import time
from email.message import Message
from urllib.parse import urljoin, urlsplit

MAX_BYTES = 3_000_000
MAX_IMAGE_BYTES = 6_000_000
MAX_REDIRECTS = 3
TIMEOUT = 8
DEADLINE = 15  # however the site answers (slowly, through redirects), one fetch gives up after this
CHUNK = 64 * 1024
USER_AGENT = "carlab/0.1 (reads one car listing when a person asks)"
BLOCKED = [ipaddress.ip_network(net) for net in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
    "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8",
)]
ACCEPT = {"page": "text/html,application/xhtml+xml", "image": "image/webp,image/jpeg,image/png"}
IMAGE_TYPES = re.compile(r"\Aimage/(jpeg|png|webp)\Z")
BOT_CHECK = re.compile(r"bm-verify|_Incapsula_Resource|cf-chl|challenge-platform|px-captcha|Pardon Our Interruption|Access to this page has been denied", re.I)


class Error(Exception):
    """Something the person can fix or should know: said in words for them."""


def allow_private_hosts() -> bool:
    """For trying a listing site running on this machine: CARLAB_ALLOW_PRIVATE_HOSTS=1."""
    return os.environ.get("CARLAB_ALLOW_PRIVATE_HOSTS") == "1"


def site(url) -> str:
    try:
        host = urlsplit(str(url or "").strip()).hostname or ""
    except ValueError:
        host = ""
    return host.lower().removeprefix("www.") or "That site"


def allowed(address) -> bool:
    if allow_private_hosts():
        return True
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not any(ip in network for network in BLOCKED)


def parse(url):
    try:
        parts = urlsplit(str(url or "").strip())
        parts.port  # noqa: B018 - raises for a bad port
    except ValueError:
        raise Error("That doesn't look like a web link.") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise Error("That doesn't look like a web link.")
    return parts


def resolve(host) -> list[str]:
    try:
        found = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        found = []
    addresses = list(dict.fromkeys(info[4][0] for info in found))
    addresses.sort(key=lambda a: 1 if ":" in a else 0)
    if not addresses:
        raise Error("Couldn't find that website. Is this computer online?")
    checked = [a for a in addresses if allowed(a)]
    if not checked:
        raise Error("That link points to a private address.")
    return checked


class _Pinned(http.client.HTTPConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout)
        self.address = address

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), self.timeout)


class _PinnedTLS(http.client.HTTPSConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class Fetcher:
    def __init__(self):
        self.deadline = None
        self.url = ""

    def remaining(self) -> float:
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise Error(f"{site(self.url)} took too long to answer.")
        return min(TIMEOUT, max(left, 0.5))

    def get(self, url, want="page", redirects=0):
        if self.deadline is None:
            self.deadline = time.monotonic() + DEADLINE
        self.url = url
        parts = parse(url)
        connection = None
        try:
            secure = parts.scheme == "https"
            port = parts.port or (443 if secure else 80)
            addresses = resolve(parts.hostname)
            for index, address in enumerate(addresses):
                connection = (_PinnedTLS if secure else _Pinned)(parts.hostname, port, address, self.remaining())
                try:
                    connection.connect()
                    break
                except OSError:
                    connection.close()
                    if index == len(addresses) - 1:
                        raise
            path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
            connection.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept": ACCEPT[want], "Accept-Encoding": "identity", "Connection": "close"})
            connection.sock.settimeout(self.remaining())
            response = connection.getresponse()
            code = response.status
            if 300 <= code < 400:
                location = response.getheader("Location")
                if redirects >= MAX_REDIRECTS or not location:
                    raise Error(f"{site(url)} kept sending us elsewhere.")
                connection.close()
                return self.get(urljoin(url, location), want, redirects + 1)
            if code in (401, 403, 429, 503):
                raise Error(f"{site(url)} doesn't let apps read its pages. Save a photo of the car from it instead.")
            if not 200 <= code < 300:
                raise Error(f"{site(url)} answered {code}. Check the link.")
            return self.read_image(response, connection) if want == "image" else self.read_page(response, connection)
        except (OSError, http.client.HTTPException) as error:
            raise Error(f"Couldn't load that page ({type(error).__name__}). Is this computer online?") from error
        finally:
            if connection is not None:
                connection.close()

    def read(self, response, connection, limit, message):
        out = bytearray()
        while True:
            # Each read waits at most the timeout set before the response began (http.client lets go of the
            # connection's socket once a response that closes it starts); this gives up once the deadline passes.
            self.remaining()
            chunk = response.read(CHUNK)
            if not chunk:
                return bytes(out)
            out.extend(chunk)
            if len(out) > limit:
                raise Error(message)

    def read_image(self, response, connection):
        kind = (response.getheader("Content-Type") or "").split(";")[0].strip()
        if not IMAGE_TYPES.search(kind):
            raise Error("That isn't a photo.")
        return self.read(response, connection, MAX_IMAGE_BYTES, "That photo is too big."), kind

    def read_page(self, response, connection):
        kind = response.getheader("Content-Type") or ""
        if not re.search(r"text/html|application/xhtml", kind):
            raise Error("That link isn't a web page.")
        raw = self.read(response, connection, MAX_BYTES, "That page is too big to read.")
        header = Message()
        header["Content-Type"] = kind
        try:
            body = raw.decode(header.get_content_charset() or "utf-8", errors="replace")
        except LookupError:
            body = raw.decode("utf-8", errors="replace")
        if len(body) < 20_000 and BOT_CHECK.search(body):
            raise Error(f"{site(self.url)} doesn't let apps read its pages. Save a photo of the car from it instead.")
        return body


def get_page(url) -> str:
    return Fetcher().get(url, "page")


def get_image(url):
    """(bytes, content type) for a listing photo, with the same checks as a page."""
    return Fetcher().get(url, "image")
